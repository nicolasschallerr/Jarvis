import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type AgentResult = { ok: true } | { ok: false; error: string };

type UpdateAgentParams = {
  // Cliente que actúa como el usuario: RLS (agents_write) también exige superadmin.
  userClient: SupabaseClient<Database>;
  profile: { role: "superadmin" | "operator" | "viewer" };
  agentId: string;
  name: string;
  // Opcional: la pantalla de Agentes ya no la edita (cada agente tiene una descripción fija); si no llega, no se toca.
  tagline?: string;
  isEnabled: boolean;
};

// Cambia el nombre, la frase y si el agente está encendido. Solo superadmin. El estado en vivo
// (working/paused) no se toca acá: lo escribe el motor.
export async function updateAgent(params: UpdateAgentParams): Promise<AgentResult> {
  if (params.profile.role !== "superadmin") {
    return { ok: false, error: "Solo un superadministrador puede cambiar los agentes." };
  }

  const name = params.name.trim();
  const tagline = params.tagline?.trim();
  if (name.length < 1 || name.length > 40) return { ok: false, error: "El nombre tiene que tener entre 1 y 40 caracteres." };
  if (tagline !== undefined && tagline.length > 140) return { ok: false, error: "La frase no puede superar los 140 caracteres." };

  const { data: agent } = await params.userClient.from("agents").select("id, kind, is_enabled").eq("id", params.agentId).maybeSingle();
  if (!agent) return { ok: false, error: "El agente no existe." };

  // Un agente de atención sin configuración no tiene con qué conversar: no se enciende en vacío.
  if (params.isEnabled && !agent.is_enabled && agent.kind === "attention") {
    const { data: config } = await params.userClient
      .from("agent_configs")
      .select("id")
      .eq("kind", "attention")
      .eq("is_active", true)
      .maybeSingle();
    if (!config) {
      return { ok: false, error: "No se puede encender: falta cargar la configuración del agente (script de configuración del cliente)." };
    }
  }

  const { error } = await params.userClient
    .from("agents")
    // El Asistente está siempre encendido (ADR-050): se ignora lo que llegue del formulario.
    .update({ name, ...(tagline !== undefined ? { tagline: tagline || null } : {}), is_enabled: agent.kind === "assistant" ? true : params.isEnabled })
    .eq("id", params.agentId);
  if (error) return { ok: false, error: "No se pudo guardar el agente." };

  return { ok: true };
}
