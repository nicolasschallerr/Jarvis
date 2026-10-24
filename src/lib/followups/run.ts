import type { SupabaseClient } from "@supabase/supabase-js";

import { isWithinBusinessHours, type AttentionSettings } from "@/lib/agent/context";
import { loadAttentionAgent } from "@/lib/agent/load";
import { ChannelSendError, OutsideWindowError } from "@/lib/outbound/errors";
import { sendTextMessage } from "@/lib/outbound/send";
import type { Database } from "@/lib/supabase/database.types";

export type FollowupsResult = { scheduled: number; cancelled: number; sent: number; skipped: number; failed: number };

type Params = {
  now?: Date;
  // Solo para pruebas: reemplaza la llamada de red al canal.
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
};

const BATCH = 100;
const RETRY_DELAY_MS = 15 * 60 * 1000;

export const DEFAULT_FOLLOWUP_TEXT =
  "Hola, soy {{nombre_agente}} de {{nombre_organizacion}}. Te escribo por tu consulta, que quedó pendiente. ¿Querés que sigamos? Si ya no lo necesitás, avisanos y la cerramos.";

export function followupText(settings: AttentionSettings): string {
  const template = settings.followups.text ?? DEFAULT_FOLLOWUP_TEXT;
  return template
    .replace(/\{\{nombre_agente\}\}/g, settings.agentName)
    .replace(/\{\{nombre_organizacion\}\}/g, settings.organizationName)
    .trim();
}

// Configuración de seguimientos de una organización, o null si no corresponde enviar (agente apagado,
// sin configuración o seguimientos desactivados). Se guarda por organización para no repetir consultas.
async function settingsFor(
  admin: SupabaseClient<Database>,
  cache: Map<string, AttentionSettings | null>,
  organizationId: string,
): Promise<AttentionSettings | null> {
  if (cache.has(organizationId)) return cache.get(organizationId) ?? null;
  const loaded = await loadAttentionAgent(admin, organizationId);
  const settings = loaded.ok && loaded.agent.settings.followups.active && loaded.agent.settings.followups.hours.length > 0 ? loaded.agent.settings : null;
  cache.set(organizationId, settings);
  return settings;
}

// Seguimientos automáticos de las gestiones que esperan al asociado. Se ejecuta en cada pasada del
// trabajador, en tres pasos:
//
// 1. Programar: un caso en "esperando al asociado" recibe un recordatorio por cada hora configurada,
//    contada desde que quedó esperando.
// 2. Cancelar: si el asociado escribió después, o el caso ya no espera, los recordatorios pendientes
//    se cancelan.
// 3. Enviar: los vencidos salen por el mismo chat, solo dentro del horario de atención. Un envío que
//    falla se reintenta en la próxima pasada; fuera de la ventana de 24 h de WhatsApp queda "omitido"
//    (ahí hacen falta plantillas de Meta).
export async function runFollowups(admin: SupabaseClient<Database>, params: Params = {}): Promise<FollowupsResult> {
  const now = params.now ?? new Date();
  const result: FollowupsResult = { scheduled: 0, cancelled: 0, sent: 0, skipped: 0, failed: 0 };
  const cache = new Map<string, AttentionSettings | null>();

  await schedule(admin, cache, now, result);
  await cancelStale(admin, result);
  await sendDue(admin, cache, now, params.fetchImpl, result);

  return result;
}

async function schedule(
  admin: SupabaseClient<Database>,
  cache: Map<string, AttentionSettings | null>,
  now: Date,
  result: FollowupsResult,
): Promise<void> {
  const { data: waiting, error } = await admin
    .from("cases")
    .select("id, organization_id, contact_id, conversation_id, created_at")
    .eq("status", "waiting_contact")
    .not("conversation_id", "is", null)
    .limit(BATCH);
  if (error) throw new Error(`No se pudieron leer los casos en espera: ${error.message}`);

  for (const item of waiting ?? []) {
    const settings = await settingsFor(admin, cache, item.organization_id);
    if (!settings) continue;

    // Desde cuándo espera: el último cambio de estado a "esperando al asociado".
    const { data: events } = await admin
      .from("case_events")
      .select("created_at, data")
      .eq("case_id", item.id)
      .eq("event_type", "status_changed")
      .order("created_at", { ascending: false })
      .limit(20);
    const entered = events?.find((event) => (event.data as { to?: string } | null)?.to === "waiting_contact");
    const since = new Date(entered?.created_at ?? item.created_at);

    // Ya programado en este período de espera.
    const { count } = await admin
      .from("followups")
      .select("id", { count: "exact", head: true })
      .eq("case_id", item.id)
      .gte("created_at", since.toISOString());
    if ((count ?? 0) > 0) continue;

    // upsert: si el caso ya tuvo seguimientos en una espera anterior, se reinician (unique por caso y hora).
    const { error: upsertError } = await admin.from("followups").upsert(
      settings.followups.hours.map((hours) => ({
        organization_id: item.organization_id,
        case_id: item.id,
        conversation_id: item.conversation_id,
        contact_id: item.contact_id,
        step_hours: Math.round(hours),
        due_at: new Date(since.getTime() + hours * 3_600_000).toISOString(),
        status: "pending" as const,
        sent_at: null,
        message_id: null,
        created_at: now.toISOString(),
      })),
      { onConflict: "case_id,step_hours" },
    );
    if (upsertError) {
      result.failed += 1;
      continue;
    }
    result.scheduled += settings.followups.hours.length;
  }
}

async function cancelStale(admin: SupabaseClient<Database>, result: FollowupsResult): Promise<void> {
  const { data: pending, error } = await admin
    .from("followups")
    .select("id, due_at, step_hours, cases(status), conversations(last_inbound_at)")
    .eq("status", "pending")
    .order("due_at", { ascending: true })
    .limit(BATCH * 2);
  if (error) throw new Error(`No se pudieron leer los seguimientos pendientes: ${error.message}`);

  const stale = (pending ?? []).filter((followup) => {
    if (followup.cases?.status !== "waiting_contact") return true;
    // El asociado escribió después de que el caso quedó esperando: ya respondió. El inicio de la espera
    // es el vencimiento menos las horas del paso.
    const waitingSince = new Date(followup.due_at).getTime() - followup.step_hours * 3_600_000;
    const lastInbound = followup.conversations?.last_inbound_at;
    return Boolean(lastInbound && new Date(lastInbound).getTime() > waitingSince);
  });
  if (stale.length === 0) return;

  const { error: updateError } = await admin
    .from("followups")
    .update({ status: "cancelled" })
    .in("id", stale.map((followup) => followup.id))
    .eq("status", "pending");
  if (updateError) throw new Error(`No se pudieron cancelar seguimientos: ${updateError.message}`);
  result.cancelled += stale.length;
}

async function sendDue(
  admin: SupabaseClient<Database>,
  cache: Map<string, AttentionSettings | null>,
  now: Date,
  fetchImpl: Params["fetchImpl"],
  result: FollowupsResult,
): Promise<void> {
  const { data: due, error } = await admin
    .from("followups")
    .select("id, organization_id, conversation_id, conversations(ai_enabled)")
    .eq("status", "pending")
    .lte("due_at", now.toISOString())
    .order("due_at", { ascending: true })
    .limit(20);
  if (error) throw new Error(`No se pudieron leer los seguimientos vencidos: ${error.message}`);

  for (const followup of due ?? []) {
    const settings = await settingsFor(admin, cache, followup.organization_id);
    if (!settings || !followup.conversation_id) continue;
    // Si un operador tomó el chat, el seguimiento lo decide él; queda pendiente.
    if (!followup.conversations?.ai_enabled) continue;
    // Fuera de horario no se escribe: queda pendiente para la próxima pasada dentro del horario.
    if (!isWithinBusinessHours(now, settings)) continue;

    // Se reserva antes de enviar para no mandarlo dos veces si dos pasadas coinciden.
    const { data: claimed } = await admin
      .from("followups")
      .update({ status: "sent", sent_at: now.toISOString() })
      .eq("id", followup.id)
      .eq("status", "pending")
      .select("id");
    if (!claimed?.length) continue;

    try {
      const sent = await sendTextMessage(admin, {
        conversationId: followup.conversation_id,
        text: followupText(settings),
        sender: "agent",
        now,
        fetchImpl,
      });
      await admin.from("followups").update({ message_id: sent.messageId }).eq("id", followup.id);
      result.sent += 1;
    } catch (error) {
      if (error instanceof OutsideWindowError) {
        // Sin ventana solo se puede escribir con una plantilla de Meta: se omite.
        await admin.from("followups").update({ status: "skipped", sent_at: null }).eq("id", followup.id);
        result.skipped += 1;
      } else if (error instanceof ChannelSendError && !error.retryable) {
        // El canal rechazó el pedido (por ejemplo, el asociado bloqueó al bot): reintentar no sirve.
        await admin.from("followups").update({ status: "skipped", sent_at: null }).eq("id", followup.id);
        result.skipped += 1;
      } else {
        // Se libera y se reintenta más tarde, no en cada pasada del trabajador.
        await admin
          .from("followups")
          .update({ status: "pending", sent_at: null, due_at: new Date(now.getTime() + RETRY_DELAY_MS).toISOString() })
          .eq("id", followup.id);
        result.failed += 1;
        console.error("seguimiento:", error instanceof Error ? error.message : "Error desconocido");
      }
    }
  }
}
