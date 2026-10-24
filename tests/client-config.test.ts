import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseClientConfig, syncSectorsAndUnits } from "../src/lib/client-config/load";
import { adminClient, randomId } from "./helpers/supabase-test";

// Configuración de ejemplo con datos inventados (clientes/_plantilla).
// Se normalizan los saltos de línea: en Windows el archivo puede traer \r\n y los reemplazos de
// varias líneas de estas pruebas no coincidirían.
const templateText = readFileSync("clientes/_plantilla/sectores-y-reglas.yaml", "utf8").replace(/\r\n/g, "\n");

function configWith(changes: (text: string) => string) {
  return parseClientConfig(changes(templateText));
}

describe("validación de sectores-y-reglas.yaml", () => {
  it("acepta la plantilla de ejemplo", () => {
    const result = parseClientConfig(templateText);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.sectores.map((sector) => sector.id)).toEqual(["creditos", "viajes", "atencion-general"]);
      expect(result.config.unidades).toHaveLength(2);
    }
  });

  it("rechaza un YAML mal formado", () => {
    const result = parseClientConfig("sectores: [esto no cierra");
    expect(result.ok).toBe(false);
  });

  it("avisa cuando una unidad apunta a un sector que no existe", () => {
    const result = configWith((text) => text.replace("sector: viajes", "sector: no-existe"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain('"no-existe"');
  });

  it("avisa cuando el sector por defecto no existe", () => {
    const result = configWith((text) => text.replace("sector_por_defecto: atencion-general", "sector_por_defecto: fantasma"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("derivacion.sector_por_defecto");
  });

  it("rechaza identificadores con mayúsculas, espacios o repetidos", () => {
    const upper = configWith((text) => text.replace("  - id: creditos\n    nombre: Créditos\n    responsables", "  - id: Créditos Mal\n    nombre: Créditos\n    responsables"));
    expect(upper.ok).toBe(false);

    const repeated = configWith((text) => text.replace("  - id: viajes\n    nombre: Viajes\n    responsables", "  - id: creditos\n    nombre: Viajes\n    responsables"));
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.errors.join("\n")).toContain("repetido");
  });

  it("exige al menos una unidad y un sector", () => {
    const result = parseClientConfig("organizacion:\n  slug: x\n  nombre: X\nunidades: []\nsectores: []\n");
    expect(result.ok).toBe(false);
  });
});

describe("carga de sectores y unidades en la base", () => {
  const admin = adminClient();
  const runId = randomId();
  let organizationId = "";

  beforeAll(async () => {
    const { data, error } = await admin
      .from("organizations")
      .insert({ slug: `zz-test-${runId}-config`, name: "Prueba Configuración" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    organizationId = data.id;
  });

  afterAll(async () => {
    await admin.from("organizations").delete().eq("id", organizationId);
  });

  function loadConfig(text: string) {
    const result = parseClientConfig(text);
    if (!result.ok) throw new Error(result.errors.join("; "));
    return result.config;
  }

  it("crea sectores y unidades, con la unidad apuntando a su sector por defecto", async () => {
    const summary = await syncSectorsAndUnits(admin, organizationId, loadConfig(templateText));
    expect(summary.sectors).toEqual({ created: 3, updated: 0, deactivated: 0 });
    expect(summary.units).toEqual({ created: 2, updated: 0, deactivated: 0 });

    const { data: unit } = await admin
      .from("business_units")
      .select("slug, sectors:default_sector_id(slug)")
      .eq("organization_id", organizationId)
      .eq("slug", "viajes")
      .single();
    expect(unit?.sectors?.slug).toBe("viajes");
  });

  it("repetir la carga no duplica nada", async () => {
    const summary = await syncSectorsAndUnits(admin, organizationId, loadConfig(templateText));
    expect(summary.sectors).toEqual({ created: 0, updated: 3, deactivated: 0 });

    const { data: sectors } = await admin.from("sectors").select("id").eq("organization_id", organizationId);
    expect(sectors).toHaveLength(3);
  });

  it("lo que se saca del archivo se desactiva, no se borra", async () => {
    // El dato "email" se pide solo en viajes: al sacar esa unidad hay que sacarlo también.
    const withoutTravel = templateText
      .replace(/  - id: email\n(?:    .*\n)+/, "")
      .replace(/  - id: viajes\n    nombre: Viajes\n    sector: viajes\n/, "")
      .replace(/  - id: viajes\n    nombre: Viajes\n    responsables:\n      - nombre: Responsable Ficticio Dos\n        email: viajes@ejemplo.test\n/, "");

    const summary = await syncSectorsAndUnits(admin, organizationId, loadConfig(withoutTravel));
    expect(summary.sectors.deactivated).toBe(1);
    expect(summary.units.deactivated).toBe(1);

    const { data: sector } = await admin.from("sectors").select("is_active").eq("organization_id", organizationId).eq("slug", "viajes").single();
    expect(sector?.is_active).toBe(false);

    // Y si vuelve a aparecer, se reactiva.
    await syncSectorsAndUnits(admin, organizationId, loadConfig(templateText));
    const { data: again } = await admin.from("sectors").select("is_active").eq("organization_id", organizationId).eq("slug", "viajes").single();
    expect(again?.is_active).toBe(true);
  });
});
