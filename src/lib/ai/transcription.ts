// Transcripción de audios. Como con el modelo de lenguaje (ModelClient), el resto del sistema habla con esta
// interfaz y no con un proveedor: se puede probar con un transcriptor simulado y cambiar de servicio sin tocar
// el motor. El proveedor real se elige comparando opciones con audios reales (ADR-008, Fase 7).

export type TranscriptionInput = {
  bytes: Uint8Array;
  mimeType: string;
  // Idioma esperado (código ISO 639-1). Los asociados escriben y hablan en español rioplatense.
  language?: string;
};

export interface TranscriptionClient {
  // Nombre del servicio: queda guardado junto al texto (messages.transcription_provider).
  readonly name: string;
  transcribe(input: TranscriptionInput): Promise<{ text: string }>;
}

// Transcriptor simulado: devuelve textos armados de antemano, en orden. Guarda lo que recibió.
export function createScriptedTranscriber(texts: string[]): TranscriptionClient & { inputs: TranscriptionInput[] } {
  const queue = [...texts];
  const inputs: TranscriptionInput[] = [];

  return {
    name: "simulado",
    inputs,
    async transcribe(input) {
      inputs.push(input);
      const next = queue.shift();
      if (next === undefined) throw new Error("El transcriptor simulado se quedó sin textos");
      return { text: next };
    },
  };
}

// El transcriptor real, o null si todavía no hay un servicio elegido y configurado. Sin transcriptor los audios
// se guardan igual y el agente le pide al asociado que escriba su consulta.
// DECISIÓN PENDIENTE (Fase 7): proveedor de transcripción, a definir con audios reales.
export function transcriptionClientFromEnv(): TranscriptionClient | null {
  return null;
}
