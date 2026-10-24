import type { SupabaseClient } from "@supabase/supabase-js";

import { respondToMessage } from "@/lib/agent/attention";
import { anthropicClientFromEnv } from "@/lib/ai/anthropic-client";
import type { ModelClient } from "@/lib/ai/types";
import type { Database, Json } from "@/lib/supabase/database.types";

import { storeTelegramMedia } from "./media";
import { normalizeTelegramEvent } from "./telegram";
import type { MediaRef, NormalizedMessage } from "./types";
import { normalizeWhatsAppEvent } from "./whatsapp";

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
const CHANNEL_PREFIXES = ["msg:%", "tg:%"] as const;

function normalize(event: ClaimedEvent, now: Date): NormalizedMessage {
  return event.dedupe_key.startsWith("tg:")
    ? normalizeTelegramEvent(event.payload, now)
    : normalizeWhatsAppEvent(event.payload, now);
}

// Procesa el mensaje de un evento: lo guarda con su contacto, conversación y ventana de crédito.
// Devuelve true si creó el mensaje y false si ya existía (reproceso).
async function processMessageEvent(
  admin: SupabaseClient<Database>,
  event: ClaimedEvent,
  now: Date,
  modelClient: ModelClient | null,
): Promise<boolean> {
  if (!event.organization_id) {
    throw new Error("Evento sin organización");
  }

  const message = normalize(event, now);

  const { data: channel, error: channelError } = await admin
    .from("channels")
    .select("id, secret_ref")
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
  if (message.media && message.channelType === "telegram") {
    await storeMessageMedia(admin, event.organization_id, message, message.media, channel.secret_ref);
  }

  const created = messageId !== null;
  if (created && modelClient) {
    await replyWithAgent(admin, modelClient, messageId, now);
  }

  return created;
}

async function storeMessageMedia(
  admin: SupabaseClient<Database>,
  organizationId: string,
  message: NormalizedMessage,
  media: MediaRef,
  secretRef: string | null,
): Promise<void> {
  const token = secretRef ? process.env[secretRef] : undefined;
  if (!token) throw new Error(`Falta la variable de entorno del canal (${secretRef ?? "sin secret_ref"})`);

  const { data: stored, error } = await admin
    .from("messages")
    .select("id, conversation_id")
    .eq("organization_id", organizationId)
    .eq("external_id", message.externalId)
    .maybeSingle();
  if (error || !stored) throw new Error("No se encontró el mensaje para guardar su adjunto");

  await storeTelegramMedia(admin, {
    organizationId,
    conversationId: stored.conversation_id,
    messageId: stored.id,
    token,
    media,
  });
}

// El agente de atención contesta el mensaje recién guardado. Un fallo acá no invalida el mensaje
// recibido, que ya quedó guardado: se informa el motivo (nunca el contenido) y se sigue.
async function replyWithAgent(
  admin: SupabaseClient<Database>,
  modelClient: ModelClient,
  messageId: string,
  now: Date,
): Promise<void> {
  try {
    const { data: stored } = await admin.from("messages").select("conversation_id").eq("id", messageId).maybeSingle();
    if (!stored) return;

    const result = await respondToMessage(admin, modelClient, { conversationId: stored.conversation_id, messageId, now });
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
        const created = await processMessageEvent(admin, event, now, modelClient);
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

  return result;
}
