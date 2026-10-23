import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type CaseStatus = Database["public"]["Enums"]["case_status"];
export type CasePriority = Database["public"]["Enums"]["case_priority"];

export const CASE_STATUSES: CaseStatus[] = ["new", "in_progress", "waiting_contact", "waiting_area", "resolved"];
export const CASE_PRIORITIES: CasePriority[] = ["low", "normal", "high", "urgent"];

export const MAX_CASE_TITLE_LENGTH = 120;
export const MAX_RESOLUTION_LENGTH = 1000;

export type CaseResult = { ok: true; caseId: string } | { ok: false; error: string };

type CaseParams = {
  // Cliente que actúa como el usuario: RLS decide qué conversaciones y casos puede ver y modificar.
  userClient: SupabaseClient<Database>;
  profile: { id: string; role: "superadmin" | "operator" | "viewer"; organizationId: string };
};

const VIEWER: CaseResult = { ok: false, error: "Tu rol es de consulta: no puede crear ni modificar casos." };
const NOT_FOUND_OR_DENIED: CaseResult = {
  ok: false,
  error: "El caso no existe o no tenés permiso para modificarlo (solo el asignado, el sector o un superadministrador).",
};

// Abre un caso para una conversación. Hay un solo caso abierto por conversación (índice único en la base).
export async function createCase(
  params: CaseParams & { conversationId: string; title: string; sectorId: string | null; priority: CasePriority },
): Promise<CaseResult> {
  if (params.profile.role === "viewer") return VIEWER;

  const title = params.title.trim();
  if (!title) return { ok: false, error: "Escribí un título para el caso." };
  if (title.length > MAX_CASE_TITLE_LENGTH) {
    return { ok: false, error: `El título supera los ${MAX_CASE_TITLE_LENGTH} caracteres.` };
  }
  if (!CASE_PRIORITIES.includes(params.priority)) return { ok: false, error: "Prioridad inválida." };

  const { data: conversation } = await params.userClient
    .from("conversations")
    .select("id, contact_id")
    .eq("id", params.conversationId)
    .maybeSingle();
  if (!conversation) return { ok: false, error: "La conversación no existe." };

  if (params.sectorId) {
    const { data: sector } = await params.userClient
      .from("sectors")
      .select("id, is_active")
      .eq("id", params.sectorId)
      .maybeSingle();
    if (!sector || !sector.is_active) return { ok: false, error: "El sector no existe o está desactivado." };
  }

  const { data, error } = await params.userClient
    .from("cases")
    .insert({
      organization_id: params.profile.organizationId,
      contact_id: conversation.contact_id,
      conversation_id: conversation.id,
      sector_id: params.sectorId,
      priority: params.priority,
      title,
    })
    .select("id")
    .single();

  if (error || !data) {
    // 23505 = ya hay un caso abierto en esta conversación.
    if (error?.code === "23505") return { ok: false, error: "Esta conversación ya tiene un caso abierto." };
    return { ok: false, error: "No se pudo crear el caso." };
  }
  return { ok: true, caseId: data.id };
}

// Cambia el estado. Al resolver se puede dejar cómo se resolvió; reabrir limpia la fecha de resolución
// (lo hace la base) pero conserva el texto.
export async function changeCaseStatus(
  params: CaseParams & { caseId: string; status: CaseStatus; resolution?: string },
): Promise<CaseResult> {
  if (params.profile.role === "viewer") return VIEWER;
  if (!CASE_STATUSES.includes(params.status)) return { ok: false, error: "Estado inválido." };

  const resolution = params.resolution?.trim();
  if (resolution && resolution.length > MAX_RESOLUTION_LENGTH) {
    return { ok: false, error: `La resolución supera los ${MAX_RESOLUTION_LENGTH} caracteres.` };
  }

  const { data, error } = await params.userClient
    .from("cases")
    .update({ status: params.status, ...(params.status === "resolved" && resolution ? { resolution } : {}) })
    .eq("id", params.caseId)
    .select("id");

  if (error) return { ok: false, error: "No se pudo cambiar el estado." };
  if (!data?.length) return NOT_FOUND_OR_DENIED;
  return { ok: true, caseId: params.caseId };
}

export async function changeCasePriority(
  params: CaseParams & { caseId: string; priority: CasePriority },
): Promise<CaseResult> {
  if (params.profile.role === "viewer") return VIEWER;
  if (!CASE_PRIORITIES.includes(params.priority)) return { ok: false, error: "Prioridad inválida." };

  const { data, error } = await params.userClient
    .from("cases")
    .update({ priority: params.priority })
    .eq("id", params.caseId)
    .select("id");

  if (error) return { ok: false, error: "No se pudo cambiar la prioridad." };
  if (!data?.length) return NOT_FOUND_OR_DENIED;
  return { ok: true, caseId: params.caseId };
}
