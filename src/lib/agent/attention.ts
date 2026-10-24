import type { SupabaseClient } from "@supabase/supabase-js";

import type { ModelClient } from "@/lib/ai/types";
import { sendTextMessage } from "@/lib/outbound/send";
import type { Database } from "@/lib/supabase/database.types";

import { buildHistory, buildSystemPrompt, handoffText, isMenuCommand, sinceLastMenu } from "./context";
import { loadAttentionAgent, loadHistoryRows } from "./load";
import { runAgentLoop } from "./loop";
import { recordAiCalls } from "./record";
import { createAttentionTools, createSupabaseBackend } from "./tools";

export type AttentionResult =
  | { status: "replied"; text: string }
  | { status: "skipped"; reason: string }
  | { status: "failed"; reason: string };

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

  const loaded = await loadAttentionAgent(admin, organizationId);
  if (!loaded.ok) return { status: loaded.status, reason: loaded.reason };
  const { agentId, config, settings } = loaded.agent;

  const ordered = await loadHistoryRows(admin, params.conversationId);
  if (!ordered) return { status: "failed", reason: "No se pudo leer el historial" };

  const latest = ordered[ordered.length - 1];
  // Si lo último no es del asociado, ya se le contestó (o escribió un operador): no se responde dos veces.
  if (!latest || latest.direction !== "inbound") return skipped("ya_respondido");

  // Comando MENÚ: el sistema contesta el menú principal sin llamar al modelo y reinicia los reintentos.
  if (settings.menuText && latest.type === "text" && isMenuCommand(latest.body)) {
    await admin.rpc("agent_reset_attempts", { p_conversation_id: params.conversationId });
    await sendTextMessage(admin, {
      conversationId: params.conversationId,
      text: settings.menuText.slice(0, 4000),
      sender: "agent",
      now,
      fetchImpl: params.fetchImpl,
    });
    return { status: "replied", text: settings.menuText };
  }

  const history = buildHistory(sinceLastMenu(ordered));
  if (history.length === 0) return skipped("sin_mensajes_para_responder");

  await admin.from("agents").update({ status: "working" }).eq("id", agentId);

  try {
    const tools = createAttentionTools(createSupabaseBackend(admin, params.conversationId), {
      unitSlugs: settings.units.map((unit) => unit.id),
      sectorSlugs: settings.sectors.map((sector) => sector.id),
      fields: settings.fields,
      maxFieldRetries: settings.maxFieldRetries,
    });

    const record = {
      organizationId,
      conversationId: params.conversationId,
      messageId: params.messageId,
      agentConfigId: config.id,
      model: config.model,
      pricing: settings.pricing,
    };

    let result;
    try {
      result = await runAgentLoop({
        client,
        model: config.model,
        system: buildSystemPrompt(config.prompt, settings, now),
        history,
        tools,
      });
    } catch (error) {
      // Solo el motivo, nunca el contenido de la conversación.
      const reason = error instanceof Error ? error.message : "Error desconocido";
      await recordAiCalls(admin, { ...record, steps: [], error: reason });
      return { status: "failed", reason };
    }

    await recordAiCalls(admin, { ...record, steps: result.steps });

    // Mensaje oficial de derivación: lo manda el sistema, no el modelo, para que salga idéntico siempre.
    const handoff = result.steps
      .flatMap((step) => step.toolCalls)
      .filter((call) => call.decision?.action === "handoff" && !call.isError)
      .at(-1)?.decision;
    const official =
      handoff && typeof handoff.sector === "string"
        ? handoffText(settings, handoff.sector, typeof handoff.unit === "string" ? handoff.unit : null)
        : null;

    const texts = [result.text, official].filter((text): text is string => Boolean(text));
    if (texts.length === 0) return skipped("el_modelo_no_escribio_respuesta");

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

    for (const text of texts) {
      await sendTextMessage(admin, {
        conversationId: params.conversationId,
        text: text.slice(0, 4000),
        sender: "agent",
        now,
        fetchImpl: params.fetchImpl,
      });
    }

    return { status: "replied", text: texts.join("\n\n") };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "Error desconocido" };
  } finally {
    await admin.from("agents").update({ status: "paused" }).eq("id", agentId);
  }
}
