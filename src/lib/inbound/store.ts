import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import type { InboundEvent } from "./types";

// Guarda los eventos en webhook_events, que funciona como bandeja de entrada durable: lo que
// tiene processed_at vacío está pendiente para el trabajador. Es idempotente: si un evento ya
// estaba guardado (reintento del proveedor), se ignora sin error. Sirve para cualquier canal.
export async function storeEvents(
  admin: SupabaseClient<Database>,
  events: InboundEvent[],
): Promise<{ received: number }> {
  if (events.length === 0) {
    return { received: 0 };
  }

  // El identificador del canal en el proveedor determina la organización.
  const externalIds = [...new Set(events.map((event) => event.channelExternalId))];
  const { data: channels, error: channelsError } = await admin
    .from("channels")
    .select("organization_id, type, external_id")
    .in("external_id", externalIds);

  if (channelsError) {
    throw new Error(`No se pudieron consultar los canales: ${channelsError.message}`);
  }

  const organizationByChannel = new Map(
    (channels ?? []).map((channel) => [`${channel.type}:${channel.external_id}`, channel.organization_id]),
  );

  const now = new Date().toISOString();
  const rows = events.map((event) => {
    const organizationId = organizationByChannel.get(`${event.channelType}:${event.channelExternalId}`) ?? null;
    return {
      organization_id: organizationId,
      channel_type: event.channelType,
      dedupe_key: event.dedupeKey,
      payload: event.payload,
      // Un canal sin registrar no se puede asignar a ninguna organización: se guarda para auditar
      // pero se marca como procesado, así el trabajador no lo toma.
      processed_at: organizationId ? null : now,
      error: organizationId ? null : `Canal no registrado: ${event.channelType} ${event.channelExternalId}`,
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
