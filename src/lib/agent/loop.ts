import type {
  ChatMessage,
  ModelClient,
  ModelResponse,
  TextBlock,
  ToolDefinition,
  ToolResultBlock,
  ToolUseBlock,
} from "@/lib/ai/types";

export type ToolOutcome = {
  // Lo que ve el modelo como resultado de la herramienta.
  output: string;
  isError?: boolean;
  // Decisión relevante (derivar, consultar al área) para dejar en la trazabilidad.
  decision?: Record<string, unknown>;
};

export type AgentTool = ToolDefinition & {
  run(input: unknown): Promise<ToolOutcome>;
};

export type ToolCallRecord = {
  name: string;
  input: unknown;
  output: string;
  isError: boolean;
  durationMs: number;
  decision?: Record<string, unknown>;
};

export type StepRecord = {
  response: ModelResponse;
  latencyMs: number;
  toolCalls: ToolCallRecord[];
};

export type LoopResult = {
  // Texto para el asociado ("" si el modelo no dijo nada).
  text: string;
  steps: StepRecord[];
  // true si se cortó por llegar al máximo de pasos sin una respuesta final.
  truncated: boolean;
};

export type LoopParams = {
  client: ModelClient;
  model: string;
  system: string;
  history: ChatMessage[];
  tools: AgentTool[];
  maxSteps?: number;
  maxTokens?: number;
};

const DEFAULT_MAX_STEPS = 6;
const DEFAULT_MAX_TOKENS = 1024;

function textOf(content: ModelResponse["content"]): string {
  return content
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join("\n\n");
}

// Ejecuta una herramienta. Un error de la herramienta NO corta el turno: se le devuelve al modelo
// como resultado con error, para que se corrija o le explique al asociado qué falta.
async function runTool(tools: AgentTool[], call: ToolUseBlock): Promise<ToolCallRecord> {
  const started = Date.now();
  const tool = tools.find((candidate) => candidate.name === call.name);

  if (!tool) {
    return { name: call.name, input: call.input, output: `No existe la herramienta ${call.name}`, isError: true, durationMs: 0 };
  }

  try {
    const outcome = await tool.run(call.input);
    return {
      name: call.name,
      input: call.input,
      output: outcome.output,
      isError: outcome.isError ?? false,
      durationMs: Date.now() - started,
      decision: outcome.decision,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Error desconocido";
    return { name: call.name, input: call.input, output: `Falló: ${reason}`, isError: true, durationMs: Date.now() - started };
  }
}

// Bucle del agente: le pregunta al modelo, ejecuta las herramientas que pida y repite hasta que
// responda con texto (o se llegue al máximo de pasos, para que un error del modelo no gaste sin fin).
export async function runAgentLoop(params: LoopParams): Promise<LoopResult> {
  const maxSteps = params.maxSteps ?? DEFAULT_MAX_STEPS;
  const messages: ChatMessage[] = [...params.history];
  const steps: StepRecord[] = [];

  for (let step = 0; step < maxSteps; step += 1) {
    const started = Date.now();
    const response = await params.client.create({
      model: params.model,
      system: params.system,
      messages,
      tools: params.tools,
      maxTokens: params.maxTokens ?? DEFAULT_MAX_TOKENS,
    });
    const latencyMs = Date.now() - started;

    const toolUses = response.content.filter((block): block is ToolUseBlock => block.type === "tool_use");

    if (toolUses.length === 0) {
      steps.push({ response, latencyMs, toolCalls: [] });
      return { text: textOf(response.content), steps, truncated: false };
    }

    const toolCalls: ToolCallRecord[] = [];
    for (const call of toolUses) toolCalls.push(await runTool(params.tools, call));
    steps.push({ response, latencyMs, toolCalls });

    const results: ToolResultBlock[] = toolUses.map((call, index) => ({
      type: "tool_result",
      tool_use_id: call.id,
      content: toolCalls[index]?.output ?? "",
      is_error: toolCalls[index]?.isError || undefined,
    }));

    messages.push({ role: "assistant", content: response.content });
    messages.push({ role: "user", content: results });
  }

  // Se agotaron los pasos: lo último que dijo el modelo, si dijo algo.
  const lastText = steps.length > 0 ? textOf(steps[steps.length - 1]?.response.content ?? []) : "";
  return { text: lastText, steps, truncated: true };
}
