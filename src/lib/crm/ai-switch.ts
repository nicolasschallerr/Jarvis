import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type AiSwitchResult = { ok: true } | { ok: false; error: string };

// "Tomar el chat" (Jarvis deja de responder en esta conversación) o "devolverlo a Jarvis". Lo puede hacer el
// superadmin o un operador; RLS (conversations_update) lo exige también. Al tomarlo, si nadie lo tenía asignado,
// queda asignado a quien lo tomó.
export async function setConversationAi(params: {
  userClient: SupabaseClient<Database>;
  profile: { id: string; role: "superadmin" | "operator" | "viewer" };
  conversationId: string;
  enabled: boolean;
}): Promise<AiSwitchResult> {
  if (params.profile.role === "viewer") {
    return { ok: false, error: "Tu rol es de consulta: no puede tomar ni devolver conversaciones." };
  }

  const { data, error } = await params.userClient
    .from("conversations")
    .update({ ai_enabled: params.enabled })
    .eq("id", params.conversationId)
    .select("id, assigned_to");

  if (error) return { ok: false, error: "No se pudo cambiar quién atiende la conversación." };
  if (!data?.length) return { ok: false, error: "La conversación no existe o no tenés permiso para cambiarla." };

  if (!params.enabled && !data[0]?.assigned_to) {
    await params.userClient.from("conversations").update({ assigned_to: params.profile.id }).eq("id", params.conversationId).is("assigned_to", null);
  }

  return { ok: true };
}
