import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";

type MessageStatus = Database["public"]["Enums"]["message_status"];

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// El estado de un mensaje solo avanza: queued → sent → delivered → read. Meta puede entregar los avisos fuera de orden
// (un "sent" que llega después del "delivered"): no debe retroceder el estado.
const RANK: Record<MessageStatus, number> = { queued: 0, sent: 1, delivered: 2, read: 3, failed: 99 };

export type StatusEvent = { organization_id: string | null; payload: Json };

// Aplica los avisos de estado de WhatsApp (enviado, entregado, leído, fallido) a los mensajes que mandó el sistema.
// Un aviso de un mensaje que no existe (o de otra organización) se ignora. Devuelve cuántos mensajes cambiaron.
export async function applyWhatsAppStatuses(admin: SupabaseClient<Database>, events: StatusEvent[]): Promise<number> {
  let changed = 0;

  for (const event of events) {
    const status = isRecord(event.payload) && isRecord(event.payload.status) ? event.payload.status : null;
    const externalId = status && typeof status.id === "string" ? status.id : null;
    const next = status && typeof status.status === "string" ? (status.status as MessageStatus) : null;
    if (!event.organization_id || !externalId || !next || !(next in RANK)) continue;

    const { data: message } = await admin
      .from("messages")
      .select("id, status")
      .eq("organization_id", event.organization_id)
      .eq("external_id", externalId)
      .eq("direction", "outbound")
      .maybeSingle();
    if (!message) continue;

    // Un mensaje ya fallido no se "recupera" por un aviso suelto, y uno leído no vuelve a "entregado".
    if (message.status === "failed" || (next !== "failed" && RANK[next] <= RANK[message.status])) continue;

    const errors: unknown[] = status && Array.isArray(status.errors) ? status.errors : [];
    const first: JsonRecord = isRecord(errors[0]) ? errors[0] : {};
    const detail =
      next === "failed"
        ? { code: typeof first.code === "number" ? first.code : null, message: typeof first.title === "string" ? first.title.slice(0, 200) : "WhatsApp no pudo entregar el mensaje" }
        : null;

    const { error } = await admin
      .from("messages")
      .update({ status: next, status_updated_at: new Date().toISOString(), ...(detail ? { error: detail as Json } : {}) })
      .eq("id", message.id);
    if (error) throw new Error(`No se pudo actualizar el estado del mensaje: ${error.message}`);
    changed += 1;
  }

  return changed;
}
