import type { Database, Json } from "@/lib/supabase/database.types";

export type ChannelType = Database["public"]["Enums"]["channel_type"];
export type MessageType = Database["public"]["Enums"]["message_type"];

// Un evento entrante ya separado del sobre de cada proveedor, listo para guardarse en la bandeja
// (webhook_events). dedupeKey evita procesarlo dos veces si el proveedor reintenta.
export type InboundEvent = {
  channelType: ChannelType;
  // Identificador del canal en el proveedor: phone_number_id (WhatsApp), id de la página (Messenger), id de la cuenta
  // (Instagram) o id del bot (Telegram).
  channelExternalId: string;
  dedupeKey: string;
  payload: Json;
};

// Archivo adjunto de un mensaje entrante, aún sin descargar.
export type MediaRef = {
  // Identificador para pedírselo al proveedor (file_id en Telegram, id del archivo en WhatsApp).
  providerMediaId: string;
  // Messenger e Instagram mandan directamente la dirección de descarga (de corta vida) en vez de un identificador.
  url?: string | null;
  mimeType: string | null;
  fileName: string | null;
  sizeBytes: number | null;
};

// Un mensaje entrante en una forma común a todos los canales. Cada canal tiene su "normalizador"
// que lo arma; el resto del sistema (guardado, créditos, agente) no sabe de qué canal vino.
export type NormalizedMessage = {
  channelType: ChannelType;
  channelExternalId: string;
  // Cómo se identifica al contacto en ese canal (teléfono en WhatsApp, id de chat en Telegram, id de la persona para
  // esa página o cuenta en Messenger e Instagram).
  identifier: string;
  contactName: string | null;
  externalId: string;
  type: MessageType;
  body: string | null;
  providerTimestamp: string;
  media: MediaRef | null;
  raw: Json;
};
