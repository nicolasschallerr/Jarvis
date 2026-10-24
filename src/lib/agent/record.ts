import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";

import type { AttentionSettings } from "./context";
import type { StepRecord } from "./loop";

type RecordParams = {
  organizationId: string;
  conversationId: string;
  messageId: string | null;
  agentConfigId: string;
  model: string;
  pricing: AttentionSettings["pricing"];
  steps: StepRecord[];
  // Si el turno falló antes de poder responder, el motivo (nunca el contenido del mensaje).
  error?: string;
};

// Costo en USD solo si el cliente configuró los precios; sin precios queda null (no se inventa).
export function computeCostUsd(
  pricing: AttentionSettings["pricing"],
  usage: { inputTokens: number; outputTokens: number },
): number | null {
  if (!pricing) return null;
  return (usage.inputTokens * pricing.inputPerMTok + usage.outputTokens * pricing.outputPerMTok) / 1_000_000;
}

// Guarda una fila en ai_calls por cada llamada al modelo y una en ai_tool_calls por cada herramienta.
// Un fallo al registrar no debe tirar abajo la respuesta al asociado: se informa y se sigue.
export async function recordAiCalls(admin: SupabaseClient<Database>, params: RecordParams): Promise<void> {
  try {
    if (params.steps.length === 0 && params.error) {
      await admin.from("ai_calls").insert({
        organization_id: params.organizationId,
        conversation_id: params.conversationId,
        message_id: params.messageId,
        agent_kind: "attention",
        agent_config_id: params.agentConfigId,
        model: params.model,
        error: params.error,
      });
      return;
    }

    for (const step of params.steps) {
      const { data: call, error } = await admin
        .from("ai_calls")
        .insert({
          organization_id: params.organizationId,
          conversation_id: params.conversationId,
          message_id: params.messageId,
          agent_kind: "attention",
          agent_config_id: params.agentConfigId,
          model: params.model,
          input_tokens: step.response.usage.inputTokens,
          output_tokens: step.response.usage.outputTokens,
          cache_read_tokens: step.response.usage.cacheReadTokens,
          cache_write_tokens: step.response.usage.cacheWriteTokens,
          cost_usd: computeCostUsd(params.pricing, step.response.usage),
          latency_ms: step.latencyMs,
          stop_reason: step.response.stopReason,
          request_id: step.response.requestId,
          decision: (step.toolCalls.find((tool) => tool.decision)?.decision ?? null) as Json,
        })
        .select("id")
        .single();
      if (error || !call) throw new Error(error?.message ?? "sin fila");

      if (step.toolCalls.length > 0) {
        await admin.from("ai_tool_calls").insert(
          step.toolCalls.map((tool) => ({
            organization_id: params.organizationId,
            ai_call_id: call.id,
            tool_name: tool.name,
            input: tool.input as Json,
            output: { text: tool.output } as Json,
            is_error: tool.isError,
            duration_ms: tool.durationMs,
          })),
        );
      }
    }
  } catch (error) {
    console.error("agente: no se pudo registrar la llamada:", error instanceof Error ? error.message : "Error desconocido");
  }
}
