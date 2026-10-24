import type { SupabaseClient } from "@supabase/supabase-js";

import type { TranscriptionClient } from "@/lib/ai/transcription";
import type { Database } from "@/lib/supabase/database.types";

// Tope de tamaño de un audio a transcribir: el mismo que se puede descargar de Telegram.
export const MAX_AUDIO_BYTES = 20 * 1024 * 1024;

export type TranscribeResult = "transcribed" | "already-done" | "no-audio" | "too-large" | "empty";

// Transcribe el audio de un mensaje y guarda el texto en el propio mensaje, junto con el servicio que lo
// generó. Es idempotente: si el mensaje ya tiene su transcripción no hace nada, así un reproceso no vuelve a
// pagar. Los errores del servicio se propagan: quien llama decide si frenan algo (no deberían frenar el mensaje).
export async function transcribeAudioMessage(
  admin: SupabaseClient<Database>,
  transcriber: TranscriptionClient,
  messageId: string,
): Promise<TranscribeResult> {
  const { data: message } = await admin
    .from("messages")
    .select("id, type, transcription, media_files(storage_path, mime_type, size_bytes)")
    .eq("id", messageId)
    .maybeSingle();

  if (!message || message.type !== "audio") return "no-audio";
  if (message.transcription) return "already-done";

  const file = message.media_files[0];
  if (!file) return "no-audio";
  if (file.size_bytes !== null && file.size_bytes > MAX_AUDIO_BYTES) return "too-large";

  const { data: blob, error } = await admin.storage.from("media").download(file.storage_path);
  if (error || !blob) throw new Error(`No se pudo bajar el audio: ${error?.message ?? "sin archivo"}`);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length > MAX_AUDIO_BYTES) return "too-large";

  const { text } = await transcriber.transcribe({ bytes, mimeType: file.mime_type, language: "es" });
  const clean = text.trim();
  // Un audio sin voz: no se guarda un texto vacío, así el agente le pide al asociado que lo escriba.
  if (clean === "") return "empty";

  const { error: updateError } = await admin
    .from("messages")
    .update({ transcription: clean, transcription_provider: transcriber.name })
    .eq("id", messageId);
  if (updateError) throw new Error(`No se pudo guardar la transcripción: ${updateError.message}`);

  return "transcribed";
}
