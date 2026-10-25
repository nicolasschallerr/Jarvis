import type { SupabaseClient } from "@supabase/supabase-js";

import { recordAudit } from "@/lib/audit/record";
import { sendTextMessage, type SendTextParams } from "@/lib/outbound/send";
import type { Database } from "@/lib/supabase/database.types";

// Consentimiento para recibir mensajes de la organización (Ley 25.326 y política de WhatsApp): solo se le escribe en
// masa a quien aceptó y no pidió dejar de recibir (ADR-038). Las columnas opted_in_at / opted_out_at las escribe solo el
// servidor (ADR-027): una persona del equipo no puede marcar un consentimiento por su cuenta, tiene que pasar por acá,
// dejando constancia de cómo se obtuvo y quién lo registró.

type Admin = SupabaseClient<Database>;

export type ConsentStatus = "accepted" | "withdrawn" | "none";

// Aceptó y no se dio de baja después; o se dio de baja; o nunca se registró nada.
export function consentStatus(contact: { opted_in_at: string | null; opted_out_at: string | null }): ConsentStatus {
  const accepted = contact.opted_in_at ? new Date(contact.opted_in_at).getTime() : null;
  const withdrawn = contact.opted_out_at ? new Date(contact.opted_out_at).getTime() : null;
  if (withdrawn !== null && (accepted === null || withdrawn >= accepted)) return "withdrawn";
  return accepted !== null ? "accepted" : "none";
}

export const MAX_SOURCE_LENGTH = 200;

export type ConsentResult = { ok: true } | { ok: false; error: string };

export async function setConsent(
  admin: Admin,
  params: { organizationId: string; contactId: string; actorId: string | null; action: "give" | "withdraw"; source: string; now?: Date },
): Promise<ConsentResult> {
  const source = params.source.trim();
  if (params.action === "give" && source.length < 3) {
    return { ok: false, error: "Anotá cómo aceptó recibir mensajes (por ejemplo: «lo pidió por teléfono el 12/10»)." };
  }
  if (source.length > MAX_SOURCE_LENGTH) return { ok: false, error: `La nota supera los ${MAX_SOURCE_LENGTH} caracteres.` };

  const { data: contact } = await admin.from("contacts").select("id, merged_into").eq("id", params.contactId).eq("organization_id", params.organizationId).maybeSingle();
  if (!contact || contact.merged_into) return { ok: false, error: "El contacto no existe." };

  const now = (params.now ?? new Date()).toISOString();
  const { error } = await admin
    .from("contacts")
    .update(params.action === "give" ? { opted_in_at: now } : { opted_out_at: now })
    .eq("id", params.contactId)
    .eq("organization_id", params.organizationId);
  if (error) return { ok: false, error: "No se pudo guardar el consentimiento." };

  await recordAudit(admin, {
    organizationId: params.organizationId,
    actorId: params.actorId,
    action: params.action === "give" ? "contact.consent_given" : "contact.consent_withdrawn",
    entityType: "contact",
    entityId: params.contactId,
    data: { source: source || "sin nota" },
  });
  return { ok: true };
}

// Frases inequívocas con las que alguien pide no recibir más mensajes. Solo coincidencia exacta del mensaje entero:
// "baja" NO está, porque en una gremial o una mutual "baja" suele ser darse de baja de un servicio (otra gestión que tiene
// que llegar al agente o al equipo), no dejar de recibir novedades.
const OPT_OUT_PHRASES = new Set([
  "stop",
  "no recibir mas",
  "no quiero recibir mas",
  "no quiero recibir mas mensajes",
  "no quiero recibir mas novedades",
  "dejar de recibir",
  "dejar de recibir mensajes",
  "no enviar mas mensajes",
  "no me escriban mas",
  "no me envien mas mensajes",
]);

export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isOptOutKeyword(text: string | null | undefined): boolean {
  return Boolean(text) && OPT_OUT_PHRASES.has(normalizeForMatch(text ?? ""));
}

// Si el mensaje recién recibido es un pedido de no recibir más, registra la baja y confirma por el mismo chat. Devuelve
// true si lo trató como baja (entonces el agente no contesta ese mensaje).
export async function handleOptOutKeyword(
  admin: Admin,
  params: { messageId: string; now?: Date; fetchImpl?: SendTextParams["fetchImpl"] },
): Promise<boolean> {
  const { data: message } = await admin
    .from("messages")
    .select("id, body, type, direction, conversation_id, organization_id")
    .eq("id", params.messageId)
    .maybeSingle();
  if (!message || message.direction !== "inbound" || message.type !== "text" || !isOptOutKeyword(message.body)) return false;

  const { data: conversation } = await admin.from("conversations").select("contact_id").eq("id", message.conversation_id).maybeSingle();
  if (!conversation) return false;

  const result = await setConsent(admin, {
    organizationId: message.organization_id,
    contactId: conversation.contact_id,
    actorId: null,
    action: "withdraw",
    source: "pidió no recibir más mensajes (palabra clave)",
    now: params.now,
  });
  if (!result.ok) return false;

  // La confirmación es lo de menos: si el canal no puede enviar ahora, la baja ya quedó registrada.
  try {
    const { data: organization } = await admin.from("organizations").select("name").eq("id", message.organization_id).maybeSingle();
    await sendTextMessage(admin, {
      conversationId: message.conversation_id,
      text: `Listo, no vas a recibir más novedades de ${organization?.name ?? "nosotros"}. Si querés volver a recibirlas, avisanos por acá.`,
      sender: "system",
      now: params.now,
      fetchImpl: params.fetchImpl,
    });
  } catch (error) {
    console.error("confirmación de baja:", error instanceof Error ? error.message : "Error desconocido");
  }
  return true;
}
