import type { ModelClient, ModelRequest, ModelResponse } from "./types";

const EMPTY_USAGE = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

// Cliente simulado: devuelve respuestas armadas de antemano, en orden, sin llamar a ningún servicio.
// Sirve para probar el motor sin API key y sin gastar. Guarda lo que recibió para poder revisarlo.
export function createScriptedClient(responses: Array<Partial<ModelResponse>>): ModelClient & {
  requests: ModelRequest[];
} {
  const queue = [...responses];
  const requests: ModelRequest[] = [];

  return {
    requests,
    async create(request) {
      requests.push(request);
      const next = queue.shift();
      if (!next) throw new Error("El cliente simulado se quedó sin respuestas");
      return {
        content: next.content ?? [],
        stopReason: next.stopReason ?? "end_turn",
        usage: next.usage ?? EMPTY_USAGE,
        requestId: next.requestId ?? null,
      };
    },
  };
}
