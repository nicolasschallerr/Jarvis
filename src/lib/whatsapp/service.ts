import type { SupabaseClient } from "@supabase/supabase-js";

import { consentStatus } from "@/lib/consent";
import { channelToken } from "@/lib/outbound/channel-token";
import { ChannelSendError } from "@/lib/outbound/errors";
import { listWhatsAppTemplates, sendWhatsAppPayload } from "@/lib/outbound/whatsapp";
import type { Database, Json } from "@/lib/supabase/database.types";

import { buildTemplatePayload, checkValues, renderTemplate, rowFromMeta, type MetaTemplate, type ParameterFormat } from "./templates";

type Admin = SupabaseClient<Database>;
type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

// Error con un mensaje que se le puede mostrar al equipo tal cual.
export class TemplateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateError";
  }
}

function wabaIdOf(config: Json): string | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const value = (config as Record<string, unknown>).waba_id;
  return typeof value === "string" && /^\d{5,30}$/.test(value) ? value : null;
}

export type SyncResult = { synced: number; channels: number; problems: string[] };

// Trae de Meta las plantillas de cada canal de WhatsApp de la organización y las guarda (alta o actualización por
// nombre e idioma). Las que ya no están en Meta quedan como "desactivadas" para no ofrecerlas más.
export async function syncTemplates(admin: Admin, organizationId: string, options: { fetchImpl?: FetchLike; now?: Date } = {}): Promise<SyncResult> {
  const now = options.now ?? new Date();
  const result: SyncResult = { synced: 0, channels: 0, problems: [] };

  const { data: channels, error } = await admin
    .from("channels")
    .select("id, name, secret_ref, config")
    .eq("organization_id", organizationId)
    .eq("type", "whatsapp")
    .eq("is_active", true);
  if (error) throw new Error(`No se pudieron leer los canales: ${error.message}`);
  if (!channels?.length) {
    result.problems.push("La organización no tiene un canal de WhatsApp activo.");
    return result;
  }

  for (const channel of channels) {
    const wabaId = wabaIdOf(channel.config);
    if (!wabaId) {
      result.problems.push(`El canal "${channel.name}" no tiene configurado el id de la cuenta de WhatsApp Business (waba_id).`);
      continue;
    }
    let token: string;
    try {
      token = channelToken(channel.secret_ref);
    } catch {
      result.problems.push(`El canal "${channel.name}" no tiene token configurado en el servidor.`);
      continue;
    }

    let templates: unknown[];
    try {
      templates = await listWhatsAppTemplates({ token, wabaId, fetchImpl: options.fetchImpl });
    } catch (syncError) {
      result.problems.push(`"${channel.name}": ${syncError instanceof Error ? syncError.message : "error desconocido"}`);
      continue;
    }

    const rows = templates.map((template) => rowFromMeta(template as MetaTemplate)).filter((row) => row !== null);
    if (rows.length > 0) {
      const { error: upsertError } = await admin.from("message_templates").upsert(
        rows.map((row) => ({ ...row, organization_id: organizationId, channel_id: channel.id, synced_at: now.toISOString() })),
        { onConflict: "organization_id,name,language" },
      );
      if (upsertError) {
        result.problems.push(`"${channel.name}": no se pudieron guardar las plantillas (${upsertError.message}).`);
        continue;
      }
    }

    // Las de este canal que Meta ya no devolvió: se desactivan (pueden estar en mensajes viejos, no se borran).
    const kept = new Set(rows.map((row) => `${row.name}|${row.language}`));
    const { data: existing } = await admin.from("message_templates").select("id, name, language").eq("organization_id", organizationId).eq("channel_id", channel.id);
    const gone = (existing ?? []).filter((template) => !kept.has(`${template.name}|${template.language}`)).map((template) => template.id);
    if (gone.length > 0) await admin.from("message_templates").update({ meta_status: "disabled", synced_at: now.toISOString() }).in("id", gone);

    result.synced += rows.length;
    result.channels += 1;
  }

  return result;
}

export type SendTemplateParams = {
  conversationId: string;
  templateId: string;
  values: Record<string, string>;
  sender: "agent" | "operator" | "system";
  senderProfileId?: string | null;
  // Envíos masivos: además de no haber pedido la baja, tiene que haber aceptado recibir mensajes (ADR-038).
  requireConsent?: boolean;
  fetchImpl?: FetchLike;
  now?: Date;
};

// Escribe a un contacto con una plantilla aprobada. Sirve fuera de la ventana de 24 h (y también dentro). Controla:
// canal de WhatsApp, plantilla aprobada de la misma organización, consentimiento del contacto y variables
// completas. El mensaje queda en la conversación con el texto ya completado, como cualquier otro.
export async function sendTemplateMessage(admin: Admin, params: SendTemplateParams): Promise<{ messageId: string; text: string }> {
  const now = params.now ?? new Date();

  const { data: conversation, error } = await admin
    .from("conversations")
    .select("id, organization_id, contact_id, channels(type, external_id, secret_ref), contacts(opted_in_at, opted_out_at)")
    .eq("id", params.conversationId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo consultar la conversación: ${error.message}`);
  if (!conversation?.channels) throw new TemplateError("La conversación no existe.");
  if (conversation.channels.type !== "whatsapp") throw new TemplateError("Las plantillas son de WhatsApp: en este canal se escribe texto libre.");
  // Quien pidió no recibir mensajes no recibe plantillas (consentimiento, ADR de envíos).
  if (conversation.contacts?.opted_out_at && consentStatus(conversation.contacts) === "withdrawn") {
    throw new TemplateError("El contacto pidió no recibir mensajes: no se le puede escribir con una plantilla.");
  }
  if (params.requireConsent && (!conversation.contacts || consentStatus(conversation.contacts) !== "accepted")) {
    throw new TemplateError("El contacto no aceptó recibir mensajes masivos.");
  }

  const { data: template } = await admin
    .from("message_templates")
    .select("id, organization_id, name, language, body, parameter_format, meta_status")
    .eq("id", params.templateId)
    .maybeSingle();
  if (!template || template.organization_id !== conversation.organization_id) throw new TemplateError("La plantilla no existe.");
  if (template.meta_status !== "approved") throw new TemplateError("Solo se pueden enviar plantillas aprobadas por Meta.");

  const checked = checkValues(template.body, params.values);
  if (!checked.ok) throw new TemplateError(checked.error);

  const { data: identity } = await admin
    .from("contact_identities")
    .select("identifier")
    .eq("contact_id", conversation.contact_id)
    .eq("channel_type", "whatsapp")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!identity) throw new TemplateError("El contacto no tiene un número de WhatsApp.");

  let token: string;
  try {
    token = channelToken(conversation.channels.secret_ref);
  } catch {
    throw new TemplateError("El canal de WhatsApp no tiene token configurado en el servidor.");
  }

  const text = renderTemplate(template.body, checked.values);
  const { data: queued, error: queueError } = await admin
    .from("messages")
    .insert({
      organization_id: conversation.organization_id,
      conversation_id: conversation.id,
      direction: "outbound",
      sender: params.sender,
      sender_profile_id: params.senderProfileId ?? null,
      type: "text",
      body: text,
      status: "queued",
      template_id: template.id,
      provider_timestamp: now.toISOString(),
    })
    .select("id")
    .single();
  if (queueError || !queued) throw new Error(`No se pudo guardar el mensaje: ${queueError?.message}`);

  try {
    const sent = await sendWhatsAppPayload({
      token,
      phoneNumberId: conversation.channels.external_id,
      payload: buildTemplatePayload({
        to: identity.identifier,
        name: template.name,
        language: template.language,
        body: template.body,
        format: template.parameter_format as ParameterFormat,
        values: checked.values,
      }),
      fetchImpl: params.fetchImpl,
      now,
    });

    const { error: finalizeError } = await admin.rpc("finalize_outbound_message", {
      p_message_id: queued.id,
      p_external_id: sent.externalId,
      p_provider_timestamp: sent.providerTimestamp,
    });
    if (finalizeError) throw new Error(`No se pudo cerrar el mensaje enviado: ${finalizeError.message}`);
    return { messageId: queued.id, text };
  } catch (sendError) {
    const detail =
      sendError instanceof ChannelSendError
        ? { code: sendError.code, message: sendError.message, retryable: sendError.retryable }
        : { message: sendError instanceof Error ? sendError.message : "Error desconocido" };
    await admin.from("messages").update({ status: "failed", status_updated_at: new Date().toISOString(), error: detail as Json }).eq("id", queued.id);
    throw sendError;
  }
}
