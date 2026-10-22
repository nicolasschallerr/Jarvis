import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";

type MessageType = Database["public"]["Enums"]["message_type"];

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

const KNOWN_TYPES: ReadonlySet<string> = new Set([
  "text",
  "audio",
  "image",
  "document",
  "video",
  "sticker",
  "location",
  "interactive",
  "reaction",
]);

// Los tipos que Meta manda y que Jarvis todavía no entiende quedan como "unsupported": se guardan
// igual (con su carga cruda) para no perder el mensaje.
export function mapMessageType(type: string | null): MessageType {
  return type !== null && KNOWN_TYPES.has(type) ? (type as MessageType) : "unsupported";
}

// Texto legible del mensaje: el cuerpo si es texto, la leyenda si es multimedia, o el título de la
// opción elegida en un mensaje interactivo. Los audios no tienen texto hasta transcribirlos.
export function extractBody(message: JsonRecord): string | null {
  const type = asString(message.type);
  if (!type) return null;

  const content = message[type];
  if (!isRecord(content)) return null;

  if (type === "text") return asString(content.body);
  if (type === "image" || type === "video" || type === "document") return asString(content.caption);

  if (type === "interactive") {
    const reply = content.button_reply ?? content.list_reply;
    return isRecord(reply) ? asString(reply.title) : null;
  }

  if (type === "reaction") return asString(content.emoji);

  return null;
}

// Meta manda la hora en segundos desde 1970, como texto.
export function parseProviderTimestamp(value: unknown, fallback: Date): string {
  const seconds = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return fallback.toISOString();
  }
  return new Date(seconds * 1000).toISOString();
}

type ClaimedEvent = {
  id: string;
  organization_id: string | null;
  payload: Json;
};

export type ProcessResult = {
  claimed: number;
  processed: number;
  duplicates: number;
  failed: number;
};

// Procesa el mensaje de un evento: lo guarda con su contacto, conversación y ventana de crédito.
// Devuelve true si creó el mensaje y false si ya existía (reproceso).
async function processMessageEvent(
  admin: SupabaseClient<Database>,
  event: ClaimedEvent,
  now: Date,
): Promise<boolean> {
  if (!event.organization_id || !isRecord(event.payload)) {
    throw new Error("Evento sin organización o con carga inválida");
  }

  const { metadata, contact, message } = event.payload;
  if (!isRecord(metadata) || !isRecord(message)) {
    throw new Error("El evento no trae metadata o mensaje");
  }

  const phoneNumberId = asString(metadata.phone_number_id);
  const waId = asString(message.from);
  const externalId = asString(message.id);
  if (!phoneNumberId || !waId || !externalId) {
    throw new Error("Faltan phone_number_id, remitente o id del mensaje");
  }

  const { data: channel, error: channelError } = await admin
    .from("channels")
    .select("id")
    .eq("organization_id", event.organization_id)
    .eq("type", "whatsapp")
    .eq("external_id", phoneNumberId)
    .maybeSingle();

  if (channelError) throw new Error(`No se pudo consultar el canal: ${channelError.message}`);
  if (!channel) throw new Error(`Canal no encontrado: ${phoneNumberId}`);

  const contactName = isRecord(contact) && isRecord(contact.profile) ? asString(contact.profile.name) : null;

  const { data: messageId, error } = await admin.rpc("ingest_inbound_message", {
    p_organization_id: event.organization_id,
    p_channel_id: channel.id,
    p_wa_id: waId,
    p_contact_name: contactName ?? "",
    p_external_id: externalId,
    p_type: mapMessageType(asString(message.type)),
    p_body: extractBody(message) ?? "",
    p_provider_timestamp: parseProviderTimestamp(message.timestamp, now),
    p_raw: message as Json,
  });

  if (error) throw new Error(`No se pudo guardar el mensaje: ${error.message}`);

  return messageId !== null;
}

// Toma un lote de mensajes pendientes y los procesa uno por uno. Un evento que falla no frena a
// los demás: queda con su error y se reintenta (hasta 5 veces, ver claim_webhook_events).
export async function processPendingMessages(
  admin: SupabaseClient<Database>,
  limit = 20,
  now: Date = new Date(),
): Promise<ProcessResult> {
  const { data: claimed, error: claimError } = await admin.rpc("claim_webhook_events", {
    p_prefix: "msg:%",
    p_limit: limit,
  });

  if (claimError) {
    throw new Error(`No se pudo tomar el lote de eventos: ${claimError.message}`);
  }

  const result: ProcessResult = { claimed: claimed?.length ?? 0, processed: 0, duplicates: 0, failed: 0 };

  for (const event of claimed ?? []) {
    try {
      const created = await processMessageEvent(admin, event, now);
      if (created) result.processed += 1;
      else result.duplicates += 1;

      await admin
        .from("webhook_events")
        .update({ processed_at: new Date().toISOString(), error: null })
        .eq("id", event.id);
    } catch (error) {
      result.failed += 1;
      // Solo el motivo, nunca el contenido del mensaje: tiene datos personales.
      const message = error instanceof Error ? error.message : "Error desconocido";
      await admin.from("webhook_events").update({ error: message }).eq("id", event.id);
    }
  }

  return result;
}
