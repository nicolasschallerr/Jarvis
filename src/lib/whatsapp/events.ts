import type { Json } from "@/lib/supabase/database.types";

// Un evento ya separado del sobre que manda Meta: o un mensaje entrante o un cambio de estado
// de un mensaje saliente. Cada uno lleva una clave de deduplicación: Meta reintenta durante
// días y puede mandar el mismo evento más de una vez.
export type WhatsAppEvent = {
  kind: "message" | "status";
  phoneNumberId: string;
  dedupeKey: string;
  payload: Json;
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

// Estructura documentada por Meta (campo "messages"):
//   object -> entry[] -> changes[] -> value { metadata.phone_number_id, contacts[], messages[], statuses[] }
// Todo lo que no encaje (otros campos, datos incompletos) se ignora en vez de romper la recepción.
export function extractEvents(body: unknown): WhatsAppEvent[] {
  if (!isRecord(body) || body.object !== "whatsapp_business_account") {
    return [];
  }

  const events: WhatsAppEvent[] = [];

  for (const entry of asArray(body.entry)) {
    if (!isRecord(entry)) continue;

    for (const change of asArray(entry.changes)) {
      if (!isRecord(change) || change.field !== "messages" || !isRecord(change.value)) {
        continue;
      }

      const value = change.value;
      const metadata = isRecord(value.metadata) ? value.metadata : null;
      const phoneNumberId = metadata ? asString(metadata.phone_number_id) : null;
      if (!metadata || !phoneNumberId) continue;

      const contacts = asArray(value.contacts).filter(isRecord);

      for (const message of asArray(value.messages)) {
        if (!isRecord(message)) continue;
        const id = asString(message.id);
        if (!id) continue;

        const contact = contacts.find((candidate) => candidate.wa_id === message.from) ?? null;
        events.push({
          kind: "message",
          phoneNumberId,
          dedupeKey: `msg:${id}`,
          payload: { metadata, contact, message } as Json,
        });
      }

      for (const status of asArray(value.statuses)) {
        if (!isRecord(status)) continue;
        const id = asString(status.id);
        const state = asString(status.status);
        if (!id || !state) continue;

        // Un mismo mensaje pasa por varios estados (sent, delivered, read): la clave los distingue.
        events.push({
          kind: "status",
          phoneNumberId,
          dedupeKey: `status:${id}:${state}`,
          payload: { metadata, status } as Json,
        });
      }
    }
  }

  return events;
}
