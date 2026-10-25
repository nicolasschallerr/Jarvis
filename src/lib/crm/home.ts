import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export const HOME_LIST_SIZE = 5;

// Datos del Inicio: cuánto hay para atender y a quién. Todo se lee con la sesión del usuario (RLS) y la
// lectura es abierta en la organización (ADR-016). Son números reales de la base: nada de esto lo
// inventa un agente.
export async function getHomeSummary(params: { userClient: SupabaseClient<Database>; userId: string }) {
  const { userClient, userId } = params;

  const [counts, awaitingList, myCases, agents] = await Promise.all([
    // Los cuatro conteos en una sola consulta (función de la base): esperan respuesta, mis casos, sin asignar y urgentes.
    userClient.rpc("home_counts", { p_user_id: userId }),
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

  const numbers = (counts.data ?? {}) as Record<string, number>;

  return {
    counts: {
      awaitingReply: numbers.awaiting ?? 0,
      myOpenCases: numbers.mine ?? 0,
      unassignedCases: numbers.unassigned ?? 0,
      urgentCases: numbers.urgent ?? 0,
    },
    awaitingList: awaitingList.data ?? [],
    myCases: myCases.data ?? [],
    agents: agents.data ?? [],
    failed: [counts, awaitingList, myCases, agents].some((result) => result.error),
  };
}
