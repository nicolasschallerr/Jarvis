import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export const MAX_ANSWER_LENGTH = 2000;

export type AreaQueryResult = { ok: true } | { ok: false; error: string };

// El sector responde una consulta que le hizo el agente. Solo responde quien es del sector consultado
// o el superadmin (RLS lo exige también). La respuesta queda guardada y pendiente de enviar: se le
// transmite al asociado por el mismo chat sin que el agente la invente, solo la redacta.
export async function answerAreaQuery(params: {
  // Cliente que actúa como el usuario.
  userClient: SupabaseClient<Database>;
  profile: { id: string; role: "superadmin" | "operator" | "viewer" };
  queryId: string;
  answer: string;
}): Promise<AreaQueryResult> {
  if (params.profile.role === "viewer") {
    return { ok: false, error: "Tu rol es de consulta: no puede responder consultas." };
  }

  const answer = params.answer.trim();
  if (!answer) return { ok: false, error: "Escribí la respuesta antes de enviarla." };
  if (answer.length > MAX_ANSWER_LENGTH) return { ok: false, error: `La respuesta supera los ${MAX_ANSWER_LENGTH} caracteres.` };

  const { data: query } = await params.userClient
    .from("area_queries")
    .select("id, case_id, status")
    .eq("id", params.queryId)
    .maybeSingle();
  if (!query) return { ok: false, error: "La consulta no existe." };
  if (query.status !== "pending") return { ok: false, error: "La consulta ya no está pendiente." };

  // Se vuelve a exigir "pendiente" en la propia actualización: si dos personas responden a la vez,
  // gana la primera y la segunda recibe el aviso en vez de pisarla.
  const { data: updated, error } = await params.userClient
    .from("area_queries")
    .update({
      status: "answered",
      answer,
      answered_by: params.profile.id,
      answered_at: new Date().toISOString(),
    })
    .eq("id", params.queryId)
    .eq("status", "pending")
    .select("id");

  if (error) return { ok: false, error: "No se pudo guardar la respuesta." };
  if (!updated?.length) return { ok: false, error: "No tenés permiso para responder esta consulta, o ya la respondió otra persona." };

  // Si ya no quedan consultas pendientes, el caso deja de esperar al área. Si esto falla no se pierde
  // la respuesta (ya está guardada): alguien puede cambiar el estado a mano.
  const { count } = await params.userClient
    .from("area_queries")
    .select("id", { count: "exact", head: true })
    .eq("case_id", query.case_id)
    .eq("status", "pending");
  if (count === 0) {
    await params.userClient.from("cases").update({ status: "in_progress" }).eq("id", query.case_id).eq("status", "waiting_area");
  }

  return { ok: true };
}
