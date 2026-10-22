import type { Database, Json } from "@/lib/supabase/database.types";

export type ChannelType = Database["public"]["Enums"]["channel_type"];
export type MessageType = Database["public"]["Enums"]["message_type"];

// Un evento entrante ya separado del sobre de cada proveedor, listo para guardarse en la bandeja
// (webhook_events). dedupeKey evita procesarlo dos veces si el proveedor reintenta.
export type InboundEvent = {
  channelType: ChannelType;
  // Identificador del canal en el proveedor: phone_number_id (WhatsApp) o id del bot (Telegram).
  channelExternalId: string;
  dedupeKey: string;
  payload: Json;
};

// Un mensaje entrante en una forma común a todos los canales. Cada canal tiene su "normalizador"
// que lo arma; el resto del sistema (guardado, créditos, agente) no sabe de qué canal vino.
export type NormalizedMessage = {
  channelType: ChannelType;
  channelExternalId: string;
  // Cómo se identifica al contacto en ese canal (teléfono en WhatsApp, id de chat en Telegram).
  identifier: string;
  contactName: string | null;
  externalId: string;
  type: MessageType;
  body: string | null;
  providerTimestamp: string;
  raw: Json;
};
