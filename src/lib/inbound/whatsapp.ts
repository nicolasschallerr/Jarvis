import type { Json } from "@/lib/supabase/database.types";

import type { MessageType, NormalizedMessage } from "./types";

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

// Arma el mensaje común a partir de lo que guardó el webhook: { metadata, contact, message }.
export function normalizeWhatsAppEvent(payload: Json, now: Date): NormalizedMessage {
  if (!isRecord(payload)) {
    throw new Error("Carga inválida");
  }

  const { metadata, contact, message } = payload;
  if (!isRecord(metadata) || !isRecord(message)) {
    throw new Error("El evento no trae metadata o mensaje");
  }

  const phoneNumberId = asString(metadata.phone_number_id);
  const waId = asString(message.from);
  const externalId = asString(message.id);
  if (!phoneNumberId || !waId || !externalId) {
    throw new Error("Faltan phone_number_id, remitente o id del mensaje");
  }

  return {
    channelType: "whatsapp",
    channelExternalId: phoneNumberId,
    identifier: waId,
    contactName: isRecord(contact) && isRecord(contact.profile) ? asString(contact.profile.name) : null,
    externalId,
    type: mapMessageType(asString(message.type)),
    body: extractBody(message),
    providerTimestamp: parseProviderTimestamp(message.timestamp, now),
    // La descarga de adjuntos de WhatsApp se implementa en la Fase 14.
    media: null,
    raw: message as Json,
  };
}
