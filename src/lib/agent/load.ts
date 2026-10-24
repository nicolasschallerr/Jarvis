import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import { attentionSettingsSchema, type AttentionSettings, type HistoryRow } from "./context";

export type LoadedAgent = {
  agentId: string;
  config: { id: string; model: string; prompt: string };
  settings: AttentionSettings;
};

export type LoadAgentResult =
  | { ok: true; agent: LoadedAgent }
  | { ok: false; status: "skipped" | "failed"; reason: string };

// Lo que necesita el agente de atención de una organización para trabajar: que esté encendido y que
// tenga una configuración activa y válida. Lo usan la respuesta a un mensaje y el envío de las
// respuestas del área.
export async function loadAttentionAgent(
  admin: SupabaseClient<Database>,
  organizationId: string,
): Promise<LoadAgentResult> {
  const { data: agent } = await admin
    .from("agents")
    .select("id, is_enabled")
    .eq("organization_id", organizationId)
    .eq("kind", "attention")
    .maybeSingle();
  if (!agent?.is_enabled) return { ok: false, status: "skipped", reason: "agente_apagado" };

  const { data: config } = await admin
    .from("agent_configs")
    .select("id, model, prompt, settings")
    .eq("organization_id", organizationId)
    .eq("kind", "attention")
    .eq("is_active", true)
    .maybeSingle();
  if (!config) return { ok: false, status: "skipped", reason: "sin_configuracion_activa" };

  const settings = attentionSettingsSchema.safeParse(config.settings);
  if (!settings.success) return { ok: false, status: "failed", reason: "La configuración del agente no es válida" };

  return {
    ok: true,
    agent: { agentId: agent.id, config: { id: config.id, model: config.model, prompt: config.prompt }, settings: settings.data },
  };
}

// Cuántos mensajes del historial se le muestran al agente. Alcanza para una gestión; las
// conversaciones largas se resumirán más adelante.
export const HISTORY_LIMIT = 30;

// Los últimos mensajes de la conversación, del más viejo al más nuevo.
export async function loadHistoryRows(
  admin: SupabaseClient<Database>,
  conversationId: string,
): Promise<Array<HistoryRow & { id: string }> | null> {
  const { data: rows, error } = await admin
    .from("messages")
    .select("id, direction, type, body, transcription")
    .eq("conversation_id", conversationId)
    .order("provider_timestamp", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) return null;
  return [...(rows ?? [])].reverse() as Array<HistoryRow & { id: string }>;
}
