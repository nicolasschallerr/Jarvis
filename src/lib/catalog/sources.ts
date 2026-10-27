import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";

import { readSupabaseTable, readWebsite, type ConnectorResult } from "./connectors";
import { syncCatalog } from "./import";
import { googleSheetCsvUrl, parseSpreadsheet } from "./spreadsheet";

// Fuentes de stock de una organización (ADR-045 y ADR-047). Las configura el proveedor en la carpeta privada del
// cliente (`catalogo.fuentes` en sectores-y-reglas.yaml) y el CRM las lee solo, cada tantas horas: la base Supabase
// del cliente, su sitio web o una planilla de Google. El cliente no conecta nada a mano: ve su stock y el estado.

export type SourceResult = { ok: true; message: string } | { ok: false; error: string };

type Admin = SupabaseClient<Database>;
type SourceRow = Pick<Database["public"]["Tables"]["catalog_sources"]["Row"], "id" | "organization_id" | "kind" | "config" | "sync_every_hours" | "last_synced_at">;

const FETCH_TIMEOUT_MS = 15_000;
const MAX_FILE_BYTES = 5 * 1024 * 1024;

// Las claves de la base del cliente viven en variables de entorno (Vercel o .env), nunca en la configuración ni en la
// base. La configuración solo nombra la variable, y tiene que empezar con CATALOGO_: así un archivo de configuración no
// puede pedir que se lea cualquier otra variable del servidor (por ejemplo, la clave de servicio de Orbita).
export const KEY_ENV = /^CATALOGO_[A-Z0-9_]{2,60}$/;

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

type ReadOptions = { fetchImpl?: typeof fetch; deadline?: number; env?: Record<string, string | undefined> };

// Lee una fuente con el conector que le corresponde.
export async function readSource(kind: string, rawConfig: Json, options: ReadOptions = {}): Promise<ConnectorResult> {
  const config = (rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig) ? rawConfig : {}) as Record<string, unknown>;
  const fetchImpl = options.fetchImpl ?? fetch;

  if (kind === "sheet") {
    const csv = typeof config.url === "string" ? googleSheetCsvUrl(config.url) : null;
    if (!csv?.ok) return { ok: false, error: "La fuente no tiene un enlace de Google Sheets válido." };
    const fetched = await fetchSheetCsv(csv.url, fetchImpl);
    if (!fetched.ok) return fetched;
    const parsed = parseSpreadsheet(fetched.text);
    return parsed.ok ? { ok: true, items: parsed.items, complete: true, via: "Google Sheets" } : { ok: false, error: parsed.errors[0] ?? "No se pudo leer la planilla." };
  }

  if (kind === "supabase") {
    const keyEnv = typeof config.keyEnv === "string" ? config.keyEnv : "";
    if (!KEY_ENV.test(keyEnv)) return { ok: false, error: "La fuente no nombra una variable de clave válida (CATALOGO_…)." };
    const key = (options.env ?? process.env)[keyEnv];
    if (!key) return { ok: false, error: `Falta la variable de entorno ${keyEnv} en el servidor.` };
    const columns = config.columns && typeof config.columns === "object" ? (config.columns as Record<string, string>) : undefined;
    return readSupabaseTable({ url: String(config.url ?? ""), table: String(config.table ?? ""), key, columns }, fetchImpl);
  }

  if (kind === "web") return readWebsite(String(config.url ?? ""), { fetchImpl, deadline: options.deadline });

  return { ok: false, error: "Esta fuente no se lee sola." };
}

async function markSource(admin: Admin, sourceId: string, patch: Database["public"]["Tables"]["catalog_sources"]["Update"]) {
  await admin.from("catalog_sources").update(patch).eq("id", sourceId);
}

// Lee una fuente y guarda sus productos. Con una lectura incompleta (se cortó por tiempo) guarda lo leído pero no da de
// baja lo que faltó: si no, un sitio lento vaciaría el catálogo.
export async function syncSource(admin: Admin, source: SourceRow, options: ReadOptions & { now?: Date } = {}): Promise<SourceResult> {
  const now = options.now ?? new Date();
  const read = await readSource(source.kind, source.config, options);
  if (!read.ok) {
    await markSource(admin, source.id, { last_status: "error", last_message: read.error, last_synced_at: now.toISOString() });
    return { ok: false, error: read.error };
  }
  try {
    const summary = await syncCatalog(admin, source.organization_id, read.items, now, source.id, read.complete);
    const message = `${summary.upserted} productos leídos de ${read.via}${summary.deactivated ? `, ${summary.deactivated} ya no están` : ""}${read.complete ? "" : " (lectura parcial: sigue en la próxima vuelta)"}.`;
    await markSource(admin, source.id, { last_status: "ok", last_message: message, last_synced_at: now.toISOString(), item_count: summary.upserted });
    return { ok: true, message };
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo guardar el stock.";
    await markSource(admin, source.id, { last_status: "error", last_message: message, last_synced_at: now.toISOString() });
    return { ok: false, error: message };
  }
}

export function isDue(source: Pick<SourceRow, "sync_every_hours" | "last_synced_at">, now: Date): boolean {
  if (!source.sync_every_hours) return false;
  if (!source.last_synced_at) return true;
  return new Date(source.last_synced_at).getTime() + source.sync_every_hours * 3_600_000 <= now.getTime();
}

// Ronda del trabajador de stock: lee, de a una, las fuentes cuyo intervalo se cumplió, mientras quede tiempo. Una fuente
// con error también anota la hora del intento, así que se reintenta en su próximo intervalo y no en cada vuelta.
export async function runCatalogSyncs(admin: Admin, options: { deadline: number; now?: Date; fetchImpl?: typeof fetch }): Promise<{ synced: number; failed: number }> {
  const now = options.now ?? new Date();
  const { data } = await admin
    .from("catalog_sources")
    .select("id, organization_id, kind, config, sync_every_hours, last_synced_at")
    .in("kind", ["sheet", "web", "supabase"])
    .not("sync_every_hours", "is", null)
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(50);

  let synced = 0;
  let failed = 0;
  for (const source of (data ?? []).filter((row) => isDue(row, now))) {
    if (Date.now() > options.deadline - 20_000) break;
    const result = await syncSource(admin, source, { fetchImpl: options.fetchImpl, deadline: options.deadline - 10_000, now });
    if (result.ok) synced++;
    else failed++;
  }
  return { synced, failed };
}

// ---------------------------------------------------------------------------------------------------------------
// Fuentes desde la configuración del cliente.
// ---------------------------------------------------------------------------------------------------------------

export type ConfiguredSource = {
  name: string;
  kind: "sheet" | "web" | "supabase";
  config: { url: string; table?: string; keyEnv?: string; columns?: Record<string, string> };
  syncEveryHours: number;
};

// Deja las fuentes de la organización como dice la configuración: alta o cambio por nombre, y las que ya no están se
// quitan (sus productos quedan como no disponibles, no se borran). Una fuente que cambió de configuración se vuelve a
// leer en la próxima vuelta del trabajador.
export async function syncSourcesFromConfig(admin: Admin, organizationId: string, sources: ConfiguredSource[]): Promise<{ upserted: number; removed: number }> {
  const { data: existing, error } = await admin.from("catalog_sources").select("id, name, kind, config").eq("organization_id", organizationId);
  if (error) throw new Error(`No se pudieron leer las fuentes de stock: ${error.message}`);

  for (const source of sources) {
    const current = existing?.find((row) => row.name === source.name);
    const config = source.config as unknown as Json;
    const changed = !current || current.kind !== source.kind || JSON.stringify(current.config) !== JSON.stringify(config);
    const { error: upsertError } = await admin.from("catalog_sources").upsert(
      {
        organization_id: organizationId,
        name: source.name,
        kind: source.kind,
        config,
        sync_every_hours: source.syncEveryHours,
        ...(changed ? { last_synced_at: null } : {}),
      },
      { onConflict: "organization_id,name" },
    );
    if (upsertError) throw new Error(`No se pudo guardar la fuente "${source.name}": ${upsertError.message}`);
  }

  const names = new Set(sources.map((source) => source.name));
  const gone = (existing ?? []).filter((row) => !names.has(row.name));
  for (const row of gone) {
    await admin.from("catalog_items").update({ is_available: false }).eq("organization_id", organizationId).eq("source_id", row.id);
    await admin.from("catalog_sources").delete().eq("id", row.id);
  }
  return { upserted: sources.length, removed: gone.length };
}
