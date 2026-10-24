import type { SupabaseClient } from "@supabase/supabase-js";

import type { AttentionSettings } from "@/lib/agent/context";
import type { Database, Json } from "@/lib/supabase/database.types";

import type { ClientConfig } from "./schema";

// Modelo por defecto del agente de atención (perfil "intermedio" del ADR-008). Cada cliente lo puede
// cambiar en `ia.modelo_atencion`; es configuración, no una decisión fija del motor.
export const DEFAULT_ATTENTION_MODEL = "claude-sonnet-5-5";

const DEFAULT_TIME_ZONE = "America/Argentina/Buenos_Aires";

const STORE_BY_DESTINATION = {
  caso: "case",
  contacto_nombre: "contact_name",
  contacto_documento: "contact_document",
  contacto_localidad: "contact_locality",
} as const;

export type AttentionFiles = {
  // Contenido de agente-prompt.md.
  prompt: string;
  // Contenido de cada conocimiento/<unidad>.md, por el id de la unidad.
  knowledge: Record<string, string>;
};

// Arma lo que el agente necesita saber a partir del YAML y los textos del cliente.
export function buildAttentionSettings(config: ClientConfig, knowledge: Record<string, string>): AttentionSettings {
  const hours = config.horario_atencion;
  const ia = config.ia;
  const hasPricing =
    ia?.precio_entrada_usd_por_millon !== undefined && ia?.precio_salida_usd_por_millon !== undefined;

  return {
    organizationName: config.organizacion.nombre,
    agentName: config.agentes?.find((agent) => agent.tipo === "atencion")?.nombre ?? config.organizacion.nombre_agente ?? "Asistente",
    timeZone: config.organizacion.zona_horaria ?? DEFAULT_TIME_ZONE,
    businessHours: hours ? { days: hours.dias, from: hours.desde, to: hours.hasta, holidays: hours.feriados } : null,
    units: config.unidades.map((unit) => ({ id: unit.id, name: unit.nombre, sector: unit.sector, handoffMessage: unit.mensaje_derivacion ?? null })),
    sectors: config.sectores.map((sector) => ({ id: sector.id, name: sector.nombre })),
    defaultSector: config.derivacion?.sector_por_defecto ?? null,
    sensitiveTopics: (config.temas_sensibles ?? []).map((topic) => ({
      id: topic.id,
      description: topic.descripcion,
      sector: topic.sector,
      priority: topic.prioridad,
    })),
    knowledge,
    menuText: config.textos_editables?.menu_principal ?? null,
    handoffMessage: config.textos_editables?.mensaje_derivacion ?? null,
    fields: (config.campos ?? []).map((field) => ({
      id: field.id,
      label: field.etiqueta,
      regex: field.regex ?? null,
      help: field.ayuda ?? null,
      clean: field.limpiar === "digitos" ? "digits" : null,
      store: STORE_BY_DESTINATION[field.guardar_en],
      units: field.unidades ?? null,
      required: field.obligatorio,
      fromChannel: field.desde_canal,
    })),
    maxFieldRetries: config.validacion?.reintentos_por_campo ?? 3,
    fieldsPerMessage: config.validacion?.datos_por_mensaje ?? 3,
    followups: {
      active: config.seguimientos?.activo ?? false,
      hours: [...(config.seguimientos?.horas ?? [])].sort((a, b) => a - b),
      text: config.textos_editables?.seguimiento ?? null,
    },
    pricing: hasPricing
      ? { inputPerMTok: ia?.precio_entrada_usd_por_millon ?? 0, outputPerMTok: ia?.precio_salida_usd_por_millon ?? 0 }
      : null,
  };
}

// JSON con las claves ordenadas, para comparar configuraciones sin que importe el orden con que la
// base devuelve las claves de un jsonb.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export type AttentionSyncResult = { status: "unchanged" | "created"; version: number };

// Guarda la configuración del agente de atención como una versión nueva de agent_configs, y la deja
// activa. Si nada cambió respecto de la versión activa, no crea otra: se puede repetir sin ensuciar el
// historial. Las versiones anteriores se conservan (desactivadas) para saber con qué prompt se
// respondió cada conversación.
export async function syncAttentionConfig(
  admin: SupabaseClient<Database>,
  organizationId: string,
  config: ClientConfig,
  files: AttentionFiles,
): Promise<AttentionSyncResult> {
  const model = config.ia?.modelo_atencion ?? DEFAULT_ATTENTION_MODEL;
  const settings = buildAttentionSettings(config, files.knowledge) as unknown as Json;

  const { data: versions, error } = await admin
    .from("agent_configs")
    .select("id, version, model, prompt, settings, is_active")
    .eq("organization_id", organizationId)
    .eq("kind", "attention")
    .order("version", { ascending: false });
  if (error) throw new Error(`No se pudo leer la configuración del agente: ${error.message}`);

  const active = versions?.find((version) => version.is_active);
  if (
    active &&
    active.model === model &&
    active.prompt === files.prompt &&
    canonical(active.settings) === canonical(settings)
  ) {
    return { status: "unchanged", version: active.version };
  }

  const nextVersion = (versions?.[0]?.version ?? 0) + 1;

  if (active) {
    const { error: deactivateError } = await admin.from("agent_configs").update({ is_active: false }).eq("id", active.id);
    if (deactivateError) throw new Error(`No se pudo desactivar la versión anterior: ${deactivateError.message}`);
  }

  const { error: insertError } = await admin.from("agent_configs").insert({
    organization_id: organizationId,
    kind: "attention",
    version: nextVersion,
    model,
    prompt: files.prompt,
    settings,
    is_active: true,
  });

  if (insertError) {
    // Si no se pudo crear la nueva, se reactiva la anterior para no dejar al agente sin configuración.
    if (active) await admin.from("agent_configs").update({ is_active: true }).eq("id", active.id);
    throw new Error(`No se pudo guardar la configuración del agente: ${insertError.message}`);
  }

  return { status: "created", version: nextVersion };
}
