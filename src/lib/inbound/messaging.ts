import type { Json } from "@/lib/supabase/database.types";

import type { MediaRef, MessageType, NormalizedMessage } from "./types";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Tipo del adjunto de Messenger e Instagram -> tipo común. Lo que no se entiende (compartidos, reels, respuestas a
// historias...) queda como "unsupported" con su carga cruda, para no perder el mensaje.
const ATTACHMENT_TYPES: Record<string, MessageType> = {
  image: "image",
  audio: "audio",
  video: "video",
  file: "document",
  location: "location",
};

const MIME_BY_TYPE: Record<string, string> = { image: "image/jpeg", audio: "audio/mp4", video: "video/mp4" };

function firstAttachment(message: JsonRecord): JsonRecord | null {
  const first = Array.isArray(message.attachments) ? message.attachments[0] : null;
  return isRecord(first) ? first : null;
}

// El timestamp de Messenger e Instagram viene en milisegundos desde 1970.
function parseTimestamp(value: unknown, fallback: Date): string {
  const millis = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(millis) && millis > 0 ? new Date(millis).toISOString() : fallback.toISOString();
}

// Arma el mensaje común a partir de lo que guardó el webhook: { sender, recipient, timestamp, message }.
export function normalizeMessagingEvent(channelType: "messenger" | "instagram", payload: Json, now: Date): NormalizedMessage {
  if (!isRecord(payload) || !isRecord(payload.message) || !isRecord(payload.sender) || !isRecord(payload.recipient)) {
    throw new Error("El evento no trae remitente, destinatario o mensaje");
  }

  const message = payload.message;
  const senderId = asString(payload.sender.id);
  const recipientId = asString(payload.recipient.id);
  const externalId = asString(message.mid);
  if (!senderId || !recipientId || !externalId) throw new Error("Faltan el remitente, la cuenta o el id del mensaje");

  const attachment = firstAttachment(message);
  const attachmentType = attachment ? asString(attachment.type) : null;
  const text = asString(message.text);

  // Una foto con leyenda llega con texto y adjunto: el tipo es el del adjunto y el texto queda como leyenda (igual que en
  // WhatsApp). Si trae varios adjuntos se toma el primero; el resto no se guarda todavía.
  let type: MessageType = text ? "text" : "unsupported";
  let media: MediaRef | null = null;
  if (attachmentType) {
    const attachmentKind = ATTACHMENT_TYPES[attachmentType] ?? "unsupported";
    if (attachmentKind !== "unsupported" || !text) type = attachmentKind;
    const url = isRecord(attachment?.payload) ? asString(attachment.payload.url) : null;
    if (url && attachmentKind !== "unsupported" && attachmentKind !== "location") {
      media = { providerMediaId: url, url, mimeType: MIME_BY_TYPE[attachmentType] ?? null, fileName: null, sizeBytes: null };
    }
  }

  return {
    channelType,
    channelExternalId: recipientId,
    identifier: senderId,
    // Ni Messenger ni Instagram mandan el nombre en el webhook: se pide aparte al recibir el primer mensaje.
    contactName: null,
    externalId,
    type,
    body: text,
    providerTimestamp: parseTimestamp(payload.timestamp, now),
    media,
    raw: message as Json,
  };
}
