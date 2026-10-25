import { cache } from "react";

import { createClient } from "@/lib/supabase/server";

// Nombre genérico cuando el cliente todavía no configuró a sus agentes.
export const DEFAULT_ATTENTION_NAME = "el agente";

export type AgentNames = { attention: string; analytic: string };

// Cómo se llaman los agentes de la organización (lo configura cada cliente: "Jarvis", "Sofía"...). La interfaz los
// nombra así en vez de un nombre fijo. Se lee una vez por pedido (cache de React).
export const getAgentNames = cache(async (): Promise<AgentNames> => {
  const supabase = await createClient();
  const { data } = await supabase.from("agents").select("kind, name");
  const byKind = new Map((data ?? []).map((agent) => [agent.kind, agent.name]));
  return {
    attention: byKind.get("attention") ?? DEFAULT_ATTENTION_NAME,
    analytic: byKind.get("analytic") ?? "el agente analítico",
  };
});
