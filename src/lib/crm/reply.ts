import type { SupabaseClient } from "@supabase/supabase-js";

import { ChannelSendError, OutsideWindowError } from "@/lib/outbound/errors";
import { sendTextMessage, type SendTextParams } from "@/lib/outbound/send";
import type { Database } from "@/lib/supabase/database.types";

import { setConversationAi } from "./ai-switch";

// `aiPaused`: la respuesta pausó a Jarvis en esta conversación (estaba atendiendo y ahora atiende una persona).
export type ReplyResult = { ok: true; aiPaused: boolean } | { ok: false; error: string };

export const MAX_REPLY_LENGTH = 4000;

type ReplyParams = {
  // Cliente que actúa como el usuario (RLS): decide si la conversación existe para él.
  userClient: SupabaseClient<Database>;
  // Cliente de servicio: los usuarios no pueden insertar mensajes, solo el servidor.
  admin: SupabaseClient<Database>;
  profile: { id: string; role: "superadmin" | "operator" | "viewer" };
  conversationId: string;
  text: string;
  fetchImpl?: SendTextParams["fetchImpl"];
};

// Un operador responde en una conversación. Toda la autorización pasa por acá: rol, existencia de
// la conversación para este usuario (RLS) y reglas del canal. Nunca confiar en que la pantalla
// ocultó el formulario: las acciones de servidor se pueden invocar directamente.
export async function sendOperatorReply(params: ReplyParams): Promise<ReplyResult> {
  if (params.profile.role === "viewer") {
    return { ok: false, error: "Tu rol no permite responder conversaciones." };
  }

  const text = params.text.trim();
  if (!text) return { ok: false, error: "Escribí un mensaje antes de enviar." };
  if (text.length > MAX_REPLY_LENGTH) {
    return { ok: false, error: `El mensaje supera los ${MAX_REPLY_LENGTH} caracteres.` };
  }

  const { data: visible } = await params.userClient
    .from("conversations")
    .select("id, ai_enabled")
    .eq("id", params.conversationId)
    .maybeSingle();
  if (!visible) return { ok: false, error: "La conversación no existe." };

  try {
    await sendTextMessage(params.admin, {
      conversationId: params.conversationId,
      text,
      sender: "operator",
      senderProfileId: params.profile.id,
      fetchImpl: params.fetchImpl,
    });

    // Si una persona responde, toma el chat: Jarvis se pausa en esta conversación para no contestar por encima
    // de ella. Se reactiva con "Devolver a Jarvis" (ADR-028).
    let aiPaused = false;
    if (visible.ai_enabled) {
      const switched = await setConversationAi({ userClient: params.userClient, profile: params.profile, conversationId: params.conversationId, enabled: false });
      aiPaused = switched.ok;
    }
    return { ok: true, aiPaused };
  } catch (error) {
    if (error instanceof OutsideWindowError) {
      return {
        ok: false,
        error: "Pasaron más de 24 horas desde el último mensaje del contacto: solo se pueden enviar plantillas.",
      };
    }
    if (error instanceof ChannelSendError) {
      return {
        ok: false,
        error: error.retryable
          ? "El canal no respondió. Probá de nuevo en unos segundos."
          : "El canal rechazó el mensaje (por ejemplo, el contacto bloqueó al bot).",
      };
    }
    // El detalle queda en el registro del servidor; al usuario no se le muestra.
    console.error("respuesta del operador:", error instanceof Error ? error.message : "Error desconocido");
    return { ok: false, error: "No se pudo enviar el mensaje." };
  }
}
