import type { Json } from "@/lib/supabase/database.types";

import type { InboundEvent, MessageType, NormalizedMessage } from "./types";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

// Extrae el mensaje de un "update" de Telegram. Solo se atienden mensajes nuevos en chats
// privados con una persona: se ignoran grupos, canales, bots y mensajes editados. La clave de
// deduplicación es update_id, que Telegram garantiza único y creciente.
export function extractTelegramEvents(update: unknown, botId: string): InboundEvent[] {
  if (!isRecord(update)) return [];

  const updateId = asInteger(update.update_id);
  const message = update.message;
  if (updateId === null || !isRecord(message)) return [];

  const chat = message.chat;
  if (!isRecord(chat) || chat.type !== "private" || asInteger(chat.id) === null) return [];
  if (asInteger(message.message_id) === null) return [];

  const sender = message.from;
  if (isRecord(sender) && sender.is_bot === true) return [];

  return [
    {
      channelType: "telegram",
      channelExternalId: botId,
      dedupeKey: `tg:${updateId}`,
      payload: { botId, message } as Json,
    },
  ];
}

// Tipo de mensaje común según qué campo trae el mensaje de Telegram.
export function mapTelegramType(message: JsonRecord): MessageType {
  if (typeof message.text === "string") return "text";
  if (isRecord(message.voice) || isRecord(message.audio)) return "audio";
  if (Array.isArray(message.photo)) return "image";
  if (isRecord(message.document)) return "document";
  if (isRecord(message.video) || isRecord(message.video_note)) return "video";
  if (isRecord(message.sticker)) return "sticker";
  if (isRecord(message.location)) return "location";
  return "unsupported";
}

function contactName(sender: unknown): string | null {
  if (!isRecord(sender)) return null;
  const fullName = [asString(sender.first_name), asString(sender.last_name)].filter(Boolean).join(" ");
  return fullName || asString(sender.username);
}

// Arma el mensaje común a partir de lo que guardó el webhook: { botId, message }.
export function normalizeTelegramEvent(payload: Json, now: Date): NormalizedMessage {
  if (!isRecord(payload)) {
    throw new Error("Carga inválida");
  }

  const botId = asString(payload.botId);
  const message = payload.message;
  if (!botId || !isRecord(message) || !isRecord(message.chat)) {
    throw new Error("El evento no trae bot, mensaje o chat");
  }

  const chatId = asInteger(message.chat.id);
  const messageId = asInteger(message.message_id);
  if (chatId === null || messageId === null) {
    throw new Error("Faltan el id del chat o del mensaje");
  }

  const seconds = asInteger(message.date);

  return {
    channelType: "telegram",
    channelExternalId: botId,
    identifier: String(chatId),
    contactName: contactName(message.from),
    // message_id es único solo dentro de un chat: se combina con el id del chat.
    externalId: `${chatId}:${messageId}`,
    type: mapTelegramType(message),
    body: asString(message.text) ?? asString(message.caption),
    providerTimestamp: seconds && seconds > 0 ? new Date(seconds * 1000).toISOString() : now.toISOString(),
    raw: message as Json,
  };
}
