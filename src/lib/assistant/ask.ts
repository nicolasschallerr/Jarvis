import type { SupabaseClient } from "@supabase/supabase-js";

import { runAgentLoop } from "@/lib/agent/loop";
import { recordAiCalls } from "@/lib/agent/record";
import type { ModelClient } from "@/lib/ai/types";
import { buildAnalystHistory, DEFAULT_ANALYTIC_MODEL, MAX_QUESTION_LENGTH, type AnalystAnswer, type AnalystTurn } from "@/lib/analytics/ask";
import { todayIn } from "@/lib/crm/consumption";
import type { Database } from "@/lib/supabase/database.types";

import { createAssistantTools } from "./tools";

// Asistente de la empresa (ADR-050): "un Claude de la organización". Responde cualquier pregunta sobre sus datos
// (casos, conversaciones, contactos, stock, finanzas, consumo) con herramientas de solo lectura. Está siempre encendido:
// no depende de una fila en "agents".

export const ASSISTANT_NAME = "Asistente";

export function buildAssistantPrompt(params: { organizationName: string; today: string; timeZone: string }): string {
  return [
    `Sos el Asistente de ${params.organizationName}: respondés cualquier pregunta del equipo de administración sobre los datos de la organización (casos, conversaciones, contactos, stock, finanzas y consumo de la IA).`,
    "",
    "## Reglas",
    "",
    "- Cada número sale de una herramienta. Nunca inventes ni estimes cifras de memoria. Si ninguna herramienta puede responder, decilo con claridad y explicá qué sí podés consultar.",
    "- Elegí la herramienta más específica. Para filtros por monto, texto o contraparte en dinero usá buscar_movimientos; para totales del período, resumen_financiero; para casos por tema, buscar_casos; para productos, buscar_en_catalogo.",
    "- Si una búsqueda por texto no encuentra nada, probá un sinónimo o una palabra más corta antes de decir que no hay (ej. 'préstamo' → 'prestamo', 'crédito', 'financiación').",
    `- Hoy es ${params.today} (zona horaria ${params.timeZone}). Interpretá "este mes", "la semana pasada" o "ayer" a partir de esa fecha y pasá fechas AAAA-MM-DD. "2 millones" es 2000000.`,
    "- Solo leés: no podés modificar nada. Si te piden cambiar algo, explicá dónde se hace en el CRM.",
    "- Nunca des datos personales de clientes o asociados (nombres, documentos, teléfonos, mensajes): las herramientas no los traen. Nombres de empresas proveedoras o clientes mayoristas sí.",
    "- Montos en pesos argentinos con separador de miles (ej. $ 2.000.000).",
    "- Respondé en español rioplatense, breve y claro: primero el dato, después una línea de contexto (período, filtros que usaste, si es parcial). Para varios valores, una lista corta.",
    "- Si la pregunta es ambigua, asumí lo más razonable y aclará qué asumiste.",
  ].join("\n");
}

// Responde una pregunta. Verifica el rol (los números de la empresa son de la administración), arma las herramientas
// con la sesión de quien pregunta y registra el gasto. Nunca lanza.
export async function answerAssistantQuestion(params: {
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
    return { ok: false, error: "Solo el superadministrador y los usuarios de consulta y reportes pueden usar el Asistente." };
  }

  const question = params.question.trim();
  if (!question) return { ok: false, error: "Escribí tu pregunta." };
  if (question.length > MAX_QUESTION_LENGTH) return { ok: false, error: `La pregunta supera los ${MAX_QUESTION_LENGTH} caracteres.` };
  if (!params.modelClient) return { ok: false, error: "El Asistente todavía no está conectado: falta la clave de Anthropic." };

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
      agentKind: "assistant",
      model,
      pricing: null,
      steps,
      ...(error ? { error } : {}),
    });

  try {
    const result = await runAgentLoop({
      client: params.modelClient,
      model,
      system: buildAssistantPrompt({ organizationName: params.profile.organizationName, today, timeZone }),
      history: buildAnalystHistory(params.history ?? [], question),
      tools: createAssistantTools({ userClient: params.userClient, organizationId: params.profile.organizationId, timeZone, today }),
      maxSteps: 10,
      maxTokens: 1800,
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
