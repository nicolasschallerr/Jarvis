import type { SupabaseClient } from "@supabase/supabase-js";

import { runAgentLoop } from "@/lib/agent/loop";
import { recordAiCalls } from "@/lib/agent/record";
import type { ModelClient } from "@/lib/ai/types";
import { buildAnalystHistory, DEFAULT_ANALYTIC_MODEL, MAX_QUESTION_LENGTH, type AnalystAnswer, type AnalystTurn } from "@/lib/analytics/ask";
import { todayIn } from "@/lib/crm/consumption";
import type { Database } from "@/lib/supabase/database.types";

import { createFinanceTools } from "./tools";

// Agente financiero (ADR-049): mismo circuito que el analítico (preguntas en lenguaje natural, herramientas de solo
// lectura, gasto registrado en ai_calls), con las cuentas de la empresa en vez de la operación del CRM.

export function buildFinancePrompt(params: { agentName: string; organizationName: string; today: string; timeZone: string }): string {
  return [
    `Sos ${params.agentName}, el agente financiero de ${params.organizationName}. Respondés preguntas de la administración sobre los números de la empresa: ingresos, egresos, resultado, categorías y lo que falta cobrar o pagar.`,
    "",
    "## Reglas",
    "",
    "- Obtené cada cifra con las herramientas. Nunca inventes ni estimes números de memoria. Si ninguna herramienta responde la pregunta, decilo y explicá qué sí podés consultar.",
    `- Hoy es ${params.today} (zona horaria ${params.timeZone}). Interpretá "este mes", "el trimestre" o "el mes pasado" a partir de esa fecha y pasá fechas AAAA-MM-DD.`,
    "- Los totales son de caja: cuenta lo cobrado y lo pagado. Lo pendiente va aparte (por cobrar o por pagar).",
    "- Solo leés: no podés registrar ni modificar movimientos.",
    "- Montos en pesos argentinos con separador de miles (ej. $ 18.450.000). Si el mes actual está en curso, aclaralo al compararlo.",
    "- Respondé en español rioplatense, breve: primero el dato, después una línea de lectura (qué significa, qué conviene mirar). Para varios valores, una lista corta.",
    "- No das asesoramiento impositivo ni de inversiones: si te lo piden, sugerí consultarlo con el contador.",
  ].join("\n");
}

// Responde una pregunta sobre las finanzas. Verifica rol, que el agente exista y esté encendido, y registra el gasto.
// Nunca lanza.
export async function answerFinanceQuestion(params: {
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
    return { ok: false, error: "Solo el superadministrador y los usuarios de consulta y reportes pueden usar el agente financiero." };
  }

  const question = params.question.trim();
  if (!question) return { ok: false, error: "Escribí tu pregunta." };
  if (question.length > MAX_QUESTION_LENGTH) return { ok: false, error: `La pregunta supera los ${MAX_QUESTION_LENGTH} caracteres.` };
  if (!params.modelClient) return { ok: false, error: "El agente financiero todavía no está conectado: falta la clave de Anthropic." };

  const { data: agent } = await params.userClient.from("agents").select("name, is_enabled").eq("kind", "finance").maybeSingle();
  if (!agent) return { ok: false, error: "Todavía no hay un agente financiero para esta organización." };
  if (!agent.is_enabled) return { ok: false, error: "El agente financiero está apagado. Un superadministrador lo puede encender desde Agentes." };

  const { data: organization } = await params.userClient.from("organizations").select("timezone").maybeSingle();
  const timeZone = organization?.timezone ?? "America/Argentina/Buenos_Aires";
  const today = todayIn(timeZone, params.now ?? new Date());
  const model = params.model ?? process.env.JARVIS_ANALYTIC_MODEL ?? DEFAULT_ANALYTIC_MODEL;
  const record = (steps: Parameters<typeof recordAiCalls>[1]["steps"], error?: string) =>
    recordAiCalls(params.admin, {
      organizationId: params.profile.organizationId,
      conversationId: null,
      messageId: null,
      agentConfigId: null,
      agentKind: "finance",
      model,
      pricing: null,
      steps,
      ...(error ? { error } : {}),
    });

  try {
    const result = await runAgentLoop({
      client: params.modelClient,
      model,
      system: buildFinancePrompt({ agentName: agent.name, organizationName: params.profile.organizationName, today, timeZone }),
      history: buildAnalystHistory(params.history ?? [], question),
      tools: createFinanceTools({ userClient: params.userClient, today }),
      maxSteps: 8,
      maxTokens: 1500,
    });
    await record(result.steps);
    const toolsUsed = [...new Set(result.steps.flatMap((step) => step.toolCalls.map((call) => call.name)))];
    return { ok: true, answer: result.text || "No pude armar una respuesta con los datos disponibles. Probá reformular la pregunta.", toolsUsed };
  } catch (error) {
    // Solo el motivo, nunca la pregunta ni los datos.
    await record([], error instanceof Error ? error.message : "Error desconocido");
    return { ok: false, error: "No se pudo responder la pregunta. Probá de nuevo en un rato." };
  }
}
