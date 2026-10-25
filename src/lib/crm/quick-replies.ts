import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export const MAX_QUICK_TITLE = 60;
export const MAX_QUICK_BODY = 4000;

type Client = SupabaseClient<Database>;
type Profile = { id: string; organizationId: string; role: "superadmin" | "operator" | "viewer" };

export type QuickReply = { id: string; title: string; body: string };

export type QuickReplyResult = { ok: true } | { ok: false; error: string };

export async function listQuickReplies(userClient: Client): Promise<QuickReply[]> {
  const { data } = await userClient.from("quick_replies").select("id, title, body").order("title").limit(100);
  return data ?? [];
}

// Guarda un texto para reusar. La autorización real está en RLS; el rol se revisa antes para dar un mensaje claro.
export async function addQuickReply(params: { userClient: Client; profile: Profile; title: string; body: string }): Promise<QuickReplyResult> {
  if (params.profile.role === "viewer") return { ok: false, error: "Tu rol es de consulta: no puede guardar respuestas." };

  const title = params.title.trim();
  const body = params.body.trim();
  if (!title) return { ok: false, error: "Escribí un título corto para encontrarla después." };
  if (!body) return { ok: false, error: "Escribí el texto de la respuesta." };
  if (title.length > MAX_QUICK_TITLE) return { ok: false, error: `El título supera los ${MAX_QUICK_TITLE} caracteres.` };
  if (body.length > MAX_QUICK_BODY) return { ok: false, error: `El texto supera los ${MAX_QUICK_BODY} caracteres.` };

  const { error } = await params.userClient
    .from("quick_replies")
    .insert({ organization_id: params.profile.organizationId, title, body, created_by: params.profile.id });
  if (error) return { ok: false, error: "No se pudo guardar la respuesta." };
  return { ok: true };
}

// Cambia el título y el texto. RLS limita a la propia organización y a quien puede escribir.
export async function updateQuickReply(params: { userClient: Client; profile: Profile; id: string; title: string; body: string }): Promise<QuickReplyResult> {
  if (params.profile.role === "viewer") return { ok: false, error: "Tu rol es de consulta: no puede editar respuestas." };

  const title = params.title.trim();
  const body = params.body.trim();
  if (!title) return { ok: false, error: "El título no puede quedar vacío." };
  if (!body) return { ok: false, error: "El texto no puede quedar vacío." };
  if (title.length > MAX_QUICK_TITLE) return { ok: false, error: `El título supera los ${MAX_QUICK_TITLE} caracteres.` };
  if (body.length > MAX_QUICK_BODY) return { ok: false, error: `El texto supera los ${MAX_QUICK_BODY} caracteres.` };

  const { data, error } = await params.userClient.from("quick_replies").update({ title, body }).eq("id", params.id).select("id");
  if (error) return { ok: false, error: "No se pudo guardar el cambio." };
  if (!data?.length) return { ok: false, error: "La respuesta no existe." };
  return { ok: true };
}

export async function deleteQuickReply(params: { userClient: Client; profile: Profile; id: string }): Promise<QuickReplyResult> {
  if (params.profile.role === "viewer") return { ok: false, error: "Tu rol es de consulta: no puede borrar respuestas." };
  const { data, error } = await params.userClient.from("quick_replies").delete().eq("id", params.id).select("id");
  if (error) return { ok: false, error: "No se pudo borrar la respuesta." };
  if (!data?.length) return { ok: false, error: "La respuesta no existe." };
  return { ok: true };
}
