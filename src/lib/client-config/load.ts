import type { SupabaseClient } from "@supabase/supabase-js";
import { parse } from "yaml";

import type { Database } from "@/lib/supabase/database.types";

import type { ConfiguredSource } from "@/lib/catalog/sources";

import { clientConfigSchema, type ClientConfig } from "./schema";

export type ParseResult = { ok: true; config: ClientConfig } | { ok: false; errors: string[] };

// Lee el texto YAML y lo valida. Devuelve los errores en español, uno por línea, con su ubicación
// ("unidades.1.sector: ..."), para que quien edite el archivo sepa qué corregir.
export function parseClientConfig(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = parse(text);
  } catch (error) {
    return { ok: false, errors: [`El archivo no es un YAML válido: ${error instanceof Error ? error.message : "error desconocido"}`] };
  }

  const result = clientConfigSchema.safeParse(raw);
  if (result.success) return { ok: true, config: result.data };

  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${issue.path.join(".") || "(raíz)"}: ${issue.message}`),
  };
}

export type SyncSummary = {
  sectors: { created: number; updated: number; deactivated: number };
  units: { created: number; updated: number; deactivated: number };
};

// Carga sectores y unidades en la organización. Es idempotente: se puede repetir sin duplicar.
// Lo que desaparece del archivo se DESACTIVA (no se borra): los casos y conversaciones ya creados
// siguen apuntando a ellos.
export async function syncSectorsAndUnits(
  admin: SupabaseClient<Database>,
  organizationId: string,
  config: ClientConfig,
): Promise<SyncSummary> {
  const summary: SyncSummary = {
    sectors: { created: 0, updated: 0, deactivated: 0 },
    units: { created: 0, updated: 0, deactivated: 0 },
  };

  const { data: existingSectors, error: sectorsError } = await admin
    .from("sectors")
    .select("id, slug")
    .eq("organization_id", organizationId);
  if (sectorsError) throw new Error(`No se pudieron leer los sectores: ${sectorsError.message}`);

  const existingSectorSlugs = new Set((existingSectors ?? []).map((sector) => sector.slug));

  const { data: sectors, error: upsertSectorsError } = await admin
    .from("sectors")
    .upsert(
      config.sectores.map((sector) => ({
        organization_id: organizationId,
        slug: sector.id,
        name: sector.nombre,
        is_active: true,
      })),
      { onConflict: "organization_id,slug" },
    )
    .select("id, slug");
  if (upsertSectorsError || !sectors) throw new Error(`No se pudieron guardar los sectores: ${upsertSectorsError?.message}`);

  for (const sector of config.sectores) {
    if (existingSectorSlugs.has(sector.id)) summary.sectors.updated += 1;
    else summary.sectors.created += 1;
  }

  const sectorIdBySlug = new Map(sectors.map((sector) => [sector.slug, sector.id]));
  const fileSectorSlugs = config.sectores.map((sector) => sector.id);
  const toDeactivate = (existingSectors ?? []).filter((sector) => !fileSectorSlugs.includes(sector.slug));
  if (toDeactivate.length > 0) {
    const { error } = await admin
      .from("sectors")
      .update({ is_active: false })
      .in("id", toDeactivate.map((sector) => sector.id));
    if (error) throw new Error(`No se pudieron desactivar sectores: ${error.message}`);
    summary.sectors.deactivated = toDeactivate.length;
  }

  const { data: existingUnits, error: unitsError } = await admin
    .from("business_units")
    .select("id, slug")
    .eq("organization_id", organizationId);
  if (unitsError) throw new Error(`No se pudieron leer las unidades: ${unitsError.message}`);
  const existingUnitSlugs = new Set((existingUnits ?? []).map((unit) => unit.slug));

  const { error: upsertUnitsError } = await admin.from("business_units").upsert(
    config.unidades.map((unit) => ({
      organization_id: organizationId,
      slug: unit.id,
      name: unit.nombre,
      default_sector_id: sectorIdBySlug.get(unit.sector) ?? null,
      is_active: true,
    })),
    { onConflict: "organization_id,slug" },
  );
  if (upsertUnitsError) throw new Error(`No se pudieron guardar las unidades: ${upsertUnitsError.message}`);

  for (const unit of config.unidades) {
    if (existingUnitSlugs.has(unit.id)) summary.units.updated += 1;
    else summary.units.created += 1;
  }

  const fileUnitSlugs = config.unidades.map((unit) => unit.id);
  const unitsToDeactivate = (existingUnits ?? []).filter((unit) => !fileUnitSlugs.includes(unit.slug));
  if (unitsToDeactivate.length > 0) {
    const { error } = await admin
      .from("business_units")
      .update({ is_active: false })
      .in("id", unitsToDeactivate.map((unit) => unit.id));
    if (error) throw new Error(`No se pudieron desactivar unidades: ${error.message}`);
    summary.units.deactivated = unitsToDeactivate.length;
  }

  return summary;
}

const AGENT_KIND = { atencion: "attention", analitico: "analytic", stock: "stock", financiero: "finance" } as const;

// Carga los agentes del cliente (nombre y frase). Es idempotente y NO toca el estado ni si el agente
// está encendido: eso lo manejan el superadmin y el servidor, no el archivo de configuración.
export async function syncAgents(
  admin: SupabaseClient<Database>,
  organizationId: string,
  config: ClientConfig,
): Promise<{ synced: number }> {
  const agents = config.agentes ?? [];
  if (agents.length === 0) return { synced: 0 };

  const { error } = await admin.from("agents").upsert(
    agents.map((agent) => ({
      organization_id: organizationId,
      kind: AGENT_KIND[agent.tipo],
      name: agent.nombre,
      tagline: agent.frase ?? null,
    })),
    { onConflict: "organization_id,kind" },
  );
  if (error) throw new Error(`No se pudieron guardar los agentes: ${error.message}`);

  return { synced: agents.length };
}

// Las fuentes de stock del archivo, en el formato que guarda la base (ADR-047). El tipo "planilla" se guarda como
// "sheet". La configuración de cada fuente solo tiene direcciones y el NOMBRE de la variable con la clave.
export function configuredSources(config: ClientConfig): ConfiguredSource[] {
  return (config.catalogo?.fuentes ?? []).map((source) => {
    if (source.tipo === "supabase") {
      return {
        name: source.nombre,
        kind: "supabase",
        config: { url: source.url.replace(/\/$/, ""), table: source.tabla, keyEnv: source.clave_env, ...(source.columnas ? { columns: source.columnas } : {}) },
        syncEveryHours: source.cada_horas,
      };
    }
    return { name: source.nombre, kind: source.tipo === "web" ? "web" : "sheet", config: { url: source.url }, syncEveryHours: source.cada_horas };
  });
}
