import type { SupabaseClient } from "@supabase/supabase-js";

import type { ChatMessage, ModelClient } from "@/lib/ai/types";
import { ChannelSendError } from "@/lib/outbound/errors";
import { checkSendable, sendTextMessage } from "@/lib/outbound/send";
import type { Database } from "@/lib/supabase/database.types";

import { buildHistory, buildSystemPrompt } from "./context";
import { loadAttentionAgent, loadHistoryRows, loadInlineMedia } from "./load";
import { runAgentLoop } from "./loop";
import { recordAiCalls } from "./record";

export type AreaRepliesResult = { delivered: number; skipped: number; failed: number };

type Params = {
  now?: Date;
  limit?: number;
  // Solo para pruebas: reemplaza la llamada de red al canal.
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
};

// Aviso interno que el agente recibe como último turno. Deja claro que no lo escribió el asociado y que
// el dato lo confirmó el sector: el agente lo transmite, no agrega nada que no esté en la respuesta.
export function areaAnswerNotice(sectorName: string, question: string, answer: string): string {
  return [
    `[Aviso interno del sistema, no lo escribió el asociado] El sector ${sectorName} respondió la consulta que le hiciste.`,
    `Consulta: ${question}`,
    `Respuesta del sector: ${answer}`,
    "Escribile al asociado un mensaje breve que le transmita esta respuesta tal como la confirmó el sector, sin agregar datos que no estén en ella. Si con esto no se cierra el tema, decile qué sigue.",
  ].join("\n");
}

// Agrega el aviso al final del historial. La API exige que los turnos se alternen: si lo último fue del
// asociado, el aviso se suma a ese mismo turno.
export function appendNotice(history: ChatMessage[], notice: string): ChatMessage[] {
  const last = history[history.length - 1];
  if (last?.role === "user" && typeof last.content === "string") {
    return [...history.slice(0, -1), { role: "user", content: `${last.content}\n\n${notice}` }];
  }
  return [...history, { role: "user", content: notice }];
}

// Envía al asociado las respuestas que dieron los sectores a las consultas del agente. El agente
// redacta el mensaje (sin herramientas: solo transmite) y lo manda por el mismo chat.
//
// Para no mandar dos veces la misma respuesta si dos ejecuciones del trabajador coinciden, cada
// respuesta se reserva marcando reply_sent_at ANTES de enviar; si algo falla, la marca se borra y se
// reintenta en otra pasada, hasta MAX_REPLY_ATTEMPTS veces (ADR-027): cada intento paga el modelo.
// Antes de llamar al modelo se comprueba que el mensaje pueda salir (canal con envío, ventana abierta).
export async function deliverAreaAnswers(
  admin: SupabaseClient<Database>,
  client: ModelClient,
  params: Params = {},
): Promise<AreaRepliesResult> {
  const now = params.now ?? new Date();
  const result: AreaRepliesResult = { delivered: 0, skipped: 0, failed: 0 };

  const { data: pending, error } = await admin
    .from("area_queries")
    .select("id, organization_id, conversation_id, question, answer, reply_attempts, sectors(name)")
    .eq("status", "answered")
    .is("reply_sent_at", null)
    .lt("reply_attempts", MAX_REPLY_ATTEMPTS)
    .order("answered_at", { ascending: true })
    // Se leen más de las que se procesan: las que hoy no pueden salir se saltean sin costo y no tapan a las demás.
    .limit(50);
  if (error) throw new Error(`No se pudieron leer las respuestas del área: ${error.message}`);

  const maxModelCalls = params.limit ?? 10;
  for (const query of pending ?? []) {
    if (result.delivered + result.failed >= maxModelCalls) break;
    const outcome = await deliverOne(admin, client, query, now, params.fetchImpl);
    result[outcome] += 1;
  }

  return result;
}

export const MAX_REPLY_ATTEMPTS = 3;

type PendingAnswer = {
  id: string;
  organization_id: string;
  conversation_id: string | null;
  question: string;
  answer: string | null;
  reply_attempts: number;
  sectors: { name: string } | null;
};

async function deliverOne(
  admin: SupabaseClient<Database>,
  client: ModelClient,
  query: PendingAnswer,
  now: Date,
  fetchImpl: Params["fetchImpl"],
): Promise<keyof AreaRepliesResult> {
  if (!query.conversation_id || !query.answer) return "skipped";
  const conversationId = query.conversation_id;

  // Si un operador tomó el chat, la respuesta queda a la vista en el caso y la transmite él.
  const { data: conversation } = await admin.from("conversations").select("ai_enabled").eq("id", conversationId).maybeSingle();
  if (!conversation?.ai_enabled) return "skipped";

  // Si hoy no puede salir (canal sin envío o fuera de la ventana), no se paga el modelo: queda a la vista en el caso.
  const sendable = await checkSendable(admin, conversationId, now);
  if (!sendable.ok) return "skipped";

  const loaded = await loadAttentionAgent(admin, query.organization_id);
  if (!loaded.ok) return loaded.status === "skipped" ? "skipped" : "failed";
  const { agentId, config, settings } = loaded.agent;

  const { data: claimed } = await admin
    .from("area_queries")
    .update({ reply_sent_at: now.toISOString() })
    .eq("id", query.id)
    .is("reply_sent_at", null)
    .select("id");
  // Otra ejecución la tomó primero.
  if (!claimed?.length) return "skipped";

  // Se libera para otro intento y se cuenta. Un rechazo definitivo del canal agota los intentos de una vez.
  const release = (reason: string, permanent = false) =>
    admin
      .from("area_queries")
      .update({
        reply_sent_at: null,
        reply_attempts: permanent ? MAX_REPLY_ATTEMPTS : query.reply_attempts + 1,
        reply_error: reason.slice(0, 300),
      })
      .eq("id", query.id);

  const rows = await loadHistoryRows(admin, conversationId);
  if (!rows) {
    await release("No se pudo leer el historial");
    return "failed";
  }

  const history = appendNotice(buildHistory(rows, await loadInlineMedia(admin, rows)), areaAnswerNotice(query.sectors?.name ?? "consultado", query.question, query.answer));

  await admin.from("agents").update({ status: "working" }).eq("id", agentId);

  const record = {
    organizationId: query.organization_id,
    conversationId,
    messageId: null,
    agentConfigId: config.id,
    model: config.model,
    pricing: settings.pricing,
  };

  let modelRecorded = false;
  try {
    const run = await runAgentLoop({
      client,
      model: config.model,
      system: buildSystemPrompt(config.prompt, settings, now),
      history,
      tools: [],
    });
    await recordAiCalls(admin, { ...record, steps: run.steps });
    modelRecorded = true;

    if (!run.text) {
      await release("El modelo no escribió una respuesta");
      return "failed";
    }

    await sendTextMessage(admin, { conversationId, text: run.text.slice(0, 4000), sender: "agent", now, fetchImpl });
    return "delivered";
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Error desconocido";
    await release(reason, error instanceof ChannelSendError && !error.retryable);
    // Si el modelo ya respondió (falló el envío), sus llamadas ya están registradas.
    if (!modelRecorded) await recordAiCalls(admin, { ...record, steps: [], error: reason });
    console.error("respuesta del área:", reason);
    return "failed";
  } finally {
    await admin.from("agents").update({ status: "paused" }).eq("id", agentId);
  }
}
