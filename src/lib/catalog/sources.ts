import type { SupabaseClient } from "@supabase/supabase-js";

import type { CurrentProfile } from "@/lib/auth/profile";
import type { Database } from "@/lib/supabase/database.types";

import { syncCatalog } from "./import";
import { googleSheetCsvUrl, parseSpreadsheet } from "./spreadsheet";

// Fuentes de stock de una organización (ADR-045): una planilla de Google Sheets que se vuelve a leer, o un archivo
// CSV que se sube. Solo el superadmin las maneja (cambian lo que el agente le dice a los clientes). El servidor
// escribe con la clave de servicio, pero siempre después de comprobar quién es y a qué organización pertenece la fuente.

export type SourceResult = { ok: true; message: string } | { ok: false; error: string };

type Admin = SupabaseClient<Database>;

const FETCH_TIMEOUT_MS = 15_000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;

function allowed(profile: CurrentProfile | null): profile is CurrentProfile {
  return profile?.role === "superadmin";
}

const NOT_ALLOWED = { ok: false, error: "Solo quien administra la cuenta puede cambiar las fuentes de stock." } as const;

// Lee el CSV de una planilla de Google. La dirección ya pasó por googleSheetCsvUrl (solo docs.google.com); el destino
// final, después de las redirecciones de Google, tiene que seguir siendo de Google. Tiempo y tamaño acotados.
export async function fetchSheetCsv(url: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS), headers: { Accept: "text/csv" } });
    const finalHost = new URL(response.url || url).hostname;
    if (!(finalHost === "docs.google.com" || finalHost.endsWith(".googleusercontent.com") || finalHost.endsWith(".google.com"))) {
      return { ok: false, error: "Google redirigió a un sitio inesperado: no se leyó nada." };
    }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return { ok: false, error: 'No pude abrir la planilla. En Google Sheets: Compartir → "Cualquier persona con el enlace" → Lector.' };
    }
    if (!response.ok) return { ok: false, error: `Google respondió ${response.status}. Probá de nuevo en un rato.` };
    // Si la planilla es privada, Google devuelve la página de inicio de sesión en HTML en vez del CSV.
    if ((response.headers.get("content-type") ?? "").includes("text/html")) {
      return { ok: false, error: 'La planilla no es pública. En Google Sheets: Compartir → "Cualquier persona con el enlace" → Lector.' };
    }
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_FILE_BYTES) return { ok: false, error: "La planilla pesa más de 5 MB." };
    return { ok: true, text: new TextDecoder("utf-8").decode(buffer) };
  } catch {
    return { ok: false, error: "No pude conectarme con Google Sheets. Probá de nuevo en un rato." };
  }
}

async function markSource(admin: Admin, sourceId: string, patch: Database["public"]["Tables"]["catalog_sources"]["Update"]) {
  await admin.from("catalog_sources").update(patch).eq("id", sourceId);
}

// Importa el texto de una planilla en una fuente y deja registrado cómo salió (para que se vea en la pantalla Stock).
async function importInto(admin: Admin, organizationId: string, sourceId: string, text: string): Promise<SourceResult> {
  const parsed = parseSpreadsheet(text);
  if (!parsed.ok) {
    await markSource(admin, sourceId, { last_status: "error", last_message: parsed.errors[0] ?? "No se pudo leer la planilla.", last_synced_at: new Date().toISOString() });
    return { ok: false, error: parsed.errors[0] ?? "No se pudo leer la planilla." };
  }
  try {
    const summary = await syncCatalog(admin, organizationId, parsed.items, new Date(), sourceId);
    const message = `${summary.upserted} productos cargados${summary.deactivated ? `, ${summary.deactivated} dados de baja` : ""}${parsed.skipped ? `, ${parsed.skipped} filas salteadas` : ""}.`;
    await markSource(admin, sourceId, { last_status: "ok", last_message: message, last_synced_at: new Date().toISOString(), item_count: summary.upserted });
    return { ok: true, message };
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar el stock.";
    await markSource(admin, sourceId, { last_status: "error", last_message: message, last_synced_at: new Date().toISOString() });
    return { ok: false, error: message };
  }
}

export async function addSheetSource(args: { admin: Admin; profile: CurrentProfile | null; name: string; url: string; syncEveryHours: number | null; fetchImpl?: typeof fetch }): Promise<SourceResult> {
  if (!allowed(args.profile)) return NOT_ALLOWED;
  const name = args.name.trim();
  if (name.length < 1 || name.length > 80) return { ok: false, error: "Ponele un nombre de hasta 80 letras." };
  const csv = googleSheetCsvUrl(args.url);
  if (!csv.ok) return { ok: false, error: csv.error };

  // Primero se lee: si la planilla no sirve, no queda una fuente rota en la lista.
  const fetched = await fetchSheetCsv(csv.url, args.fetchImpl);
  if (!fetched.ok) return { ok: false, error: fetched.error };
  const check = parseSpreadsheet(fetched.text);
  if (!check.ok) return { ok: false, error: check.errors[0] ?? "No se pudo leer la planilla." };

  const { data: source, error } = await args.admin
    .from("catalog_sources")
    .insert({ organization_id: args.profile.organizationId, kind: "sheet", name, config: { url: csv.url }, sync_every_hours: args.syncEveryHours })
    .select("id")
    .single();
  if (error || !source) return { ok: false, error: "No se pudo guardar la fuente." };
  return importInto(args.admin, args.profile.organizationId, source.id, fetched.text);
}

export async function addFileSource(args: { admin: Admin; profile: CurrentProfile | null; name: string; fileName: string; text: string; sourceId?: string }): Promise<SourceResult> {
  if (!allowed(args.profile)) return NOT_ALLOWED;
  if (/\.xlsx?$/i.test(args.fileName)) {
    return { ok: false, error: 'Por ahora se lee CSV. En Excel: Archivo → Guardar como → "CSV (delimitado por comas)", o subí la planilla a Google Sheets y pegá el enlace.' };
  }
  const parsed = parseSpreadsheet(args.text);
  if (!parsed.ok) return { ok: false, error: parsed.errors[0] ?? "No se pudo leer el archivo." };

  let sourceId = args.sourceId;
  if (sourceId) {
    // Actualizar una fuente existente: tiene que ser de esta organización y ser un archivo.
    const { data: existing } = await args.admin.from("catalog_sources").select("id").eq("id", sourceId).eq("organization_id", args.profile.organizationId).eq("kind", "file").maybeSingle();
    if (!existing) return { ok: false, error: "No encontré esa fuente." };
  } else {
    const name = args.name.trim() || args.fileName.replace(/\.[^.]+$/, "").slice(0, 80);
    const { data: source, error } = await args.admin
      .from("catalog_sources")
      .insert({ organization_id: args.profile.organizationId, kind: "file", name, config: { fileName: args.fileName.slice(0, 120) } })
      .select("id")
      .single();
    if (error || !source) return { ok: false, error: "No se pudo guardar la fuente." };
    sourceId = source.id;
  }
  return importInto(args.admin, args.profile.organizationId, sourceId, args.text);
}

// Vuelve a leer una fuente de planilla de Google. Lo usa el botón "Sincronizar" y la tarea programada.
export async function syncSheetSource(args: { admin: Admin; organizationId: string; sourceId: string; fetchImpl?: typeof fetch }): Promise<SourceResult> {
  const { data: source } = await args.admin.from("catalog_sources").select("id, kind, config").eq("id", args.sourceId).eq("organization_id", args.organizationId).maybeSingle();
  if (!source || source.kind !== "sheet") return { ok: false, error: "No encontré esa fuente." };

  const config = source.config as { url?: unknown } | null;
  const csv = typeof config?.url === "string" ? googleSheetCsvUrl(config.url) : null;
  if (!csv?.ok) return { ok: false, error: "La fuente no tiene un enlace válido." };

  const fetched = await fetchSheetCsv(csv.url, args.fetchImpl);
  if (!fetched.ok) {
    await markSource(args.admin, source.id, { last_status: "error", last_message: fetched.error, last_synced_at: new Date().toISOString() });
    return { ok: false, error: fetched.error };
  }
  return importInto(args.admin, args.organizationId, source.id, fetched.text);
}

const MAX_SYNCS_PER_PASS = 2;

// Paso del trabajador (corre cada pocos segundos): vuelve a leer las planillas cuyo intervalo ya se cumplió. Una fuente
// con error también anota la hora del intento, así que se reintenta recién en su próximo intervalo y no en cada pasada.
export async function runCatalogSyncs(admin: Admin, now: Date = new Date(), fetchImpl?: typeof fetch): Promise<{ synced: number; failed: number }> {
  const { data } = await admin
    .from("catalog_sources")
    .select("id, organization_id, sync_every_hours, last_synced_at")
    .eq("kind", "sheet")
    .not("sync_every_hours", "is", null)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(50);

  const due = (data ?? []).filter((source) => {
    if (!source.sync_every_hours) return false;
    if (!source.last_synced_at) return true;
    return new Date(source.last_synced_at).getTime() + source.sync_every_hours * 3_600_000 <= now.getTime();
  });

  let synced = 0;
  let failed = 0;
  for (const source of due.slice(0, MAX_SYNCS_PER_PASS)) {
    const result = await syncSheetSource({ admin, organizationId: source.organization_id, sourceId: source.id, fetchImpl });
    if (result.ok) synced++;
    else failed++;
  }
  return { synced, failed };
}

export async function syncSourceAs(args: { admin: Admin; profile: CurrentProfile | null; sourceId: string; fetchImpl?: typeof fetch }): Promise<SourceResult> {
  if (!allowed(args.profile)) return NOT_ALLOWED;
  return syncSheetSource({ admin: args.admin, organizationId: args.profile.organizationId, sourceId: args.sourceId, fetchImpl: args.fetchImpl });
}

// Quita una fuente. Sus productos no se borran: pasan a "ya no disponibles" (ADR-043) para que las conversaciones
// viejas sigan teniendo sentido.
export async function deleteSource(args: { admin: Admin; profile: CurrentProfile | null; sourceId: string }): Promise<SourceResult> {
  if (!allowed(args.profile)) return NOT_ALLOWED;
  const orgId = args.profile.organizationId;
  const { data: source } = await args.admin.from("catalog_sources").select("id").eq("id", args.sourceId).eq("organization_id", orgId).maybeSingle();
  if (!source) return { ok: false, error: "No encontré esa fuente." };

  const { error: itemsError } = await args.admin.from("catalog_items").update({ is_available: false }).eq("organization_id", orgId).eq("source_id", source.id);
  if (itemsError) return { ok: false, error: "No se pudieron dar de baja los productos de la fuente." };
  const { error } = await args.admin.from("catalog_sources").delete().eq("id", source.id).eq("organization_id", orgId);
  if (error) return { ok: false, error: "No se pudo quitar la fuente." };
  return { ok: true, message: "Fuente quitada. Sus productos quedaron como no disponibles." };
}
