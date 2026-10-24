import type { SupabaseClient } from "@supabase/supabase-js";

import type { ModelClient } from "@/lib/ai/types";
import { sendTextMessage } from "@/lib/outbound/send";
import type { Database } from "@/lib/supabase/database.types";

import { attentionSettingsSchema, buildHistory, buildSystemPrompt, type HistoryRow } from "./context";
import { runAgentLoop } from "./loop";
import { recordAiCalls } from "./record";
import { createAttentionTools } from "./tools";

export type AttentionResult =
  | { status: "replied"; text: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

// Cuántos mensajes del historial se le muestran al agente. Alcanza para una gestión; las
// conversaciones largas se resumirán más adelante.
const HISTORY_LIMIT = 30;

type Params = {
  conversationId: string;
  // Mensaje del asociado que dispara la respuesta.
  messageId: string;
  now?: Date;
  // Solo para pruebas: reemplaza la llamada de red al canal.
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
};

function skipped(reason: string): AttentionResult {
  return { status: "skipped", reason };
}

// Responde a un mensaje del asociado: arma el contexto, deja trabajar al modelo con sus herramientas
// y envía la respuesta por el mismo canal. Nunca lanza: devuelve el resultado, porque el mensaje
// recibido ya está guardado y un fallo de la IA no debe invalidarlo.
export async function respondToMessage(
  admin: SupabaseClient<Database>,
  client: ModelClient,
  params: Params,
): Promise<AttentionResult> {
  const now = params.now ?? new Date();

  const { data: conversation, error: conversationError } = await admin
    .from("conversations")
    .select("id, organization_id, ai_enabled")
    .eq("id", params.conversationId)
    .maybeSingle();
  if (conversationError || !conversation) return { status: "failed", reason: "No se encontró la conversación" };

  // Interruptor de IA: si un operador tomó el chat o el agente está apagado, no se responde.
  if (!conversation.ai_enabled) return skipped("ia_apagada_en_la_conversacion");

  const organizationId = conversation.organization_id;

  const { data: agent } = await admin
    .from("agents")
    .select("id, is_enabled")
    .eq("organization_id", organizationId)
    .eq("kind", "attention")
    .maybeSingle();
  if (!agent?.is_enabled) return skipped("agente_apagado");

  const { data: config } = await admin
    .from("agent_configs")
    .select("id, model, prompt, settings")
    .eq("organization_id", organizationId)
    .eq("kind", "attention")
    .eq("is_active", true)
    .maybeSingle();
  if (!config) return skipped("sin_configuracion_activa");

  const settings = attentionSettingsSchema.safeParse(config.settings);
  if (!settings.success) return { status: "failed", reason: "La configuración del agente no es válida" };

  const { data: rows, error: rowsError } = await admin
    .from("messages")
    .select("id, direction, type, body, transcription")
    .eq("conversation_id", params.conversationId)
    .order("provider_timestamp", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (rowsError) return { status: "failed", reason: "No se pudo leer el historial" };

  const ordered = [...(rows ?? [])].reverse();
  const latest = ordered[ordered.length - 1];
  // Si lo último no es del asociado, ya se le contestó (o escribió un operador): no se responde dos veces.
  if (!latest || latest.direction !== "inbound") return skipped("ya_respondido");

  const history = buildHistory(ordered as HistoryRow[]);
  if (history.length === 0) return skipped("sin_mensajes_para_responder");

  await admin.from("agents").update({ status: "working" }).eq("id", agent.id);

  try {
    const tools = createAttentionTools(admin, {
      conversationId: params.conversationId,
      unitSlugs: settings.data.units.map((unit) => unit.id),
      sectorSlugs: settings.data.sectors.map((sector) => sector.id),
    });

    let result;
    try {
      result = await runAgentLoop({
        client,
        model: config.model,
        system: buildSystemPrompt(config.prompt, settings.data, now),
        history,
        tools,
      });
    } catch (error) {
      // Solo el motivo, nunca el contenido de la conversación.
      const reason = error instanceof Error ? error.message : "Error desconocido";
      await recordAiCalls(admin, {
        organizationId,
        conversationId: params.conversationId,
        messageId: params.messageId,
        agentConfigId: config.id,
        model: config.model,
        pricing: settings.data.pricing,
        steps: [],
        error: reason,
      });
      return { status: "failed", reason };
    }

    await recordAiCalls(admin, {
      organizationId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      agentConfigId: config.id,
      model: config.model,
      pricing: settings.data.pricing,
      steps: result.steps,
    });

    if (!result.text) return skipped("el_modelo_no_escribio_respuesta");

    // Si mientras el modelo pensaba llegó otro mensaje del asociado, esa otra ejecución responde con
    // el contexto completo; contestar acá dejaría dos respuestas cruzadas.
    const { data: newest } = await admin
      .from("messages")
      .select("id")
      .eq("conversation_id", params.conversationId)
      .eq("direction", "inbound")
      .order("provider_timestamp", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (newest && newest.id !== latest.id) return skipped("llego_un_mensaje_mas_nuevo");

    await sendTextMessage(admin, {
      conversationId: params.conversationId,
      text: result.text.slice(0, 4000),
      sender: "agent",
      now,
      fetchImpl: params.fetchImpl,
    });

    return { status: "replied", text: result.text };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "Error desconocido" };
  } finally {
    await admin.from("agents").update({ status: "paused" }).eq("id", agent.id);
  }
}
