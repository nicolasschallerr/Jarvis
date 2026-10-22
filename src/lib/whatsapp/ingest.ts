import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import type { WhatsAppEvent } from "./events";

// Guarda los eventos en webhook_events, que funciona como bandeja de entrada durable: lo que
// tiene processed_at vacío está pendiente para el trabajador. Es idempotente: si un evento ya
// estaba guardado (reintento de Meta), se ignora sin error.
export async function storeEvents(
  admin: SupabaseClient<Database>,
  events: WhatsAppEvent[],
): Promise<{ received: number }> {
  if (events.length === 0) {
    return { received: 0 };
  }

  // El phone_number_id que manda Meta identifica el canal y, por lo tanto, la organización.
  const phoneNumberIds = [...new Set(events.map((event) => event.phoneNumberId))];
  const { data: channels, error: channelsError } = await admin
    .from("channels")
    .select("organization_id, external_id")
    .eq("type", "whatsapp")
    .in("external_id", phoneNumberIds);

  if (channelsError) {
    throw new Error(`No se pudieron consultar los canales: ${channelsError.message}`);
  }

  const organizationByNumber = new Map(
    (channels ?? []).map((channel) => [channel.external_id, channel.organization_id]),
  );

  const now = new Date().toISOString();
  const rows = events.map((event) => {
    const organizationId = organizationByNumber.get(event.phoneNumberId) ?? null;
    return {
      organization_id: organizationId,
      channel_type: "whatsapp" as const,
      dedupe_key: event.dedupeKey,
      payload: event.payload,
      // Un número sin canal registrado no se puede asignar a ninguna organización: se guarda
      // para auditar pero se marca como procesado, así el trabajador no lo toma.
      processed_at: organizationId ? null : now,
      error: organizationId ? null : `Canal no registrado: ${event.phoneNumberId}`,
    };
  });

  const { error } = await admin
    .from("webhook_events")
    .upsert(rows, { onConflict: "channel_type,dedupe_key", ignoreDuplicates: true });

  if (error) {
    throw new Error(`No se pudieron guardar los eventos: ${error.message}`);
  }

  return { received: events.length };
}
