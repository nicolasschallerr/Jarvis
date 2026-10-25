import type { SupabaseClient } from "@supabase/supabase-js";

import type { ModelClient } from "@/lib/ai/types";
import { checkSendable, sendTextMessage } from "@/lib/outbound/send";
import type { Database } from "@/lib/supabase/database.types";

import { buildHistory, buildSystemPrompt, handoffText, isMenuCommand, sinceLastMenu } from "./context";
import { loadAttentionAgent, loadHistoryRows, loadInlineMedia } from "./load";
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

// Cuántas veces una misma ejecución vuelve a empezar si llegan mensajes nuevos mientras piensa.
const MAX_CATCH_UP = 3;

// Duración del turno; se renueva al empezar cada vuelta para que una respuesta larga no lo pierda a mitad.
const TURN_SECONDS = 180;

type TurnContext = {
  admin: SupabaseClient<Database>;
  client: ModelClient;
  conversationId: string;
  organizationId: string;
  agent: Extract<Awaited<ReturnType<typeof loadAttentionAgent>>, { ok: true }>["agent"];
  now: Date;
  fetchImpl?: Params["fetchImpl"];
};

// Responde a un mensaje del asociado: arma el contexto, deja trabajar al modelo con sus herramientas
// y envía la respuesta por el mismo canal. Nunca lanza: devuelve el resultado, porque el mensaje
// recibido ya está guardado y un fallo de la IA no debe invalidarlo.
//
// Una sola ejecución responde a la vez en cada conversación (turno con vencimiento, ADR-027): las pasadas del
// trabajador pueden superponerse y, sin turno, dos ejecuciones contestaban el mismo chat (o ninguna). Si
// mientras el modelo pensaba llegó otro mensaje, la misma ejecución vuelve a empezar con el contexto completo.
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

  const loaded = await loadAttentionAgent(admin, conversation.organization_id);
  if (!loaded.ok) return { status: loaded.status, reason: loaded.reason };

  const { data: claimed } = await admin.rpc("claim_agent_turn", { p_conversation_id: params.conversationId, p_seconds: TURN_SECONDS });
  // Otra ejecución está respondiendo esta conversación: ella va a ver este mensaje al terminar.
  if (!claimed) return skipped("otra_ejecucion_en_curso");

  await admin.from("agents").update({ status: "working" }).eq("id", loaded.agent.agentId);

  const context: TurnContext = {
    admin,
    client,
    conversationId: params.conversationId,
    organizationId: conversation.organization_id,
    agent: loaded.agent,
    now,
    fetchImpl: params.fetchImpl,
  };

  try {
    for (let round = 0; round < MAX_CATCH_UP; round += 1) {
      if (round > 0) await admin.rpc("extend_agent_turn", { p_conversation_id: params.conversationId, p_seconds: TURN_SECONDS });
      const outcome = await respondOnce(context);
      if (outcome !== "newer-message") return outcome;
    }
    return skipped("llegan_mensajes_sin_parar");
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "Error desconocido" };
  } finally {
    await admin.rpc("release_agent_turn", { p_conversation_id: params.conversationId });
    await admin.from("agents").update({ status: "paused" }).eq("id", loaded.agent.agentId);
  }
}

// Un intento de respuesta con el historial de este momento. Devuelve "newer-message" si mientras tanto llegó
// otro mensaje del asociado (y entonces no envía nada: hay que volver a empezar con todo el contexto).
async function respondOnce(context: TurnContext): Promise<AttentionResult | "newer-message"> {
  const { admin, conversationId, now } = context;
  const { config, settings } = context.agent;

  const ordered = await loadHistoryRows(admin, conversationId);
  if (!ordered) return { status: "failed", reason: "No se pudo leer el historial" };

  const latest = ordered[ordered.length - 1];
  // Si lo último no es del asociado, ya se le contestó (o escribió un operador): no se responde dos veces.
  if (!latest || latest.direction !== "inbound") return skipped("ya_respondido");

  // Comando MENÚ: el sistema contesta el menú principal sin llamar al modelo y reinicia los reintentos.
  if (settings.menuText && latest.type === "text" && isMenuCommand(latest.body)) {
    await admin.rpc("agent_reset_attempts", { p_conversation_id: conversationId });
    await sendTextMessage(admin, { conversationId, text: settings.menuText.slice(0, 4000), sender: "agent", now, fetchImpl: context.fetchImpl });
    return { status: "replied", text: settings.menuText };
  }

  // Si el mensaje no va a poder salir (canal sin envío o ventana de 24 h cerrada), no se paga el modelo.
  const sendable = await checkSendable(admin, conversationId, now);
  if (!sendable.ok) return skipped(sendable.reason);

  const visible = sinceLastMenu(ordered);
  const history = buildHistory(visible, await loadInlineMedia(admin, visible));
  if (history.length === 0) return skipped("sin_mensajes_para_responder");

  const tools = createAttentionTools(createSupabaseBackend(admin, conversationId), {
    unitSlugs: settings.units.map((unit) => unit.id),
    sectorSlugs: settings.sectors.map((sector) => sector.id),
    fields: settings.fields,
    maxFieldRetries: settings.maxFieldRetries,
  });

  const record = {
    organizationId: context.organizationId,
    conversationId,
    messageId: latest.id,
    agentConfigId: config.id,
    model: config.model,
    pricing: settings.pricing,
  };

  let result;
  try {
    result = await runAgentLoop({ client: context.client, model: config.model, system: buildSystemPrompt(config.prompt, settings, now), history, tools });
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

  // Si mientras el modelo pensaba llegó otro mensaje del asociado, se vuelve a empezar con el contexto completo
  // (las herramientas ya guardaron lo que correspondía; la respuesta se arma de nuevo).
  // Y si mientras tanto una persona del equipo tomó el chat o contestó, el agente no escribe encima.
  const [{ data: newest }, { data: current }] = await Promise.all([
    admin
      .from("messages")
      .select("id, direction")
      .eq("conversation_id", conversationId)
      .neq("status", "failed")
      .order("provider_timestamp", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin.from("conversations").select("ai_enabled").eq("id", conversationId).maybeSingle(),
  ]);
  if (!current?.ai_enabled) return skipped("una_persona_tomo_el_chat");
  if (newest && newest.id !== latest.id) return newest.direction === "inbound" ? "newer-message" : skipped("una_persona_respondio");

  const texts = [result.text, official].filter((text): text is string => Boolean(text));
  if (texts.length === 0) return skipped("el_modelo_no_escribio_respuesta");

  // Todo en un solo mensaje: la respuesta del agente y, si derivó, el mensaje oficial a continuación.
  // Menos mensajes seguidos se sienten más como hablar con una persona.
  const reply = texts.join("\n\n");
  await sendTextMessage(admin, { conversationId, text: reply.slice(0, 4000), sender: "agent", now, fetchImpl: context.fetchImpl });

  return { status: "replied", text: reply };
}
