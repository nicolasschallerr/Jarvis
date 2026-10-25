import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAudit } from "@/lib/audit/record";
import { consentStatus } from "@/lib/consent";
import { ChannelSendError } from "@/lib/outbound/errors";
import type { Database, Json } from "@/lib/supabase/database.types";
import { sendTemplateMessage, TemplateError } from "@/lib/whatsapp/service";

import { BROADCAST_MAX_RECIPIENTS, cleanLocality, fixedValuesOf, MAX_NAME_LENGTH, MAX_SCHEDULE_DAYS, missingVariables, valuesForContact } from "./rules";

// Envíos masivos con consentimiento (ADR-038). Todo se escribe con el cliente de servicio después de que la acción
// verificó que quien pide es superadmin; cada función vuelve a filtrar por la organización.

type Admin = SupabaseClient<Database>;
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type BroadcastResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const MAX_ATTEMPTS = 3;

export async function createBroadcast(
  admin: Admin,
  params: { organizationId: string; actorId: string; name: string; templateId: string; variables: Record<string, string>; locality: string },
): Promise<BroadcastResult<{ id: string; audience: number }>> {
  const name = params.name.trim();
  if (name.length < 3 || name.length > MAX_NAME_LENGTH) return { ok: false, error: `El nombre del envío tiene que tener entre 3 y ${MAX_NAME_LENGTH} caracteres.` };

  const { data: template } = await admin
    .from("message_templates")
    .select("id, body, meta_status, channel_id, channels(type, is_active)")
    .eq("id", params.templateId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (!template) return { ok: false, error: "La plantilla no existe." };
  if (template.meta_status !== "approved") return { ok: false, error: "Solo se pueden enviar plantillas aprobadas por Meta." };
  if (!template.channel_id || template.channels?.type !== "whatsapp" || !template.channels.is_active) return { ok: false, error: "La plantilla no está asociada a un canal de WhatsApp activo." };

  const missing = missingVariables(template.body, params.variables);
  if (missing.length > 0) return { ok: false, error: `Completá ${missing.map((key) => `{{${key}}}`).join(", ")}.` };

  const locality = cleanLocality(params.locality);
  const segment: Json = locality ? { locality } : {};
  const audience = await audienceCount(admin, params.organizationId, segment);
  if (audience === 0) return { ok: false, error: "No hay contactos con consentimiento que cumplan ese filtro. Registrá el consentimiento en la ficha de cada contacto." };

  const fixed = Object.fromEntries(Object.entries(params.variables).filter(([, value]) => value.trim() !== "").map(([key, value]) => [key, value.trim().slice(0, 300)]));
  const { data, error } = await admin
    .from("broadcasts")
    .insert({ organization_id: params.organizationId, template_id: template.id, name, segment, variables: fixed, status: "draft", created_by: params.actorId })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "No se pudo crear el envío." };

  await recordAudit(admin, { organizationId: params.organizationId, actorId: params.actorId, action: "broadcast.created", entityType: "broadcast", entityId: data.id, data: { name } });
  return { ok: true, id: data.id, audience };
}

export async function audienceCount(admin: Admin, organizationId: string, segment: Json): Promise<number> {
  const { data } = await admin.rpc("broadcast_audience_count", { p_org: organizationId, p_segment: segment });
  return typeof data === "number" ? data : 0;
}

// Pasa un borrador a programado ("ahora" si no hay fecha). Se vuelve a contar la audiencia: puede haber cambiado.
export async function scheduleBroadcast(
  admin: Admin,
  params: { organizationId: string; actorId: string; broadcastId: string; at: Date | null; now?: Date },
): Promise<BroadcastResult<{ audience: number }>> {
  const now = params.now ?? new Date();
  const { data: broadcast } = await admin.from("broadcasts").select("id, name, status, segment").eq("id", params.broadcastId).eq("organization_id", params.organizationId).maybeSingle();
  if (!broadcast) return { ok: false, error: "El envío no existe." };
  if (broadcast.status !== "draft") return { ok: false, error: "Solo se puede programar un borrador." };

  if (params.at && params.at.getTime() > now.getTime() + MAX_SCHEDULE_DAYS * 86_400_000) return { ok: false, error: `No se puede programar con más de ${MAX_SCHEDULE_DAYS} días de anticipación.` };
  const when = params.at && params.at.getTime() > now.getTime() ? params.at : now;

  const audience = await audienceCount(admin, params.organizationId, broadcast.segment);
  if (audience === 0) return { ok: false, error: "Ya no hay contactos con consentimiento que cumplan ese filtro." };

  // Solo si sigue en borrador: dos clics seguidos no lo programan dos veces.
  const { data: updated } = await admin
    .from("broadcasts")
    .update({ status: "scheduled", scheduled_at: when.toISOString() })
    .eq("id", broadcast.id)
    .eq("status", "draft")
    .select("id");
  if (!updated?.length) return { ok: false, error: "El envío ya no es un borrador." };

  await recordAudit(admin, {
    organizationId: params.organizationId,
    actorId: params.actorId,
    action: "broadcast.scheduled",
    entityType: "broadcast",
    entityId: broadcast.id,
    data: { name: broadcast.name, audience, at: when.toISOString() },
  });
  return { ok: true, audience };
}

// Cancela un envío que todavía no terminó: lo que quedaba sin enviar no se envía.
export async function cancelBroadcast(admin: Admin, params: { organizationId: string; actorId: string; broadcastId: string }): Promise<BroadcastResult> {
  const { data: broadcast } = await admin.from("broadcasts").select("id, name, status").eq("id", params.broadcastId).eq("organization_id", params.organizationId).maybeSingle();
  if (!broadcast) return { ok: false, error: "El envío no existe." };
  if (!["draft", "scheduled", "sending"].includes(broadcast.status)) return { ok: false, error: "Ese envío ya terminó o ya estaba cancelado." };

  const { data: updated } = await admin
    .from("broadcasts")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("id", broadcast.id)
    .in("status", ["draft", "scheduled", "sending"])
    .select("id");
  if (!updated?.length) return { ok: false, error: "No se pudo cancelar el envío." };

  await admin.from("broadcast_recipients").update({ status: "failed", error: "Omitido: envío cancelado", claimed_at: null }).eq("broadcast_id", broadcast.id).eq("status", "queued");
  await recordAudit(admin, { organizationId: params.organizationId, actorId: params.actorId, action: "broadcast.cancelled", entityType: "broadcast", entityId: broadcast.id, data: { name: broadcast.name } });
  return { ok: true };
}

export type BroadcastsRunResult = { started: number; sent: number; failed: number; finished: number };

// Una pasada del trabajador: empieza los envíos programados que ya les toca (arma la lista de destinatarios con el
// consentimiento de ese momento) y envía un lote de cada envío en curso.
export async function runBroadcasts(admin: Admin, options: { now?: Date; fetchImpl?: FetchLike; batch?: number } = {}): Promise<BroadcastsRunResult> {
  const now = options.now ?? new Date();
  const result: BroadcastsRunResult = { started: 0, sent: 0, failed: 0, finished: 0 };

  // 1. Empezar los programados.
  const { data: due } = await admin.from("broadcasts").select("id, organization_id, segment").eq("status", "scheduled").lte("scheduled_at", now.toISOString()).order("scheduled_at").limit(5);
  for (const broadcast of due ?? []) {
    // Reservar el arranque: si dos pasadas coinciden, solo una lo empieza.
    const { data: claimed } = await admin.from("broadcasts").update({ status: "sending", started_at: now.toISOString() }).eq("id", broadcast.id).eq("status", "scheduled").select("id");
    if (!claimed?.length) continue;
    result.started += 1;

    const { data: audience } = await admin.rpc("broadcast_audience", { p_org: broadcast.organization_id, p_segment: broadcast.segment, p_limit: BROADCAST_MAX_RECIPIENTS });
    const rows = (audience ?? []).map((row) => ({ broadcast_id: broadcast.id, contact_id: row.contact_id, organization_id: broadcast.organization_id }));
    for (let index = 0; index < rows.length; index += 500) {
      const { error } = await admin.from("broadcast_recipients").upsert(rows.slice(index, index + 500), { onConflict: "broadcast_id,contact_id", ignoreDuplicates: true });
      if (error) console.error("destinatarios del envío:", error.message);
    }
  }

  // 2. Enviar un lote de cada envío en curso.
  const { data: sending } = await admin
    .from("broadcasts")
    .select("id, organization_id, variables, template_id, message_templates(id, body, channel_id)")
    .eq("status", "sending")
    .order("started_at")
    .limit(3);

  for (const broadcast of sending ?? []) {
    const template = broadcast.message_templates;
    const { data: claimed } = await admin.rpc("claim_broadcast_recipients", { p_broadcast: broadcast.id, p_limit: options.batch ?? 20 });
    for (const recipient of claimed ?? []) {
      const outcome = template
        ? await sendOne(admin, { broadcastId: broadcast.id, organizationId: broadcast.organization_id, template, fixed: fixedValuesOf(broadcast.variables), contactId: recipient.contact_id, attempts: recipient.attempts, now, fetchImpl: options.fetchImpl })
        : "failed";
      if (outcome === "sent") result.sent += 1;
      else if (outcome === "failed") result.failed += 1;
    }

    // 3. Terminó si ya no queda ningún destinatario sin enviar.
    const { count } = await admin.from("broadcast_recipients").select("contact_id", { count: "exact", head: true }).eq("broadcast_id", broadcast.id).eq("status", "queued");
    if (count === 0) {
      const { data: finished } = await admin.from("broadcasts").update({ status: "done", finished_at: now.toISOString() }).eq("id", broadcast.id).eq("status", "sending").select("id");
      if (finished?.length) result.finished += 1;
    }
  }

  return result;
}

type OneParams = {
  broadcastId: string;
  organizationId: string;
  template: { id: string; body: string; channel_id: string | null };
  fixed: Record<string, string>;
  contactId: string;
  attempts: number;
  now: Date;
  fetchImpl?: FetchLike;
};

async function sendOne(admin: Admin, params: OneParams): Promise<"sent" | "failed" | "retry"> {
  const fail = async (reason: string): Promise<"failed"> => {
    await admin
      .from("broadcast_recipients")
      .update({ status: "failed", error: reason.slice(0, 300), claimed_at: null })
      .eq("broadcast_id", params.broadcastId)
      .eq("contact_id", params.contactId);
    return "failed";
  };

  const { data: contact } = await admin
    .from("contacts")
    .select("display_name, opted_in_at, opted_out_at, merged_into")
    .eq("id", params.contactId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  // Se vuelve a mirar el consentimiento al enviar: pudo darse de baja entre que se armó la lista y ahora.
  if (!contact || contact.merged_into || consentStatus(contact) !== "accepted") return fail("Omitido: ya no tiene consentimiento vigente");

  const values = valuesForContact(params.template.body, params.fixed, contact.display_name);
  if (!values) return fail("Omitido: no tiene nombre para completar la plantilla");
  if (!params.template.channel_id) return fail("La plantilla no tiene canal");

  let conversationId: string | null = null;
  const find = () => admin.from("conversations").select("id").eq("channel_id", params.template.channel_id ?? "").eq("contact_id", params.contactId).maybeSingle();
  conversationId = (await find()).data?.id ?? null;
  if (!conversationId) {
    const { data: created } = await admin.from("conversations").insert({ organization_id: params.organizationId, channel_id: params.template.channel_id, contact_id: params.contactId }).select("id").maybeSingle();
    // Si otra pasada la creó al mismo tiempo, se usa esa.
    conversationId = created?.id ?? (await find()).data?.id ?? null;
  }
  if (!conversationId) return fail("No se pudo abrir la conversación");

  try {
    const sent = await sendTemplateMessage(admin, { conversationId, templateId: params.template.id, values, sender: "system", requireConsent: true, now: params.now, fetchImpl: params.fetchImpl });
    await admin
      .from("broadcast_recipients")
      .update({ status: "sent", message_id: sent.messageId, sent_at: params.now.toISOString(), error: null, claimed_at: null })
      .eq("broadcast_id", params.broadcastId)
      .eq("contact_id", params.contactId);
    return "sent";
  } catch (error) {
    if (error instanceof TemplateError) return fail(error.message);
    if (error instanceof ChannelSendError && error.retryable && params.attempts + 1 < MAX_ATTEMPTS) {
      // Falla pasajera de Meta: se libera y se reintenta en otra pasada.
      await admin.from("broadcast_recipients").update({ attempts: params.attempts + 1, claimed_at: null, error: error.message.slice(0, 300) }).eq("broadcast_id", params.broadcastId).eq("contact_id", params.contactId);
      return "retry";
    }
    if (error instanceof ChannelSendError) return fail(error.message);
    console.error("envío masivo:", error instanceof Error ? error.message : "Error desconocido");
    return fail("No se pudo enviar");
  }
}
