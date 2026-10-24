import { z } from "zod";

import type { ModelClient, ToolDefinition, ToolUseBlock } from "@/lib/ai/types";

// Juez de las ideas que no se pueden comprobar con código ("pide los tres datos en un solo mensaje",
// "no inventa un precio"). Es otro modelo con una rúbrica fija y una sola herramienta para responder:
// así el veredicto llega estructurado y no hay que interpretar texto libre.

export const DEFAULT_JUDGE_MODEL = "claude-sonnet-5-5";

const JUDGE_SYSTEM = [
  "Sos un evaluador estricto de conversaciones de atención al cliente. Recibís una conversación, lo que hizo el agente (sus respuestas y sus acciones sobre el caso) y dos listas de criterios.",
  "- Criterios 'debe incluir': marcá cumple=true solo si las respuestas del agente lo hacen de forma clara. Si es ambiguo o falta, cumple=false.",
  "- Criterios 'no debe': marcá infringe=true si las respuestas del agente hacen eso, aunque sea de forma parcial o implícita. Si no lo hacen, infringe=false.",
  "- Juzgá solo lo que está escrito en la conversación; no supongas intenciones ni des el beneficio de la duda.",
  "- Respondé únicamente llamando a la herramienta registrar_veredicto, con un item por criterio, en el mismo orden en que se te dieron, y un motivo de una frase.",
].join("\n");

export const VERDICT_TOOL: ToolDefinition = {
  name: "registrar_veredicto",
  description: "Registra el veredicto sobre cada criterio, en el mismo orden en que se entregaron.",
  inputSchema: {
    type: "object",
    properties: {
      debe_incluir: {
        type: "array",
        items: {
          type: "object",
          properties: { cumple: { type: "boolean" }, motivo: { type: "string" } },
          required: ["cumple", "motivo"],
        },
      },
      no_debe: {
        type: "array",
        items: {
          type: "object",
          properties: { infringe: { type: "boolean" }, motivo: { type: "string" } },
          required: ["infringe", "motivo"],
        },
      },
    },
    required: ["debe_incluir", "no_debe"],
  },
};

const verdictSchema = z.object({
  debe_incluir: z.array(z.object({ cumple: z.boolean(), motivo: z.string() })),
  no_debe: z.array(z.object({ infringe: z.boolean(), motivo: z.string() })),
});

export type CriterionResult = { criterion: string; ok: boolean; reason: string };

export type Judgement = {
  includes: CriterionResult[];
  forbidden: CriterionResult[];
  // Solo si el juez no pudo dar un veredicto utilizable.
  error?: string;
};

// Pide el veredicto. Si no hay criterios no se llama al modelo. Si la respuesta del juez no sirve
// (sin herramienta, mal formada o con otra cantidad de items), todos los criterios quedan como no
// cumplidos y se informa el motivo: una evaluación dudosa nunca cuenta como aprobada.
export async function judge(params: {
  client: ModelClient;
  model: string;
  transcript: string;
  includes: string[];
  forbidden: string[];
}): Promise<Judgement> {
  const { includes, forbidden } = params;
  if (includes.length === 0 && forbidden.length === 0) return { includes: [], forbidden: [] };

  const failed = (reason: string): Judgement => ({
    includes: includes.map((criterion) => ({ criterion, ok: false, reason })),
    forbidden: forbidden.map((criterion) => ({ criterion, ok: false, reason })),
    error: reason,
  });

  const prompt = [
    params.transcript,
    "",
    "Criterios 'debe incluir':",
    ...(includes.length ? includes.map((item, index) => `${index + 1}. ${item}`) : ["(ninguno)"]),
    "",
    "Criterios 'no debe':",
    ...(forbidden.length ? forbidden.map((item, index) => `${index + 1}. ${item}`) : ["(ninguno)"]),
  ].join("\n");

  const response = await params.client.create({
    model: params.model,
    system: JUDGE_SYSTEM,
    messages: [{ role: "user", content: prompt }],
    tools: [VERDICT_TOOL],
    maxTokens: 1024,
  });

  const call = response.content.find((block): block is ToolUseBlock => block.type === "tool_use" && block.name === VERDICT_TOOL.name);
  if (!call) return failed("El juez no devolvió un veredicto");

  const parsed = verdictSchema.safeParse(call.input);
  if (!parsed.success) return failed("El veredicto del juez no tiene el formato esperado");
  if (parsed.data.debe_incluir.length !== includes.length || parsed.data.no_debe.length !== forbidden.length) {
    return failed("El veredicto del juez no cubre todos los criterios");
  }

  return {
    includes: includes.map((criterion, index) => ({
      criterion,
      ok: parsed.data.debe_incluir[index]?.cumple === true,
      reason: parsed.data.debe_incluir[index]?.motivo ?? "",
    })),
    forbidden: forbidden.map((criterion, index) => ({
      criterion,
      ok: parsed.data.no_debe[index]?.infringe === false,
      reason: parsed.data.no_debe[index]?.motivo ?? "",
    })),
  };
}
