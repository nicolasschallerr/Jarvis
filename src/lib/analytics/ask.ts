import type { SupabaseClient } from "@supabase/supabase-js";

import { runAgentLoop, type LoopResult } from "@/lib/agent/loop";
import { recordAiCalls } from "@/lib/agent/record";
import type { ChatMessage, ModelClient } from "@/lib/ai/types";
import { todayIn } from "@/lib/crm/consumption";
import type { Database } from "@/lib/supabase/database.types";

import { createAnalystTools } from "./tools";

// Modelo del agente analítico: el perfil más capaz (ADR-008), porque razona sobre datos y tiene poco volumen.
// Se puede cambiar con JARVIS_ANALYTIC_MODEL sin tocar el código.
export const DEFAULT_ANALYTIC_MODEL = "claude-opus-5-5";

export const MAX_QUESTION_LENGTH = 1000;
export const MAX_HISTORY_TURNS = 10;
const MAX_TURN_LENGTH = 2000;

export type AnalystTurn = { role: "user" | "assistant"; text: string };

export function buildAnalystPrompt(params: { agentName: string; organizationName: string; today: string; timeZone: string }): string {
  return [
    `Sos ${params.agentName}, el agente analítico de ${params.organizationName}. Respondés preguntas de negocio de la administración con los datos reales de la plataforma.`,
    "",
    "## Reglas",
    "",
    "- Obtené cada número con las herramientas. Nunca inventes ni estimes cifras de memoria. Si ninguna herramienta puede responder la pregunta, decilo con claridad y explicá qué sí podés consultar.",
    `- Hoy es ${params.today} (zona horaria ${params.timeZone}). Interpretá "este mes", "la semana pasada" o "ayer" a partir de esa fecha y pasá a las herramientas fechas AAAA-MM-DD.`,
    "- Solo leés: no podés modificar nada.",
    "- Nunca des datos personales de asociados (nombres, documentos, teléfonos, mensajes) ni los pidas: las herramientas no los traen.",
    "- Respondé en español rioplatense, breve y claro: primero el dato, después una línea de contexto (el período y si el recuento es parcial). Para varios valores usá una lista corta.",
    "- Si una herramienta avisa que el recuento es parcial, decilo en la respuesta.",
    "- Si la pregunta es ambigua, asumí lo más razonable y aclará qué asumiste.",
  ].join("\n");
}

// Convierte la charla previa en turnos user/assistant. La API exige que se alternen y que el primero sea del
// usuario: se juntan los seguidos del mismo lado y se descarta lo anterior al primer mensaje del usuario.
export function buildAnalystHistory(history: AnalystTurn[], question: string): ChatMessage[] {
  const turns: AnalystTurn[] = [];
  const recent = [...history.slice(-MAX_HISTORY_TURNS), { role: "user" as const, text: question }];

  for (const turn of recent) {
    const text = turn.text.trim().slice(0, MAX_TURN_LENGTH);
    if (!text) continue;
    const last = turns[turns.length - 1];
    if (last && last.role === turn.role) last.text += `\n${text}`;
    else turns.push({ role: turn.role, text });
  }
  while (turns.length > 0 && turns[0]?.role !== "user") turns.shift();

  return turns.map((turn): ChatMessage =>
    turn.role === "user" ? { role: "user", content: turn.text } : { role: "assistant", content: [{ type: "text", text: turn.text }] },
  );
}

export type AskResult = { answer: string; steps: LoopResult["steps"]; toolsUsed: string[] };

// Pregunta al analista. Las herramientas leen con `userClient`: el analista ve lo que ve quien pregunta.
export async function askAnalyst(params: {
  client: ModelClient;
  model: string;
  userClient: SupabaseClient<Database>;
  question: string;
  history?: AnalystTurn[];
  agentName: string;
  organizationName: string;
  timeZone: string;
  now?: Date;
}): Promise<AskResult> {
  const today = todayIn(params.timeZone, params.now ?? new Date());

  const result = await runAgentLoop({
    client: params.client,
    model: params.model,
    system: buildAnalystPrompt({ agentName: params.agentName, organizationName: params.organizationName, today, timeZone: params.timeZone }),
    history: buildAnalystHistory(params.history ?? [], params.question),
    tools: createAnalystTools({ userClient: params.userClient, timeZone: params.timeZone, today }),
    maxSteps: 8,
    maxTokens: 1500,
  });

  const toolsUsed = [...new Set(result.steps.flatMap((step) => step.toolCalls.map((call) => call.name)))];
  const answer = result.text || "No pude armar una respuesta con los datos disponibles. Probá reformular la pregunta.";
  return { answer, steps: result.steps, toolsUsed };
}

export type AnalystAnswer = { ok: true; answer: string; toolsUsed: string[] } | { ok: false; error: string };

// Responde una pregunta de la administración. Antes de llamar al modelo verifica quién pregunta, que el agente
// esté encendido y que haya con qué responder; después registra el gasto en ai_calls (con la clave de servicio,
// porque las personas no escriben esa tabla). Nunca lanza.
export async function answerBusinessQuestion(params: {
  userClient: SupabaseClient<Database>;
  admin: SupabaseClient<Database>;
  modelClient: ModelClient | null;
  profile: { role: "superadmin" | "operator" | "viewer"; organizationId: string; organizationName: string };
  question: string;
  history?: AnalystTurn[];
  model?: string;
  now?: Date;
}): Promise<AnalystAnswer> {
  if (params.profile.role === "operator") {
    return { ok: false, error: "Solo el superadministrador y los usuarios de consulta y reportes pueden usar el agente analítico." };
  }

  const question = params.question.trim();
  if (!question) return { ok: false, error: "Escribí tu pregunta." };
  if (question.length > MAX_QUESTION_LENGTH) return { ok: false, error: `La pregunta supera los ${MAX_QUESTION_LENGTH} caracteres.` };

  if (!params.modelClient) {
    return { ok: false, error: "El agente analítico todavía no está conectado: falta la clave de Anthropic." };
  }

  const { data: agent } = await params.userClient.from("agents").select("name, is_enabled").eq("kind", "analytic").maybeSingle();
  if (!agent) return { ok: false, error: "Todavía no hay un agente analítico configurado para esta organización." };
  if (!agent.is_enabled) return { ok: false, error: "El agente analítico está apagado. Un superadministrador lo puede encender desde Agentes." };

  const { data: organization } = await params.userClient.from("organizations").select("timezone").maybeSingle();
  const model = params.model ?? process.env.JARVIS_ANALYTIC_MODEL ?? DEFAULT_ANALYTIC_MODEL;

  try {
    const result = await askAnalyst({
      client: params.modelClient,
      model,
      userClient: params.userClient,
      question,
      history: params.history,
      agentName: agent.name,
      organizationName: params.profile.organizationName,
      timeZone: organization?.timezone ?? "America/Argentina/Buenos_Aires",
      now: params.now,
    });

    await recordAiCalls(params.admin, {
      organizationId: params.profile.organizationId,
      conversationId: null,
      messageId: null,
      agentConfigId: null,
      agentKind: "analytic",
      model,
      pricing: null,
      steps: result.steps,
    });

    return { ok: true, answer: result.answer, toolsUsed: result.toolsUsed };
  } catch (error) {
    // Solo el motivo, nunca la pregunta ni los datos.
    const reason = error instanceof Error ? error.message : "Error desconocido";
    await recordAiCalls(params.admin, {
      organizationId: params.profile.organizationId,
      conversationId: null,
      messageId: null,
      agentConfigId: null,
      agentKind: "analytic",
      model,
      pricing: null,
      steps: [],
      error: reason,
    });
    return { ok: false, error: "No se pudo responder la pregunta. Probá de nuevo en un rato." };
  }
}
