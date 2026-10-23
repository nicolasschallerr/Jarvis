import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export const HOME_LIST_SIZE = 5;

// Datos del Inicio: cuánto hay para atender y a quién. Todo se lee con la sesión del usuario (RLS) y la
// lectura es abierta en la organización (ADR-016). Son números reales de la base: nada de esto lo
// inventa un agente.
export async function getHomeSummary(params: { userClient: SupabaseClient<Database>; userId: string }) {
  const { userClient, userId } = params;

  const openCases = () => userClient.from("cases").select("id", { count: "exact", head: true }).neq("status", "resolved");

  const [awaiting, mine, unassigned, urgent, awaitingList, myCases, agents] = await Promise.all([
    // Conversaciones cuyo último mensaje es del contacto: esperan una respuesta.
    userClient.from("conversation_summaries").select("id", { count: "exact", head: true }).eq("last_direction", "inbound"),
    openCases().eq("assigned_to", userId),
    openCases().is("assigned_to", null),
    openCases().eq("priority", "urgent"),
    userClient
      .from("conversation_summaries")
      .select("id, contact_name, channel_type, last_body, last_type, last_message_at")
      .eq("last_direction", "inbound")
      .order("last_message_at", { ascending: false })
      .limit(HOME_LIST_SIZE),
    userClient
      .from("cases")
      .select("id, title, status, priority, conversation_id, updated_at, contacts(display_name)")
      .neq("status", "resolved")
      .eq("assigned_to", userId)
      .order("priority", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(HOME_LIST_SIZE),
    userClient.from("agents").select("id, kind, name, tagline, status, is_enabled").order("kind"),
  ]);

  return {
    counts: {
      awaitingReply: awaiting.count ?? 0,
      myOpenCases: mine.count ?? 0,
      unassignedCases: unassigned.count ?? 0,
      urgentCases: urgent.count ?? 0,
    },
    awaitingList: awaitingList.data ?? [],
    myCases: myCases.data ?? [],
    agents: agents.data ?? [],
    failed: [awaiting, mine, unassigned, urgent, awaitingList, myCases, agents].some((result) => result.error),
  };
}
