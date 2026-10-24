// Tipos propios de la capa de IA. El resto del sistema habla con estos tipos y no con los del SDK de
// Anthropic: así se puede cambiar de proveedor o usar un cliente simulado sin tocar el motor.

export type TextBlock = { type: "text"; text: string };
export type ToolUseBlock = { type: "tool_use"; id: string; name: string; input: unknown };
export type ToolResultBlock = { type: "tool_result"; tool_use_id: string; content: string; is_error?: boolean };

// Adjuntos que el modelo puede leer directamente: imágenes y PDF, en base64.
export type ImageBlock = {
  type: "image";
  mediaType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  data: string;
};
export type DocumentBlock = { type: "document"; mediaType: "application/pdf"; data: string };

export type UserBlock = TextBlock | ImageBlock | DocumentBlock | ToolResultBlock;

export type ChatMessage =
  | { role: "user"; content: string | UserBlock[] }
  | { role: "assistant"; content: Array<TextBlock | ToolUseBlock> };

export type ToolDefinition = {
  name: string;
  description: string;
  // JSON Schema de la entrada.
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
};

export type ModelRequest = {
  model: string;
  system: string;
  messages: ChatMessage[];
  tools: ToolDefinition[];
  maxTokens: number;
};

export type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export type ModelResponse = {
  content: Array<TextBlock | ToolUseBlock>;
  stopReason: string | null;
  usage: ModelUsage;
  requestId: string | null;
};

export interface ModelClient {
  create(request: ModelRequest): Promise<ModelResponse>;
}
