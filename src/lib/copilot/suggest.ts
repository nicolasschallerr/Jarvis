import type { SupabaseClient } from "@supabase/supabase-js";

import { appendNotice } from "@/lib/agent/area-replies";
import { buildHistory, buildSystemPrompt, sinceLastMenu } from "@/lib/agent/context";
import { loadAttentionAgent, loadHistoryRows, loadInlineMedia } from "@/lib/agent/load";
import { runAgentLoop } from "@/lib/agent/loop";
import { recordAiCalls } from "@/lib/agent/record";
import type { ModelClient } from "@/lib/ai/types";
import { formatForChannel } from "@/lib/outbound/format";
import type { Database } from "@/lib/supabase/database.types";

// El copiloto le redacta a una PERSONA del equipo un borrador de respuesta para la conversación que tiene abierta. No
// envía nada: el texto va al cuadro de respuesta, la persona lo lee, lo edita y lo manda ella. Usa el mismo prompt y el
// mismo conocimiento que el agente de atención (así no se contradicen), sin herramientas: no guarda datos ni deriva.

export const MAX_SUGGESTION_LENGTH = 1500;

const COPILOT_NOTICE =
  "[Instrucción interna, no es un mensaje de la persona] Una persona del equipo va a responder esta conversación y te pide un borrador. Escribí SOLO el texto del próximo mensaje que mandaría el equipo, listo para enviar: sin explicaciones tuyas, sin comillas y sin avisar que sos un asistente ni que es un borrador. Respondé lo último que dijo la persona con lo que está en la base de conocimiento; si falta un dato que hay que confirmar, no lo inventes: escribí el mensaje pidiendo lo que falta o avisando que lo van a confirmar. Mensaje breve, en el tono de siempre.";

export type SuggestResult = { ok: true; text: string } | { ok: false; error: string };

export async function suggestReply(params: {
  // Con la sesión de quien pide: la conversación tiene que ser visible para esa persona (RLS).
  userClient: SupabaseClient<Database>;
  admin: SupabaseClient<Database>;
  modelClient: ModelClient | null;
  profile: { role: "superadmin" | "operator" | "viewer"; organizationId: string };
  conversationId: string;
  now?: Date;
}): Promise<SuggestResult> {
  if (params.profile.role === "viewer") return { ok: false, error: "Tu rol es de consulta: no puede pedir borradores." };
  if (!params.modelClient) return { ok: false, error: "El copiloto todavía no está conectado: falta la clave de Anthropic." };

  const now = params.now ?? new Date();

  const { data: conversation } = await params.userClient
    .from("conversation_summaries")
    .select("id, channel_type")
    .eq("id", params.conversationId)
    .maybeSingle();
  if (!conversation) return { ok: false, error: "La conversación no existe." };

  const loaded = await loadAttentionAgent(params.admin, params.profile.organizationId);
  if (!loaded.ok) {
    return {
      ok: false,
      error: loaded.status === "skipped" ? "Para pedir borradores hace falta que el agente de atención esté configurado y encendido." : "La configuración del agente no es válida.",
    };
  }
  const { config, settings } = loaded.agent;

  const rows = await loadHistoryRows(params.admin, params.conversationId);
  if (!rows) return { ok: false, error: "No se pudo leer la conversación." };
  const visible = sinceLastMenu(rows);
  if (visible.length === 0) return { ok: false, error: "Todavía no hay mensajes para responder." };

  const history = appendNotice(buildHistory(visible, await loadInlineMedia(params.admin, visible)), COPILOT_NOTICE);
  const record = {
    organizationId: params.profile.organizationId,
    conversationId: params.conversationId,
    messageId: null,
    agentConfigId: config.id,
    agentKind: "copilot" as const,
    model: config.model,
    pricing: settings.pricing,
  };

  try {
    const run = await runAgentLoop({
      client: params.modelClient,
      model: config.model,
      system: buildSystemPrompt(config.prompt, settings, now, conversation.channel_type),
      history,
      tools: [],
      maxSteps: 1,
      maxTokens: 700,
    });
    await recordAiCalls(params.admin, { ...record, steps: run.steps });

    const text = formatForChannel(run.text, conversation.channel_type ?? "whatsapp")
      .replace(/^["«“]|["»”]$/g, "")
      .trim()
      .slice(0, MAX_SUGGESTION_LENGTH);
    if (!text) return { ok: false, error: "El copiloto no pudo armar un borrador. Probá de nuevo o escribilo vos." };
    return { ok: true, text };
  } catch (error) {
    // Solo el motivo, nunca el contenido de la conversación.
    await recordAiCalls(params.admin, { ...record, steps: [], error: error instanceof Error ? error.message : "Error desconocido" });
    return { ok: false, error: "No se pudo pedir el borrador. Probá de nuevo en un rato." };
  }
}
