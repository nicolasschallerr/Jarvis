import Anthropic from "@anthropic-ai/sdk";

import type { ChatMessage, ModelClient, ModelRequest, ModelResponse } from "./types";

// El cliente real si hay ANTHROPIC_API_KEY, o null. Sin clave el sistema sigue recibiendo y guardando
// mensajes; solo no hay respuestas automáticas. Así se puede desarrollar el resto sin la clave.
export function anthropicClientFromEnv(): ModelClient | null {
  return process.env.ANTHROPIC_API_KEY ? createAnthropicClient(process.env.ANTHROPIC_API_KEY) : null;
}

// Pasa los mensajes al formato del SDK. Las imágenes y los PDF van como bloques base64.
export function toSdkMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
  return messages.map((message): Anthropic.MessageParam => {
    if (message.role === "assistant" || typeof message.content === "string") return message as Anthropic.MessageParam;

    return {
      role: "user",
      content: message.content.map((block): Anthropic.ContentBlockParam => {
        if (block.type === "image") return { type: "image", source: { type: "base64", media_type: block.mediaType, data: block.data } };
        if (block.type === "document") return { type: "document", source: { type: "base64", media_type: block.mediaType, data: block.data } };
        return block;
      }),
    };
  });
}

// Cliente real de Claude. Lee la clave de ANTHROPIC_API_KEY (la crea el SDK) y falla con un mensaje
// claro si no está, en vez de dejar que la primera llamada devuelva un error de autenticación.
export function createAnthropicClient(apiKey: string | undefined = process.env.ANTHROPIC_API_KEY): ModelClient {
  if (!apiKey) throw new Error("Falta ANTHROPIC_API_KEY");

  const anthropic = new Anthropic({ apiKey });

  return {
    async create(request: ModelRequest): Promise<ModelResponse> {
      const { data, request_id } = await anthropic.messages
        .create({
          model: request.model,
          max_tokens: request.maxTokens,
          // El prompt y el conocimiento son iguales en cada turno de un cliente: se marcan para
          // que el proveedor los guarde en caché y las llamadas siguientes salgan más baratas.
          system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
          messages: toSdkMessages(request.messages),
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: tool.inputSchema,
          })),
        })
        .withResponse();

      const content: ModelResponse["content"] = [];
      for (const block of data.content) {
        if (block.type === "text") content.push({ type: "text", text: block.text });
        else if (block.type === "tool_use") content.push({ type: "tool_use", id: block.id, name: block.name, input: block.input });
      }

      return {
        content,
        stopReason: data.stop_reason,
        usage: {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
          cacheReadTokens: data.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: data.usage.cache_creation_input_tokens ?? 0,
        },
        requestId: request_id ?? null,
      };
    },
  };
}
