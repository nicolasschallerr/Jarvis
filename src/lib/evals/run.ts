import { buildSystemPrompt, composeReply, type AttentionSettings } from "@/lib/agent/context";
import { runAgentLoop } from "@/lib/agent/loop";
import { createAttentionTools } from "@/lib/agent/tools";
import type { ChatMessage, ModelClient } from "@/lib/ai/types";

import { judge, type CriterionResult } from "./judge";
import { createMemoryBackend, type RecordedAction } from "./memory-backend";
import type { EvalAction, EvalCase } from "./schema";

export type ObservedAction = "derivar" | "consultar_area" | "sin_escalar";

export type { RecordedAction };

export type EvalCaseResult = {
  id: string;
  passed: boolean;
  action: { expected: EvalAction; observed: ObservedAction; ok: boolean };
  sector: { expected: string | null; observed: string | null; ok: boolean };
  includes: CriterionResult[];
  forbidden: CriterionResult[];
  replies: string[];
  actions: RecordedAction[];
  tokens: { input: number; output: number };
  // Solo si algo se rompió (el agente o el juez fallaron); un caso con error nunca aprueba.
  error?: string;
};

export type EvalSummary = { total: number; passed: number; failed: number; results: EvalCaseResult[] };

// Qué hizo el agente respecto del caso: derivó, consultó al área o no escaló. Si hizo las dos, cuenta la
// última, que es la que deja el caso en su estado final.
export function observeAction(actions: RecordedAction[]): { action: ObservedAction; sector: string | null } {
  for (let index = actions.length - 1; index >= 0; index -= 1) {
    const action = actions[index];
    if (action?.kind === "handoff") return { action: "derivar", sector: action.sector };
    if (action?.kind === "ask_area") return { action: "consultar_area", sector: action.sector };
  }
  return { action: "sin_escalar", sector: null };
}

// ¿Lo observado cumple lo esperado? "responder" y "juntar_datos" piden no escalar: lo que distingue a
// uno del otro (pedir los datos) lo juzgan los criterios de texto.
function actionMatches(expected: EvalAction, observed: ObservedAction): boolean {
  if (expected === "derivar") return observed === "derivar";
  if (expected === "consultar_area") return observed === "consultar_area";
  return observed === "sin_escalar";
}

function transcriptOf(messages: string[], replies: string[], actions: RecordedAction[]): string {
  const lines: string[] = ["Conversación:"];
  messages.forEach((message, index) => {
    lines.push(`Asociado: ${message}`);
    lines.push(`Agente: ${replies[index] || "(no respondió)"}`);
  });
  lines.push("", "Acciones del agente sobre el caso:");
  if (actions.length === 0) lines.push("(ninguna)");
  for (const action of actions) {
    if (action.kind === "save_data") lines.push(`- Guardó datos (${action.unit || "sin unidad"}): ${JSON.stringify(action.data)}`);
    else if (action.kind === "save_contact") lines.push(`- Guardó datos del asociado: ${Object.keys(action.data).join(", ")}`);
    else if (action.kind === "handoff") lines.push(`- Derivó al sector ${action.sector}. Resumen: ${action.summary}`);
    else lines.push(`- Consultó al sector ${action.sector}: ${action.question}`);
  }
  return lines.join("\n");
}

export type EvalRunParams = {
  // Canal simulado de las conversaciones (por defecto, uno que no da ningún dato). Con WhatsApp, el teléfono
  // se toma del número y no se pide.
  channel?: { type: string | null; identifier: string | null };
  // Modelo que hace de agente y modelo que hace de juez.
  agentClient: ModelClient;
  judgeClient: ModelClient;
  agentModel: string;
  judgeModel: string;
  prompt: string;
  settings: AttentionSettings;
  now?: Date;
};

// Corre un caso: le escribe al agente los mensajes del asociado de a uno (con el historial armado como en
// producción: solo el texto de cada turno), junta lo que contestó y lo que pidió hacer, y lo evalúa.
export async function runEvalCase(params: EvalRunParams, evalCase: EvalCase): Promise<EvalCaseResult> {
  const expected = evalCase.esperado;
  const actions: RecordedAction[] = [];
  const replies: string[] = [];
  const tokens = { input: 0, output: 0 };

  const base = (): EvalCaseResult => {
    const observed = observeAction(actions);
    return {
      id: evalCase.id,
      passed: false,
      action: { expected: expected.accion, observed: observed.action, ok: actionMatches(expected.accion, observed.action) },
      sector: {
        expected: expected.sector ?? null,
        observed: observed.sector,
        ok: !expected.sector || observed.sector === expected.sector,
      },
      includes: expected.debe_incluir.map((criterion) => ({ criterion, ok: false, reason: "No se evaluó" })),
      forbidden: expected.no_debe.map((criterion) => ({ criterion, ok: false, reason: "No se evaluó" })),
      replies,
      actions,
      tokens,
    };
  };

  try {
    const tools = createAttentionTools(createMemoryBackend(actions, params.channel), {
      unitSlugs: params.settings.units.map((unit) => unit.id),
      sectorSlugs: params.settings.sectors.map((sector) => sector.id),
      fields: params.settings.fields,
      maxFieldRetries: params.settings.maxFieldRetries,
    });
    const system = buildSystemPrompt(params.prompt, params.settings, params.now ?? new Date());
    const history: ChatMessage[] = [];

    for (const message of evalCase.mensajes) {
      history.push({ role: "user", content: message });
      const run = await runAgentLoop({ client: params.agentClient, model: params.agentModel, system, history, tools });
      for (const step of run.steps) {
        tokens.input += step.response.usage.inputTokens;
        tokens.output += step.response.usage.outputTokens;
      }
      // Lo mismo que recibe el asociado: el texto del agente más el aviso oficial si derivó.
      const reply = composeReply(params.settings, run);
      replies.push(reply);
      // Igual que en producción, el historial solo conserva el texto de cada turno.
      history.push({ role: "assistant", content: [{ type: "text", text: reply || "(sin respuesta)" }] });
    }

    const judgement = await judge({
      client: params.judgeClient,
      model: params.judgeModel,
      transcript: transcriptOf(evalCase.mensajes, replies, actions),
      includes: expected.debe_incluir,
      forbidden: expected.no_debe,
    });

    const result = base();
    result.includes = judgement.includes;
    result.forbidden = judgement.forbidden;
    if (judgement.error) result.error = judgement.error;

    const answered = replies.every((reply) => reply.length > 0);
    if (!answered) result.error = result.error ?? "El agente no respondió a algún mensaje";

    result.passed =
      !result.error &&
      result.action.ok &&
      result.sector.ok &&
      result.includes.every((item) => item.ok) &&
      result.forbidden.every((item) => item.ok);
    return result;
  } catch (error) {
    const result = base();
    result.error = error instanceof Error ? error.message : "Error desconocido";
    return result;
  }
}

// Corre todos los casos, de a uno. Un caso que falla no frena a los demás.
export async function runEvals(params: EvalRunParams, cases: EvalCase[]): Promise<EvalSummary> {
  const results: EvalCaseResult[] = [];
  for (const evalCase of cases) results.push(await runEvalCase(params, evalCase));

  const passed = results.filter((result) => result.passed).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}

// Informe para leer en la terminal: una línea por caso y, en los que fallan, el detalle de qué no se cumplió.
export function formatReport(summary: EvalSummary): string {
  const lines: string[] = [];

  for (const result of summary.results) {
    lines.push(`${result.passed ? "OK    " : "FALLA "} ${result.id}`);
    if (result.passed) continue;

    if (result.error) lines.push(`        error: ${result.error}`);
    if (!result.action.ok) lines.push(`        acción: se esperaba ${result.action.expected} y el agente hizo ${result.action.observed}`);
    if (!result.sector.ok) lines.push(`        sector: se esperaba ${result.sector.expected} y fue ${result.sector.observed ?? "ninguno"}`);
    for (const item of result.includes.filter((entry) => !entry.ok)) lines.push(`        no cumplió "${item.criterion}": ${item.reason}`);
    for (const item of result.forbidden.filter((entry) => !entry.ok)) lines.push(`        infringió "${item.criterion}": ${item.reason}`);
    const last = result.replies.at(-1);
    if (last) lines.push(`        última respuesta: ${last.slice(0, 200)}`);
  }

  const tokens = summary.results.reduce((sum, result) => ({ input: sum.input + result.tokens.input, output: sum.output + result.tokens.output }), { input: 0, output: 0 });
  lines.push("", `${summary.passed} de ${summary.total} casos aprobados (${tokens.input} tokens de entrada, ${tokens.output} de salida del agente).`);
  return lines.join("\n");
}
