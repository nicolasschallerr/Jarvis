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
  await saveMedia(admin, params, bytes, mimeType);
  return "stored";
}

// Guarda los bytes en el bucket privado "media" y los registra en media_files (común a todos los canales).
async function saveMedia(admin: SupabaseClient<Database>, params: StoreMediaParams, bytes: Buffer, mimeType: string): Promise<void> {
  const { media } = params;
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
    provider_media_id: withoutQuery(media.providerMediaId).slice(0, 500),
  });
  // Dos corridas del trabajador pueden bajar el mismo adjunto a la vez: la segunda choca con el índice único y no es un error.
  if (insertError && insertError.code !== "23505") throw new Error(`No se pudo registrar el archivo: ${insertError.message}`);
}

async function alreadyStored(admin: SupabaseClient<Database>, messageId: string): Promise<boolean> {
  const { data } = await admin.from("media_files").select("id").eq("message_id", messageId).maybeSingle();
  return Boolean(data);
}

// Límite que se aplica a los adjuntos de Meta: el agente solo mira archivos chicos y el resto no hace falta guardarlo.
export const META_MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

// Los adjuntos de Messenger e Instagram llegan como una dirección de descarga de corta vida. Solo se descarga de los
// servidores de archivos de Meta: una dirección armada por un tercero no debe hacer que el servidor pida otro sitio.
const META_FILE_HOST = /(^|\.)(fbcdn\.net|cdninstagram\.com|fbsbx\.com)$/i;

export function isMetaFileUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && META_FILE_HOST.test(url.hostname);
  } catch {
    return false;
  }
}

// Tiempo máximo de cada pedido a Meta: un servidor lento no puede dejar colgada la corrida del trabajador.
export const META_DOWNLOAD_TIMEOUT_MS = 20_000;

// Lee el cuerpo de a pedazos y corta apenas pasa el tope, aunque la respuesta no declare su tamaño: no se baja a memoria
// un archivo enorme para recién después compararlo.
export async function readLimited(response: Response, maxBytes: number): Promise<Buffer | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!response.body) return Buffer.alloc(0);

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

// La dirección de un adjunto de Messenger o Instagram trae una firma en sus parámetros: se guarda sin ellos.
export function withoutQuery(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.slice(0, 200);
  }
}

// Descarga el adjunto de un mensaje de Messenger o Instagram desde su dirección.
export async function storeUrlMedia(admin: SupabaseClient<Database>, params: StoreMediaParams): Promise<"stored" | "exists" | "too-large"> {
  const url = params.media.url;
  if (!url || !isMetaFileUrl(url)) throw new Error("La dirección del adjunto no es de un servidor de archivos de Meta");
  if (await alreadyStored(admin, params.messageId)) return "exists";

  const doFetch: Fetch = params.fetchImpl ?? fetch;
  const response = await doFetch(url, { redirect: "error", signal: AbortSignal.timeout(META_DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`La descarga falló (${response.status})`);

  const bytes = await readLimited(response, META_MAX_DOWNLOAD_BYTES);
  if (!bytes) return "too-large";

  await saveMedia(admin, params, bytes, params.media.mimeType ?? response.headers.get("content-type") ?? "application/octet-stream");
  return "stored";
}

// Descarga un adjunto de WhatsApp: primero se pide a Meta la dirección del archivo con su id y después se baja con el
// token del canal. El token va solo en el encabezado y nunca en un error.
export async function storeWhatsAppMedia(admin: SupabaseClient<Database>, params: StoreMediaParams & { graphBase: string }): Promise<"stored" | "exists" | "too-large"> {
  if (await alreadyStored(admin, params.messageId)) return "exists";
  const doFetch: Fetch = params.fetchImpl ?? fetch;
  const headers = { authorization: `Bearer ${params.token}` };

  const infoResponse = await doFetch(`${params.graphBase}/${encodeURIComponent(params.media.providerMediaId)}`, { headers, signal: AbortSignal.timeout(META_DOWNLOAD_TIMEOUT_MS) });
  const info = (await infoResponse.json().catch(() => null)) as { url?: string; mime_type?: string; file_size?: number } | null;
  if (!infoResponse.ok || !info?.url) throw new Error(`No se pudo pedir el archivo a WhatsApp (${infoResponse.status})`);
  if ((info.file_size ?? 0) > META_MAX_DOWNLOAD_BYTES) return "too-large";
  if (!isMetaFileUrl(info.url)) throw new Error("La dirección del archivo no es de un servidor de archivos de Meta");

  const fileResponse = await doFetch(info.url, { headers, redirect: "error", signal: AbortSignal.timeout(META_DOWNLOAD_TIMEOUT_MS) });
  if (!fileResponse.ok) throw new Error(`La descarga falló (${fileResponse.status})`);

  const bytes = await readLimited(fileResponse, META_MAX_DOWNLOAD_BYTES);
  if (!bytes) return "too-large";

  await saveMedia(admin, params, bytes, params.media.mimeType ?? info.mime_type ?? fileResponse.headers.get("content-type") ?? "application/octet-stream");
  return "stored";
}
