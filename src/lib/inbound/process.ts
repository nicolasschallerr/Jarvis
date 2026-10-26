import type { SupabaseClient } from "@supabase/supabase-js";

import { respondToMessage } from "@/lib/agent/attention";
import { anthropicClientFromEnv } from "@/lib/ai/anthropic-client";
import { transcriptionClientFromEnv, type TranscriptionClient } from "@/lib/ai/transcription";
import type { ModelClient } from "@/lib/ai/types";
import { handleOptOutKeyword, isOptOutKeyword } from "@/lib/consent";
import { channelToken } from "@/lib/outbound/channel-token";
import type { Database, Json } from "@/lib/supabase/database.types";

import { fetchProfileName, instagramApiFrom } from "@/lib/outbound/meta-messaging";
import { graphBase } from "@/lib/outbound/whatsapp";
import { INSTAGRAM_PREFIX, MESSENGER_PREFIX } from "@/lib/meta/events";

import { storeTelegramMedia, storeUrlMedia, storeWhatsAppMedia } from "./media";
import { normalizeMessagingEvent } from "./messaging";
import { applyWhatsAppStatuses } from "./statuses";
import { transcribeAudioMessage } from "./transcribe";
import { normalizeTelegramEvent } from "./telegram";
import type { MediaRef, NormalizedMessage } from "./types";
import { normalizeWhatsAppEvent } from "./whatsapp";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type ClaimedEvent = {
  id: string;
  organization_id: string | null;
  dedupe_key: string;
  payload: Json;
};

export type ProcessResult = {
  claimed: number;
  processed: number;
  duplicates: number;
  failed: number;
};

// Prefijo de la clave de deduplicación de cada canal (ver las funciones que arman los eventos).
const CHANNEL_PREFIXES = ["msg:%", "tg:%", `${MESSENGER_PREFIX}%`, `${INSTAGRAM_PREFIX}%`] as const;

function normalize(event: ClaimedEvent, now: Date): NormalizedMessage {
  if (event.dedupe_key.startsWith("tg:")) return normalizeTelegramEvent(event.payload, now);
  if (event.dedupe_key.startsWith(MESSENGER_PREFIX)) return normalizeMessagingEvent("messenger", event.payload, now);
  if (event.dedupe_key.startsWith(INSTAGRAM_PREFIX)) return normalizeMessagingEvent("instagram", event.payload, now);
  return normalizeWhatsAppEvent(event.payload, now);
}

// Procesa el mensaje de un evento: lo guarda con su contacto, conversación y ventana de crédito.
// Devuelve true si creó el mensaje y false si ya existía (reproceso).
async function processMessageEvent(
  admin: SupabaseClient<Database>,
  event: ClaimedEvent,
  now: Date,
  modelClient: ModelClient | null,
  transcriber: TranscriptionClient | null,
  fetchImpl?: FetchLike,
): Promise<boolean> {
  if (!event.organization_id) {
    throw new Error("Evento sin organización");
  }

  const message = normalize(event, now);

  const { data: channel, error: channelError } = await admin
    .from("channels")
    .select("id, secret_ref, config")
    .eq("organization_id", event.organization_id)
    .eq("type", message.channelType)
    .eq("external_id", message.channelExternalId)
    .maybeSingle();

  if (channelError) throw new Error(`No se pudo consultar el canal: ${channelError.message}`);
  if (!channel) throw new Error(`Canal no encontrado: ${message.channelType} ${message.channelExternalId}`);

  const { data: messageId, error } = await admin.rpc("ingest_inbound_message", {
    p_organization_id: event.organization_id,
    p_channel_id: channel.id,
    p_channel_type: message.channelType,
    p_identifier: message.identifier,
    p_contact_name: message.contactName ?? "",
    p_external_id: message.externalId,
    p_type: message.type,
    p_body: message.body ?? "",
    p_provider_timestamp: message.providerTimestamp,
    p_raw: message.raw,
  });

  if (error) throw new Error(`No se pudo guardar el mensaje: ${error.message}`);

  // El adjunto se descarga también al reprocesar: si falló la vez anterior, el mensaje ya existe
  // (la función de guardado devuelve null) pero el archivo todavía no. Si falla, el evento queda
  // con su error y se reintenta; el mensaje ya está guardado y no se duplica.
  let storedMessageId: string | null = null;
  if (message.media) {
    if (message.channelType === "telegram") {
      storedMessageId = await storeMessageMedia(admin, event.organization_id, message, message.media, channel.secret_ref, fetchImpl);
    } else {
      // En los canales de Meta la dirección del archivo caduca: reintentar durante horas no sirve y dejaría al asociado
      // sin respuesta. Si no se puede bajar, el mensaje queda guardado, el agente lo ve sin adjunto y le pide que lo reenvíe.
      storedMessageId = await storeMessageMedia(admin, event.organization_id, message, message.media, channel.secret_ref, fetchImpl).catch((error: unknown) => {
        console.error("adjunto:", message.channelType, error instanceof Error ? error.message : "Error desconocido");
        return null;
      });
    }
  }

  // Un audio se transcribe antes de que el agente responda, así lo entiende como si fuera texto.
  if (storedMessageId && message.type === "audio" && transcriber) {
    await transcribeSafely(admin, transcriber, storedMessageId);
  }

  const created = messageId !== null;

  // Messenger e Instagram no mandan el nombre en el webhook: se pide una sola vez, cuando la ficha todavía no lo tiene.
  if (created && (message.channelType === "messenger" || message.channelType === "instagram")) {
    await fillContactName(admin, event.organization_id, message, channel, fetchImpl).catch((error: unknown) => {
      console.error("nombre del contacto:", error instanceof Error ? error.message : "Error desconocido");
    });
  }

  // "STOP" y frases equivalentes: se registra la baja y se confirma; el agente no contesta ese mensaje (ADR-038).
  if (created && messageId && message.type === "text" && isOptOutKeyword(message.body)) {
    const handled = await handleOptOutKeyword(admin, { messageId, now }).catch((error: unknown) => {
      console.error("baja por palabra clave:", error instanceof Error ? error.message : "Error desconocido");
      return false;
    });
    if (handled) return created;
  }

  // El agente responde también al reprocesar: si una corrida se cortó entre guardar el mensaje y responder, el
  // reintento ve el mensaje como duplicado y el asociado se quedaba sin respuesta. respondToMessage no contesta
  // dos veces: solo responde si lo último de la conversación sigue siendo del asociado.
  if (modelClient) {
    const replyTo = messageId ?? (await findMessageId(admin, event.organization_id, message.externalId));
    if (replyTo) await replyWithAgent(admin, modelClient, replyTo, now, fetchImpl);
  }

  return created;
}

async function fillContactName(
  admin: SupabaseClient<Database>,
  organizationId: string,
  message: NormalizedMessage,
  channel: { secret_ref: string | null; config: Json },
  fetchImpl?: FetchLike,
): Promise<void> {
  if (message.channelType !== "messenger" && message.channelType !== "instagram") return;

  const { data: identity } = await admin
    .from("contact_identities")
    .select("contact_id, contacts(display_name)")
    .eq("organization_id", organizationId)
    .eq("channel_type", message.channelType)
    .eq("identifier", message.identifier)
    .maybeSingle();
  if (!identity || identity.contacts?.display_name) return;

  const name = await fetchProfileName({
    channel: message.channelType,
    token: channelToken(channel.secret_ref),
    personId: message.identifier,
    api: instagramApiFrom(channel.config),
    fetchImpl,
  });
  if (name) await admin.from("contacts").update({ display_name: name }).eq("id", identity.contact_id).is("display_name", null);
}

async function findMessageId(admin: SupabaseClient<Database>, organizationId: string, externalId: string): Promise<string | null> {
  const { data } = await admin.from("messages").select("id").eq("organization_id", organizationId).eq("external_id", externalId).maybeSingle();
  return data?.id ?? null;
}

async function storeMessageMedia(
  admin: SupabaseClient<Database>,
  organizationId: string,
  message: NormalizedMessage,
  media: MediaRef,
  secretRef: string | null,
  fetchImpl?: FetchLike,
): Promise<string> {
  const { data: stored, error } = await admin
    .from("messages")
    .select("id, conversation_id")
    .eq("organization_id", organizationId)
    .eq("external_id", message.externalId)
    .maybeSingle();
  if (error || !stored) throw new Error("No se encontró el mensaje para guardar su adjunto");

  const params = { organizationId, conversationId: stored.conversation_id, messageId: stored.id, media, fetchImpl };
  if (message.channelType === "telegram") {
    await storeTelegramMedia(admin, { ...params, token: channelToken(secretRef) });
  } else if (message.channelType === "whatsapp") {
    await storeWhatsAppMedia(admin, { ...params, token: channelToken(secretRef), graphBase: graphBase() });
  } else {
    // Messenger e Instagram: la dirección del archivo ya trae su propia autorización.
    await storeUrlMedia(admin, { ...params, token: "" });
  }

  return stored.id;
}

// Un fallo del servicio de transcripción no invalida el mensaje, que ya quedó guardado: el agente verá el
// audio sin transcribir y le pedirá al asociado que escriba. Solo el motivo, nunca el contenido.
async function transcribeSafely(
  admin: SupabaseClient<Database>,
  transcriber: TranscriptionClient,
  messageId: string,
): Promise<void> {
  try {
    await transcribeAudioMessage(admin, transcriber, messageId);
  } catch (error) {
    console.error("transcripción:", error instanceof Error ? error.message : "Error desconocido");
  }
}

// El agente de atención contesta el mensaje recién guardado. Un fallo acá no invalida el mensaje
// recibido, que ya quedó guardado: se informa el motivo (nunca el contenido) y se sigue.
async function replyWithAgent(
  admin: SupabaseClient<Database>,
  modelClient: ModelClient,
  messageId: string,
  now: Date,
  fetchImpl?: FetchLike,
): Promise<void> {
  try {
    const { data: stored } = await admin.from("messages").select("conversation_id").eq("id", messageId).maybeSingle();
    if (!stored) return;

    const result = await respondToMessage(admin, modelClient, { conversationId: stored.conversation_id, messageId, now, fetchImpl });
    if (result.status === "failed") console.error("agente:", result.reason);
  } catch (error) {
    console.error("agente:", error instanceof Error ? error.message : "Error desconocido");
  }
}

// Toma lotes de mensajes pendientes de todos los canales y los procesa uno por uno. Un evento que
// falla no frena a los demás: queda con su error y se reintenta (hasta 5 veces, ver
// claim_webhook_events).
export async function processPendingMessages(
  admin: SupabaseClient<Database>,
  limit = 20,
  now: Date = new Date(),
  // Por defecto, el cliente real si hay clave; null = sin agente (las pruebas lo usan).
  modelClient: ModelClient | null = anthropicClientFromEnv(),
  // Por defecto, el transcriptor configurado (hoy ninguno); null = audios sin transcribir.
  transcriber: TranscriptionClient | null = transcriptionClientFromEnv(),
  // Para las llamadas a Meta (adjuntos, nombre del contacto): las pruebas pasan uno falso.
  fetchImpl?: FetchLike,
): Promise<ProcessResult> {
  const result: ProcessResult = { claimed: 0, processed: 0, duplicates: 0, failed: 0 };

  for (const prefix of CHANNEL_PREFIXES) {
    const { data: claimed, error: claimError } = await admin.rpc("claim_webhook_events", {
      p_prefix: prefix,
      p_limit: limit,
    });

    if (claimError) {
      throw new Error(`No se pudo tomar el lote de eventos: ${claimError.message}`);
    }

    result.claimed += claimed?.length ?? 0;

    for (const event of claimed ?? []) {
      try {
        const created = await processMessageEvent(admin, event, now, modelClient, transcriber, fetchImpl);
        if (created) result.processed += 1;
        else result.duplicates += 1;

        await admin
          .from("webhook_events")
          .update({ processed_at: new Date().toISOString(), error: null })
          .eq("id", event.id);
      } catch (error) {
        result.failed += 1;
        // Solo el motivo, nunca el contenido del mensaje: tiene datos personales.
        const reason = error instanceof Error ? error.message : "Error desconocido";
        await admin.from("webhook_events").update({ error: reason }).eq("id", event.id);
      }
    }
  }

  // Avisos de estado de WhatsApp (enviado, entregado, leído, fallido): actualizan el mensaje que mandó el sistema.
  // Si uno falla queda con su error y se reintenta; no frena a los mensajes.
  const { data: statuses } = await admin.rpc("claim_webhook_events", { p_prefix: "status:%", p_limit: limit });
  for (const event of statuses ?? []) {
    try {
      await applyWhatsAppStatuses(admin, [event]);
      await admin.from("webhook_events").update({ processed_at: new Date().toISOString(), error: null }).eq("id", event.id);
    } catch (error) {
      await admin.from("webhook_events").update({ error: error instanceof Error ? error.message : "Error desconocido" }).eq("id", event.id);
    }
  }

  return result;
}
