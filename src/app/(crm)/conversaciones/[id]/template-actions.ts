"use server";

import { revalidatePath } from "next/cache";

import { getCurrentProfile } from "@/lib/auth/profile";
import { setConversationAi } from "@/lib/crm/ai-switch";
import { ChannelSendError } from "@/lib/outbound/errors";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { sendTemplateMessage, TemplateError } from "@/lib/whatsapp/service";

export type TemplateSendState = { error: string | null; sentAt: number | null };

// Un operador escribe con una plantilla aprobada (fuera de la ventana de 24 h de WhatsApp). La autorización: rol,
// conversación visible con su sesión (RLS) y, en el servicio, plantilla aprobada de la misma organización.
export async function sendTemplateAction(conversationId: string, templateId: string, values: Record<string, string>): Promise<TemplateSendState> {
  const profile = await getCurrentProfile();
  if (profile.role === "viewer") return { error: "Tu rol es de consulta: no puede escribir.", sentAt: null };

  const userClient = await createClient();
  const { data: visible } = await userClient.from("conversations").select("id, ai_enabled").eq("id", conversationId).maybeSingle();
  if (!visible) return { error: "La conversación no existe.", sentAt: null };

  // Solo valores de texto, con tope: vienen del navegador.
  const clean: Record<string, string> = {};
  for (const [key, value] of Object.entries(values ?? {}).slice(0, 20)) {
    if (typeof value === "string" && /^[a-z0-9_]{1,40}$/i.test(key)) clean[key] = value.slice(0, 300);
  }

  try {
    await sendTemplateMessage(createAdminClient(), {
      conversationId,
      templateId,
      values: clean,
      sender: "operator",
      senderProfileId: profile.id,
    });
  } catch (error) {
    if (error instanceof TemplateError) return { error: error.message, sentAt: null };
    if (error instanceof ChannelSendError) {
      return { error: error.retryable ? "WhatsApp no respondió. Probá de nuevo en unos segundos." : error.message, sentAt: null };
    }
    console.error("plantilla:", error instanceof Error ? error.message : "Error desconocido");
    return { error: "No se pudo enviar la plantilla.", sentAt: null };
  }

  // Igual que al responder a mano: quien escribe toma el chat y el agente no le contesta por encima (ADR-028).
  if (visible.ai_enabled) await setConversationAi({ userClient, profile, conversationId, enabled: false });

  revalidatePath(`/conversaciones/${conversationId}`);
  return { error: null, sentAt: Date.now() };
}
