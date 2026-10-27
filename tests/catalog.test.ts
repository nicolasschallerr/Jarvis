import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCatalogTools } from "../src/lib/agent/catalog-tools";
import { buildSystemPrompt } from "../src/lib/agent/context";
import { parseCatalogFile, syncCatalog } from "../src/lib/catalog/import";
import { searchCatalog, type CatalogItem } from "../src/lib/catalog/search";
import { createMemoryCatalog, createSupabaseCatalog } from "../src/lib/catalog/source";
import { buildAttentionSettings } from "../src/lib/client-config/attention";
import { parseClientConfig } from "../src/lib/client-config/load";
import { adminClient, anonClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Catálogo de stock (ADR-043): búsqueda, formato del archivo, herramientas del agente, prompt, carga en la base y RLS.
// Datos inventados.

function item(overrides: Partial<CatalogItem> & { externalId: string }): CatalogItem {
  return {
    url: `https://inmobiliaria.example.test/ficha/${overrides.externalId}`,
    operation: "venta",
    category: "Departamento",
    title: `Calle Prueba ${overrides.externalId}`,
    zone: "Centro",
    locality: "Ciudad Ejemplo",
    price: 100000,
    currency: "USD",
    priceText: "U$S 100.000",
    areaM2: 50,
    bedrooms: 2,
    bathrooms: 1,
    description: "Departamento luminoso con balcón.",
    details: {},
    photos: [],
    isAvailable: true,
    ...overrides,
  };
}

const ITEMS: CatalogItem[] = [
  item({ externalId: "1", price: 140000, priceText: "U$S 140.000", zone: "Barrio Norte", description: "Dos dormitorios con terraza y vista al río." }),
  item({ externalId: "2", price: 90000, priceText: "U$S 90.000", bedrooms: 1, description: "Un dormitorio, a estrenar." }),
  item({ externalId: "3", category: "Casa", price: 200000, priceText: "U$S 200.000", zone: "Las Lomas", bedrooms: 3, description: "Casa con pileta y quincho." }),
  item({ externalId: "4", category: "Galpón", price: 500000, priceText: "U$S 500.000", bedrooms: null, description: "Galpón sobre ruta." }),
  item({ externalId: "5", operation: "alquiler", price: 600000, currency: "ARS", priceText: "$ 600.000 +imp.", description: "Dormitorios amplios." }),
  item({ externalId: "6", price: null, priceText: "Consultar", category: "Casa", zone: "Las Lomas" }),
  item({ externalId: "7", isAvailable: false, price: 50000, priceText: "U$S 50.000" }),
];

describe("búsqueda en el catálogo", () => {
  it("filtra por operación y deja afuera lo que ya no está disponible", () => {
    const result = searchCatalog(ITEMS, { operation: "venta" }, 10);
    expect(result.items.map((found) => found.externalId)).not.toContain("5");
    expect(result.items.map((found) => found.externalId)).not.toContain("7");
    expect(result.total).toBe(5);
  });

  it("ordena del más accesible al más caro, con los que no publican precio al final", () => {
    const result = searchCatalog(ITEMS, { operation: "venta" }, 10);
    expect(result.items.map((found) => found.externalId)).toEqual(["2", "1", "3", "4", "6"]);
  });

  it("encuentra el tipo y la zona sin importar tildes, mayúsculas ni abreviaturas", () => {
    expect(searchCatalog(ITEMS, { category: "galpon" }).items.map((found) => found.externalId)).toEqual(["4"]);
    expect(searchCatalog(ITEMS, { category: "depto", operation: "venta" }).total).toBe(2);
    expect(searchCatalog(ITEMS, { zone: "las lomas" }).items.map((found) => found.externalId)).toEqual(["3", "6"]);
  });

  it("filtra por dormitorios mínimos y precio tope en la misma moneda", () => {
    const result = searchCatalog(ITEMS, { minBedrooms: 2, maxPrice: 150000, currency: "USD" });
    expect(result.items.map((found) => found.externalId)).toEqual(["1"]);
    // Un tope en dólares no trae alquileres en pesos ni ítems sin precio.
    expect(searchCatalog(ITEMS, { maxPrice: 1000000, currency: "USD" }).items.map((found) => found.externalId)).not.toContain("5");
    expect(searchCatalog(ITEMS, { maxPrice: 1000000 }).items.map((found) => found.externalId)).not.toContain("6");
  });

  it("busca palabras completas: 'rio' no coincide dentro de 'dormitorios'", () => {
    expect(searchCatalog(ITEMS, { keywords: ["rio"] }).items.map((found) => found.externalId)).toEqual(["1"]);
    expect(searchCatalog(ITEMS, { keywords: ["pileta"] }).items.map((found) => found.externalId)).toEqual(["3"]);
    expect(searchCatalog(ITEMS, { keywords: ["pileta", "cochera"] }).total).toBe(0);
  });
});

describe("archivo de catálogo", () => {
  const valid = {
    fuente: "https://inmobiliaria.example.test",
    propiedades: [
      { id_externo: "10", titulo: "Calle Prueba 10", operacion: "Venta", moneda: "usd", precio: 1000, fotos: ["https://inmobiliaria.example.test/10.jpg"] },
      { id_externo: "11", titulo: "Calle Prueba 11", precio: null, precio_texto: "Consultar", detalles: { Estado: "A estrenar" } },
    ],
  };

  it("lee el formato común y normaliza operación y moneda", () => {
    const result = parseCatalogFile(JSON.stringify(valid));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0]).toMatchObject({ externalId: "10", operation: "venta", currency: "USD", price: 1000, isAvailable: true });
    expect(result.items[1]).toMatchObject({ price: null, priceText: "Consultar", details: { Estado: "A estrenar" } });
  });

  it("rechaza un JSON roto, ids repetidos, ítems sin título y la falta de lista", () => {
    expect(parseCatalogFile("{").ok).toBe(false);
    const repeated = parseCatalogFile(JSON.stringify({ items: [valid.propiedades[0], valid.propiedades[0]] }));
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.errors.join()).toContain("repetidos");
    expect(parseCatalogFile(JSON.stringify({ items: [{ id_externo: "1" }] })).ok).toBe(false);
    expect(parseCatalogFile(JSON.stringify({ fuente: "x" })).ok).toBe(false);
  });
});

describe("herramientas del agente de stock", () => {
  const [search, detail] = createCatalogTools(createMemoryCatalog(ITEMS), { label: "propiedades" });
  if (!search || !detail) throw new Error("faltan herramientas");

  it("buscar_en_catalogo devuelve cuántos hay y cada uno con su id, precio y ficha", async () => {
    const outcome = await search.run({ operacion: "venta", tipo: "Departamento", dormitorios_minimo: 2 });
    expect(outcome.isError).toBeFalsy();
    expect(outcome.output).toContain("1 resultado");
    expect(outcome.output).toContain("[id 1]");
    expect(outcome.output).toContain("U$S 140.000");
    expect(outcome.output).toContain("https://inmobiliaria.example.test/ficha/1");
    expect(outcome.decision).toEqual({ action: "catalog_search", results: 1 });
  });

  it("si no hay nada, lo dice y sugiere aflojar filtros", async () => {
    const outcome = await search.run({ tipo: "Terreno" });
    expect(outcome.output).toContain("No hay propiedades disponibles");
  });

  it("valida los filtros", async () => {
    const outcome = await search.run({ dormitorios_minimo: -1 });
    expect(outcome.isError).toBe(true);
  });

  it("ver_ficha_del_catalogo trae la descripción, avisa si ya no está y marca error si no existe", async () => {
    const found = await detail.run({ id: "#3" });
    expect(found.output).toContain("Casa con pileta y quincho");
    const gone = await detail.run({ id: "7" });
    expect(gone.output).toContain("ya no está disponible");
    const missing = await detail.run({ id: "999" });
    expect(missing.isError).toBe(true);
  });
});

describe("configuración y prompt", () => {
  const templateText = readFileSync("clientes/_plantilla/sectores-y-reglas.yaml", "utf8").replace(/\r\n/g, "\n");

  it("sin catálogo en la configuración, el prompt no habla de stock", () => {
    const parsed = parseClientConfig(templateText);
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    const settings = buildAttentionSettings(parsed.config, {});
    expect(settings.catalog).toEqual({ enabled: false, label: "productos" });
    expect(buildSystemPrompt("Hola", settings, new Date())).not.toContain("buscar_en_catalogo");
  });

  it("con el catálogo activo, el prompt explica cómo usarlo sin inventar", () => {
    const parsed = parseClientConfig(templateText.replace("  activo: false\n  nombre: productos", "  activo: true\n  nombre: propiedades"));
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));
    const settings = buildAttentionSettings(parsed.config, {});
    expect(settings.catalog).toEqual({ enabled: true, label: "propiedades" });
    const prompt = buildSystemPrompt("Hola", settings, new Date());
    expect(prompt).toContain("## Stock: catálogo de propiedades");
    expect(prompt).toContain("Nunca inventes");
    expect(prompt).toContain("`buscar_en_catalogo`");
  });
});

describe("catálogo en la base", () => {
  const admin = adminClient();
  const runId = randomId();
  const orgIds: string[] = [];
  const userIds: string[] = [];
  let member: TestUser;
  let foreigner: TestUser;

  beforeAll(async () => {
    for (const label of ["a", "b"]) {
      const { data, error } = await admin
        .from("organizations")
        .insert({ slug: `zz-test-${runId}-cat-${label}`, name: `Prueba Catálogo ${label}` })
        .select("id")
        .single();
      if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
      orgIds.push(data.id);
    }
    member = await createTestUser(admin, { organizationId: orgIds[0] ?? "", role: "operator", label: "cat-op", runId });
    foreigner = await createTestUser(admin, { organizationId: orgIds[1] ?? "", role: "superadmin", label: "cat-ajeno", runId });
    userIds.push(member.id, foreigner.id);
  });

  afterAll(async () => {
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
    await admin.from("organizations").delete().in("id", orgIds);
  });

  it("carga, actualiza y da de baja lo que ya no viene, sin borrarlo", async () => {
    const orgId = orgIds[0] ?? "";
    const first = await syncCatalog(admin, orgId, [item({ externalId: "a" }), item({ externalId: "b" })], new Date("2026-10-01T10:00:00Z"));
    expect(first).toEqual({ upserted: 2, deactivated: 0 });

    const second = await syncCatalog(admin, orgId, [item({ externalId: "a", price: 120000, priceText: "U$S 120.000" })], new Date("2026-10-02T10:00:00Z"));
    expect(second).toEqual({ upserted: 1, deactivated: 1 });

    const listed = await createSupabaseCatalog(admin, orgId).list();
    expect(listed.find((found) => found.externalId === "a")).toMatchObject({ price: 120000, isAvailable: true });
    expect(listed.find((found) => found.externalId === "b")).toMatchObject({ isAvailable: false });

    // Si vuelve a aparecer, se reactiva.
    const third = await syncCatalog(admin, orgId, [item({ externalId: "a" }), item({ externalId: "b" })], new Date("2026-10-03T10:00:00Z"));
    expect(third.deactivated).toBe(0);
    expect((await createSupabaseCatalog(admin, orgId).list()).every((found) => found.isAvailable)).toBe(true);
  });

  it("RLS: el equipo ve su catálogo; otra organización y un anónimo no ven nada; nadie lo escribe desde el navegador", async () => {
    const { data: own } = await member.client.from("catalog_items").select("external_id");
    expect((own ?? []).length).toBe(2);

    const { data: other } = await foreigner.client.from("catalog_items").select("external_id");
    expect(other ?? []).toEqual([]);

    const { data: anon } = await anonClient().from("catalog_items").select("external_id");
    expect(anon ?? []).toEqual([]);

    const { error: insertError } = await member.client
      .from("catalog_items")
      .insert({ organization_id: orgIds[0] ?? "", external_id: "x", title: "Intruso" });
    expect(insertError).not.toBeNull();

    const { data: updated } = await member.client.from("catalog_items").update({ price: 1 }).eq("external_id", "a").select("id");
    expect(updated ?? []).toEqual([]);
  });
});
