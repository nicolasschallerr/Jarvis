import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import { attentionSettingsSchema, type AttentionSettings, type HistoryRow, type InlineMedia } from "./context";

export type LoadedAgent = {
  agentId: string;
  config: { id: string; model: string; prompt: string };
  settings: AttentionSettings;
};

export type LoadAgentResult =
  | { ok: true; agent: LoadedAgent }
  | { ok: false; status: "skipped" | "failed"; reason: string };

// Lo que necesita el agente de atención de una organización para trabajar: que esté encendido y que
// tenga una configuración activa y válida. Lo usan la respuesta a un mensaje y el envío de las
// respuestas del área.
export async function loadAttentionAgent(
  admin: SupabaseClient<Database>,
  organizationId: string,
): Promise<LoadAgentResult> {
  const { data: agent } = await admin
    .from("agents")
    .select("id, is_enabled")
    .eq("organization_id", organizationId)
    .eq("kind", "attention")
    .maybeSingle();
  if (!agent?.is_enabled) return { ok: false, status: "skipped", reason: "agente_apagado" };

  const { data: config } = await admin
    .from("agent_configs")
    .select("id, model, prompt, settings")
    .eq("organization_id", organizationId)
    .eq("kind", "attention")
    .eq("is_active", true)
    .maybeSingle();
  if (!config) return { ok: false, status: "skipped", reason: "sin_configuracion_activa" };

  const settings = attentionSettingsSchema.safeParse(config.settings);
  if (!settings.success) return { ok: false, status: "failed", reason: "La configuración del agente no es válida" };

  // El agente de stock (ADR-046) decide si el de atención consulta el catálogo: encendido, tiene las herramientas;
  // apagado, no. Una organización sin fila de stock (anterior a ese agente) sigue como dice su configuración.
  const { data: stockAgent } = await admin
    .from("agents")
    .select("is_enabled")
    .eq("organization_id", organizationId)
    .eq("kind", "stock")
    .maybeSingle();
  const catalog = stockAgent ? { ...settings.data.catalog, enabled: stockAgent.is_enabled } : settings.data.catalog;

  return {
    ok: true,
    agent: {
      agentId: agent.id,
      config: { id: config.id, model: config.model, prompt: config.prompt },
      settings: { ...settings.data, catalog },
    },
  };
}

// Cuántos mensajes del historial se le muestran al agente. Alcanza para una gestión; las
// conversaciones largas se resumirán más adelante.
export const HISTORY_LIMIT = 30;

// Imágenes y PDF que se le muestran al modelo en línea: solo los más recientes y de tamaño razonable. Cada
// adjunto se vuelve a enviar (y a pagar) en cada turno, así que no se acumulan. El tope de tamaño es
// conservador y debe verificarse contra los límites vigentes de Anthropic antes de producción.
export const MAX_INLINE_MEDIA_COUNT = 3;
export const MAX_INLINE_MEDIA_BYTES = 5 * 1024 * 1024;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;

type StoredFile = { storage_path: string; mime_type: string; size_bytes: number | null };

export type LoadedHistoryRow = HistoryRow & { id: string; file: StoredFile | null };

// Los últimos mensajes de la conversación, del más viejo al más nuevo, con el archivo guardado de cada uno.
export async function loadHistoryRows(
  admin: SupabaseClient<Database>,
  conversationId: string,
): Promise<LoadedHistoryRow[] | null> {
  const { data: rows, error } = await admin
    .from("messages")
    .select("id, direction, type, body, transcription, media_files(storage_path, mime_type, size_bytes)")
    .eq("conversation_id", conversationId)
    // Un mensaje que no se pudo enviar no lo recibió el asociado: no forma parte de la conversación.
    .neq("status", "failed")
    .order("provider_timestamp", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  if (error) return null;

  return [...(rows ?? [])].reverse().map((row) => {
    const file = row.media_files[0] ?? null;
    return {
      id: row.id,
      direction: row.direction,
      type: row.type,
      body: row.body,
      transcription: row.transcription,
      hasFile: file !== null,
      file,
    };
  });
}

// Baja de la base los adjuntos (imágenes y PDF) del asociado que se le muestran al modelo: los más recientes,
// que el modelo pueda leer y que no pasen del tamaño máximo. Un adjunto que falla al bajar se omite sin cortar
// el turno (el agente lo ve como "ya no se muestra").
export async function loadInlineMedia(
  admin: SupabaseClient<Database>,
  rows: LoadedHistoryRow[],
): Promise<Map<string, InlineMedia>> {
  const media = new Map<string, InlineMedia>();

  for (let index = rows.length - 1; index >= 0 && media.size < MAX_INLINE_MEDIA_COUNT; index -= 1) {
    const row = rows[index];
    if (!row || row.direction !== "inbound" || !row.file) continue;
    if (row.type !== "image" && row.type !== "document") continue;

    const mimeType = row.file.mime_type.split(";")[0]?.trim().toLowerCase() ?? "";
    const isImage = (IMAGE_TYPES as readonly string[]).includes(mimeType);
    const isPdf = mimeType === "application/pdf";
    if (!isImage && !isPdf) continue;
    if (row.file.size_bytes !== null && row.file.size_bytes > MAX_INLINE_MEDIA_BYTES) continue;

    const { data: blob, error } = await admin.storage.from("media").download(row.file.storage_path);
    if (error || !blob) continue;
    const bytes = Buffer.from(await blob.arrayBuffer());
    if (bytes.length > MAX_INLINE_MEDIA_BYTES) continue;

    const data = bytes.toString("base64");
    media.set(
      row.id,
      isPdf ? { type: "document", mediaType: "application/pdf", data } : { type: "image", mediaType: mimeType as (typeof IMAGE_TYPES)[number], data },
    );
  }

  return media;
}
