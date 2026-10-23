import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export const MAX_NOTE_LENGTH = 2000;

export type NoteResult = { ok: true } | { ok: false; error: string };

// Agrega una nota interna a una conversación. Si hay un caso abierto, la nota queda también atada a él.
// Las notas son solo para el equipo: viven en su propia tabla y nunca salen por ningún canal.
export async function addNote(params: {
  // Cliente que actúa como el usuario: RLS decide qué conversaciones ve y qué puede escribir.
  userClient: SupabaseClient<Database>;
  profile: { id: string; role: "superadmin" | "operator" | "viewer"; organizationId: string };
  conversationId: string;
  body: string;
}): Promise<NoteResult> {
  if (params.profile.role === "viewer") {
    return { ok: false, error: "Tu rol es de consulta: no puede escribir notas." };
  }

  const body = params.body.trim();
  if (!body) return { ok: false, error: "Escribí la nota antes de guardarla." };
  if (body.length > MAX_NOTE_LENGTH) return { ok: false, error: `La nota supera los ${MAX_NOTE_LENGTH} caracteres.` };

  const { data: conversation } = await params.userClient
    .from("conversations")
    .select("id")
    .eq("id", params.conversationId)
    .maybeSingle();
  if (!conversation) return { ok: false, error: "La conversación no existe." };

  const { data: openCase } = await params.userClient
    .from("cases")
    .select("id")
    .eq("conversation_id", params.conversationId)
    .neq("status", "resolved")
    .maybeSingle();

  const { error } = await params.userClient.from("internal_notes").insert({
    organization_id: params.profile.organizationId,
    conversation_id: params.conversationId,
    case_id: openCase?.id ?? null,
    author_id: params.profile.id,
    body,
  });

  if (error) return { ok: false, error: "No se pudo guardar la nota." };
  return { ok: true };
}
