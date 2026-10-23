import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import type { MediaRef } from "./types";

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

// Límite de descarga de la API de bots de Telegram (documentación oficial: getFile).
export const TELEGRAM_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

export type StoreMediaParams = {
  organizationId: string;
  conversationId: string;
  messageId: string;
  token: string;
  media: MediaRef;
  fetchImpl?: Fetch;
};

// Extensión según el tipo del archivo, para que el nombre guardado sea reconocible.
function extensionFor(media: MediaRef, mimeType: string): string {
  const fromName = media.fileName?.match(/\.([A-Za-z0-9]{1,8})$/)?.[1];
  if (fromName) return fromName.toLowerCase();
  const known: Record<string, string> = {
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "image/jpeg": "jpg",
    "image/png": "png",
    "application/pdf": "pdf",
    "video/mp4": "mp4",
  };
  return known[mimeType.split(";")[0]?.trim() ?? ""] ?? "bin";
}

// Descarga un adjunto de Telegram (getFile + enlace de descarga), lo guarda en el bucket privado
// "media" y lo registra en media_files. Es idempotente: si el mensaje ya tiene su archivo, no hace
// nada. Nunca incluye el token en los errores.
export async function storeTelegramMedia(
  admin: SupabaseClient<Database>,
  params: StoreMediaParams,
): Promise<"stored" | "exists" | "too-large"> {
  const { media, token } = params;
  const doFetch: Fetch = params.fetchImpl ?? fetch;

  if (media.sizeBytes !== null && media.sizeBytes > TELEGRAM_MAX_DOWNLOAD_BYTES) return "too-large";

  const { data: existing } = await admin
    .from("media_files")
    .select("id")
    .eq("message_id", params.messageId)
    .maybeSingle();
  if (existing) return "exists";

  const infoResponse = await doFetch(`https://api.telegram.org/bot${token}/getFile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_id: media.providerMediaId }),
  });
  const info = (await infoResponse.json().catch(() => null)) as {
    ok?: boolean;
    description?: string;
    result?: { file_path?: string; file_size?: number };
  } | null;

  const filePath = info?.result?.file_path;
  if (!infoResponse.ok || !info?.ok || !filePath) {
    throw new Error(`getFile falló (${infoResponse.status}): ${info?.description ?? "sin detalle"}`);
  }
  if ((info.result?.file_size ?? 0) > TELEGRAM_MAX_DOWNLOAD_BYTES) return "too-large";

  const fileResponse = await doFetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
  if (!fileResponse.ok) throw new Error(`La descarga falló (${fileResponse.status})`);

  const bytes = Buffer.from(await fileResponse.arrayBuffer());
  if (bytes.length > TELEGRAM_MAX_DOWNLOAD_BYTES) return "too-large";

  const mimeType = media.mimeType ?? fileResponse.headers.get("content-type") ?? "application/octet-stream";
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storagePath = `${params.organizationId}/${params.conversationId}/${params.messageId}.${extensionFor(media, mimeType)}`;

  const { error: uploadError } = await admin.storage
    .from("media")
    .upload(storagePath, bytes, { contentType: mimeType, upsert: true });
  if (uploadError) throw new Error(`No se pudo guardar el archivo: ${uploadError.message}`);

  const { error: insertError } = await admin.from("media_files").insert({
    organization_id: params.organizationId,
    message_id: params.messageId,
    storage_path: storagePath,
    mime_type: mimeType,
    size_bytes: bytes.length,
    sha256,
    provider_media_id: media.providerMediaId,
  });
  if (insertError) throw new Error(`No se pudo registrar el archivo: ${insertError.message}`);

  return "stored";
}
