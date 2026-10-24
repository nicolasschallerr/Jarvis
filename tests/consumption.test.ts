import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getConsumption, resolveMonth, todayIn, totalsOf, type ConsumptionDay } from "../src/lib/crm/consumption";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Consumo (créditos y uso de IA): lógica de meses y la función de la base, con datos inventados.

describe("meses", () => {
  it("la fecha de hoy se calcula en la zona horaria de la organización", () => {
    // 01:00 UTC del 27 son las 22:00 del 26 en Buenos Aires.
    expect(todayIn("America/Argentina/Buenos_Aires", new Date("2026-10-27T01:00:00Z"))).toBe("2026-10-26");
    expect(todayIn("UTC", new Date("2026-10-27T01:00:00Z"))).toBe("2026-10-27");
  });

  it("sin pedido o con un pedido inválido o futuro muestra el mes en curso, hasta hoy", () => {
    for (const requested of [undefined, "", "octubre", "2026-13", "2027-01"]) {
      expect(resolveMonth(requested, "2026-10-26")).toEqual({
        month: "2026-10",
        from: "2026-10-01",
        to: "2026-10-26",
        previous: "2026-09",
        next: null,
        isCurrent: true,
      });
    }
  });

  it("un mes pasado se muestra completo y se puede navegar al siguiente", () => {
    expect(resolveMonth("2026-09", "2026-10-26")).toEqual({
      month: "2026-09",
      from: "2026-09-01",
      to: "2026-09-30",
      previous: "2026-08",
      next: "2026-10",
      isCurrent: false,
    });
  });

  it("cruza el cambio de año y respeta los años bisiestos", () => {
    expect(resolveMonth("2026-01", "2026-10-26").previous).toBe("2025-12");
    expect(resolveMonth("2025-12", "2026-10-26").next).toBe("2026-01");
    expect(resolveMonth("2028-02", "2029-01-10").to).toBe("2028-02-29");
    expect(resolveMonth("2027-02", "2029-01-10").to).toBe("2027-02-28");
  });
});

describe("totales", () => {
  const day = (overrides: Partial<ConsumptionDay>): ConsumptionDay => ({
    day: "2026-10-01",
    credits: 0,
    windows: 0,
    windows_by_contact: 0,
    windows_by_business: 0,
    ai_calls: 0,
    ai_errors: 0,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    calls_without_cost: 0,
    ...overrides,
  });

  it("suma todos los días", () => {
    const totals = totalsOf([
      day({ credits: 2, windows: 2, windows_by_contact: 1, windows_by_business: 1, ai_calls: 3, ai_errors: 1, input_tokens: 100, output_tokens: 20, cost_usd: 0.5, calls_without_cost: 1 }),
      day({ credits: 1, windows: 1, windows_by_contact: 1, ai_calls: 1, input_tokens: 50, output_tokens: 10, cost_usd: 0.25 }),
    ]);
    expect(totals).toEqual({
      credits: 3,
      windows: 3,
      windowsByContact: 2,
      windowsByBusiness: 1,
      aiCalls: 4,
      aiErrors: 1,
      inputTokens: 150,
      outputTokens: 30,
      costUsd: 0.75,
      callsWithoutCost: 1,
    });
  });

  it("sin días da todo en cero", () => {
    expect(totalsOf([]).credits).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Integración contra jarvis-dev
// ---------------------------------------------------------------------------

const admin = adminClient();
const runId = randomId();
const orgIds: string[] = [];
const userIds: string[] = [];

let orgA = "";
let superadmin: TestUser;
let operator: TestUser;
let viewer: TestUser;
let foreigner: TestUser;

// "Ahora" para las consultas: lunes 26 de octubre de 2026, 12:00 en Buenos Aires.
const now = new Date("2026-10-26T15:00:00Z");

async function seedContact(organizationId: string, name: string) {
  const { data, error } = await admin.from("contacts").insert({ organization_id: organizationId, display_name: name }).select("id").single();
  if (error || !data) throw new Error(`No se pudo crear el contacto: ${error?.message}`);
  return data.id;
}

async function seedWindow(contactId: string, openedAt: string, initiatedBy: "contact" | "business", credits = 1) {
  const opened = new Date(openedAt);
  const { error } = await admin.from("conversation_windows").insert({
    organization_id: orgA,
    contact_id: contactId,
    initiated_by: initiatedBy,
    opened_at: opened.toISOString(),
    expires_at: new Date(opened.getTime() + 24 * 3_600_000).toISOString(),
    credits,
  });
  if (error) throw new Error(`No se pudo crear la ventana: ${error.message}`);
}

async function seedAiCall(createdAt: string, fields: { input?: number; output?: number; cost?: number | null; error?: string }) {
  const { error } = await admin.from("ai_calls").insert({
    organization_id: orgA,
    agent_kind: "attention",
    model: "modelo-de-prueba",
    input_tokens: fields.input ?? null,
    output_tokens: fields.output ?? null,
    cost_usd: fields.cost ?? null,
    error: fields.error ?? null,
    created_at: createdAt,
  });
  if (error) throw new Error(`No se pudo crear la llamada: ${error.message}`);
}

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const { data, error } = await admin
      .from("organizations")
      .insert({ slug: `zz-test-${runId}-cons-${label}`, name: `Prueba Consumo ${label}` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  orgA = orgIds[0] ?? "";
  const orgB = orgIds[1] ?? "";

  superadmin = await createTestUser(admin, { organizationId: orgA, role: "superadmin", label: "cons-super", runId });
  operator = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "cons-op", runId });
  viewer = await createTestUser(admin, { organizationId: orgA, role: "viewer", label: "cons-viewer", runId });
  foreigner = await createTestUser(admin, { organizationId: orgB, role: "superadmin", label: "cons-ajeno", runId });
  userIds.push(superadmin.id, operator.id, viewer.id, foreigner.id);

  const ana = await seedContact(orgA, "Ana Prueba");
  const beto = await seedContact(orgA, "Beto Prueba");

  // 26/10 12:00 en Buenos Aires: del asociado.
  await seedWindow(ana, "2026-10-26T15:00:00Z", "contact");
  // 02:30 UTC del 26 = 23:30 del 25 en Buenos Aires: cuenta para el día 25, no para el 26.
  await seedWindow(beto, "2026-10-26T02:30:00Z", "business");
  // Un crédito de otro mes no entra al rango.
  await seedWindow(ana, "2026-09-10T15:00:00Z", "contact");

  await seedAiCall("2026-10-26T15:10:00Z", { input: 1000, output: 200, cost: 0.5 });
  await seedAiCall("2026-10-26T15:20:00Z", { input: 400, output: 100, cost: null });
  await seedAiCall("2026-10-26T15:30:00Z", { error: "falló el modelo" });
  await seedAiCall("2026-10-26T02:40:00Z", { input: 300, output: 50, cost: 0.25 });

  // Datos de otra organización: nunca deben aparecer.
  const { data: other } = await admin.from("contacts").insert({ organization_id: orgB, display_name: "Ajena Prueba" }).select("id").single();
  await admin.from("conversation_windows").insert({
    organization_id: orgB,
    contact_id: other?.id ?? "",
    initiated_by: "contact",
    opened_at: "2026-10-26T15:00:00Z",
    expires_at: "2026-10-27T15:00:00Z",
  });
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

describe("consumo por día", () => {
  it("agrupa por día en la zona horaria de la organización y suma créditos y uso de IA", async () => {
    const result = await getConsumption({ userClient: superadmin.client, requestedMonth: "2026-10", now });
    expect(result.failed).toBe(false);
    expect(result.range).toMatchObject({ from: "2026-10-01", to: "2026-10-26", isCurrent: true });
    // Un día por cada fecha del 1 al 26.
    expect(result.days).toHaveLength(26);

    const byDay = Object.fromEntries(result.days.map((item) => [item.day, item]));
    // 23:30 del 25 en Buenos Aires.
    expect(byDay["2026-10-25"]).toMatchObject({ credits: 1, windows_by_business: 1, windows_by_contact: 0, ai_calls: 1 });
    expect(Number(byDay["2026-10-25"]?.input_tokens)).toBe(300);
    expect(Number(byDay["2026-10-25"]?.cost_usd)).toBe(0.25);

    expect(byDay["2026-10-26"]).toMatchObject({ credits: 1, windows_by_contact: 1, ai_calls: 2, ai_errors: 1, calls_without_cost: 1 });
    expect(Number(byDay["2026-10-26"]?.input_tokens)).toBe(1400);
    expect(Number(byDay["2026-10-26"]?.cost_usd)).toBe(0.5);

    // Los días sin actividad vienen en cero.
    expect(byDay["2026-10-10"]).toMatchObject({ credits: 0, ai_calls: 0 });
  });

  it("los totales del mes dejan afuera otros meses y otras organizaciones", async () => {
    const { totals } = await getConsumption({ userClient: superadmin.client, requestedMonth: "2026-10", now });
    expect(totals).toMatchObject({
      credits: 2,
      windows: 2,
      windowsByContact: 1,
      windowsByBusiness: 1,
      aiCalls: 3,
      aiErrors: 1,
      inputTokens: 1700,
      outputTokens: 350,
      callsWithoutCost: 1,
    });
    expect(totals.costUsd).toBeCloseTo(0.75, 6);

    const september = await getConsumption({ userClient: superadmin.client, requestedMonth: "2026-09", now });
    expect(september.days).toHaveLength(30);
    expect(september.totals).toMatchObject({ credits: 1, aiCalls: 0 });
  });

  it("el usuario de consulta y reportes ve lo mismo", async () => {
    const result = await getConsumption({ userClient: viewer.client, requestedMonth: "2026-10", now });
    expect(result.totals).toMatchObject({ credits: 2, aiCalls: 3 });
  });

  it("un operador ve los créditos pero no el gasto en IA", async () => {
    const result = await getConsumption({ userClient: operator.client, requestedMonth: "2026-10", now });
    expect(result.totals.credits).toBe(2);
    expect(result.totals).toMatchObject({ aiCalls: 0, aiErrors: 0, inputTokens: 0, costUsd: 0 });
  });

  it("otra organización ve solo lo suyo", async () => {
    const result = await getConsumption({ userClient: foreigner.client, requestedMonth: "2026-10", now });
    expect(result.totals).toMatchObject({ credits: 1, windows: 1, aiCalls: 0 });
  });

  it("rechaza rangos al revés o de más de 93 días", async () => {
    const reversed = await superadmin.client.rpc("consumption_by_day", { p_from: "2026-10-10", p_to: "2026-10-01" });
    expect(reversed.data).toEqual([]);

    const tooLong = await superadmin.client.rpc("consumption_by_day", { p_from: "2026-01-01", p_to: "2026-10-01" });
    expect(tooLong.data).toEqual([]);

    const limit = await superadmin.client.rpc("consumption_by_day", { p_from: "2026-07-01", p_to: "2026-10-01" });
    expect(limit.data).toHaveLength(93);
  });

  it("sin sesión no se puede llamar", async () => {
    const { anonClient } = await import("./helpers/supabase-test");
    const { error } = await anonClient().rpc("consumption_by_day", { p_from: "2026-10-01", p_to: "2026-10-02" });
    expect(error).not.toBeNull();
  });
});
