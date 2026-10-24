import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type CaseListView = "mine" | "unassigned" | "sector" | "all";

export const CASE_LIST_VIEWS: CaseListView[] = ["mine", "unassigned", "sector", "all"];

export const CASE_LIST_LIMIT = 200;

const SELECT =
  "id, title, status, priority, sector_id, assigned_to, conversation_id, opened_at, updated_at, contacts(display_name), sectors(name), assignee:profiles!cases_assigned_to_fkey(full_name)";

// Lista casos para las pantallas de trabajo. La lectura es abierta en la organización (ADR-016), así
// que cualquier usuario puede listar cualquier vista; RLS solo limita por organización. Orden: lo más
// urgente primero y, a igual prioridad, lo que se movió más recientemente.
export async function listCases(params: {
  userClient: SupabaseClient<Database>;
  view: CaseListView;
  userId: string;
  sectorId?: string | null;
  includeResolved?: boolean;
  // Solo los resueltos (el tablero muestra los últimos). Tiene prioridad sobre includeResolved.
  resolvedOnly?: boolean;
  limit?: number;
}) {
  if (params.view === "sector" && !params.sectorId) return [];

  let query = params.userClient.from("cases").select(SELECT);

  if (params.resolvedOnly) query = query.eq("status", "resolved");
  else if (!params.includeResolved) query = query.neq("status", "resolved");
  if (params.view === "mine") query = query.eq("assigned_to", params.userId);
  if (params.view === "unassigned") query = query.is("assigned_to", null);
  if (params.view === "sector" && params.sectorId) query = query.eq("sector_id", params.sectorId);

  // Los resueltos, del más reciente al más viejo; el resto, lo más urgente primero.
  const ordered = params.resolvedOnly ? query : query.order("priority", { ascending: false });
  const { data, error } = await ordered
    .order("updated_at", { ascending: false })
    .limit(params.limit ?? CASE_LIST_LIMIT);

  if (error) throw new Error(`No se pudieron listar los casos: ${error.message}`);
  return data ?? [];
}
