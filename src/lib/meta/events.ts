import type { InboundEvent } from "@/lib/inbound/types";
import type { Json } from "@/lib/supabase/database.types";

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Prefijos de la clave de deduplicación de cada canal (el trabajador toma los eventos por prefijo).
export const MESSENGER_PREFIX = "fb:";
export const INSTAGRAM_PREFIX = "ig:";

// Messenger (objeto "page") e Instagram (objeto "instagram") mandan la misma forma:
//   object -> entry[] (id = página o cuenta de Instagram) -> messaging[] { sender.id, recipient.id, timestamp, message }
// Solo interesan los mensajes que escribe la persona. Se ignoran los ecos (lo que manda la propia página, que ya se
// guarda al enviarlo), las lecturas, las entregas, las reacciones y todo lo que no encaje, en vez de romper la recepción.
export function extractMessagingEvents(body: unknown): InboundEvent[] {
  if (!isRecord(body) || (body.object !== "page" && body.object !== "instagram")) return [];

  const channelType = body.object === "page" ? "messenger" : "instagram";
  const prefix = body.object === "page" ? MESSENGER_PREFIX : INSTAGRAM_PREFIX;
  const events: InboundEvent[] = [];

  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    if (!isRecord(entry)) continue;

    for (const item of Array.isArray(entry.messaging) ? entry.messaging : []) {
      if (!isRecord(item) || !isRecord(item.message)) continue;
      const message = item.message;
      if (message.is_echo === true) continue;

      const mid = asString(message.mid);
      const sender = isRecord(item.sender) ? asString(item.sender.id) : null;
      const recipient = isRecord(item.recipient) ? asString(item.recipient.id) : null;
      if (!mid || !sender || !recipient) continue;

      events.push({
        channelType,
        // La cuenta que recibe el mensaje (página o cuenta de Instagram): identifica al canal y a la organización.
        channelExternalId: recipient,
        dedupeKey: `${prefix}${mid}`,
        payload: { sender: { id: sender }, recipient: { id: recipient }, timestamp: item.timestamp ?? entry.time ?? null, message } as Json,
      });
    }
  }

  return events;
}
