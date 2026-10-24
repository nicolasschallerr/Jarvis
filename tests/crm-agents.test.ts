import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { updateAgent } from "../src/lib/crm/agents";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Pantalla de Agentes contra el proyecto de desarrollo. Usa organizaciones y usuarios propios
// con el prefijo "zz-test-".

const admin = adminClient();
const runId = randomId();
const orgIds: string[] = [];
const userIds: string[] = [];

let orgA = "";
let attentionId = "";
let analyticId = "";
let superadmin: TestUser;
let operator: TestUser;
let foreigner: TestUser;

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const { data, error } = await admin
      .from("organizations")
      .insert({ slug: `zz-test-${runId}-ag-${label}`, name: `Prueba Agentes ${label}` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  orgA = orgIds[0] ?? "";
  const orgB = orgIds[1] ?? "";

  superadmin = await createTestUser(admin, { organizationId: orgA, role: "superadmin", label: "ag-super", runId });
  operator = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "ag-op", runId });
  foreigner = await createTestUser(admin, { organizationId: orgB, role: "superadmin", label: "ag-ajeno", runId });
  userIds.push(superadmin.id, operator.id, foreigner.id);

  const { data: agents, error } = await admin
    .from("agents")
    .insert([
      { organization_id: orgA, kind: "attention", name: "Atención" },
      { organization_id: orgA, kind: "analytic", name: "Analítico" },
    ])
    .select("id, kind");
  if (error || !agents) throw new Error(`No se pudieron crear los agentes: ${error?.message}`);
  attentionId = agents.find((agent) => agent.kind === "attention")?.id ?? "";
  analyticId = agents.find((agent) => agent.kind === "analytic")?.id ?? "";
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

const base = (agentId: string) => ({ agentId, name: "Nombre", tagline: "Frase", isEnabled: false });

describe("cambiar un agente", () => {
  it("el superadmin cambia nombre y frase", async () => {
    const result = await updateAgent({ ...base(analyticId), userClient: superadmin.client, profile: { role: "superadmin" }, name: "  Nuevo  ", tagline: "" });
    expect(result).toEqual({ ok: true });

    const { data } = await admin.from("agents").select("name, tagline").eq("id", analyticId).single();
    expect(data).toEqual({ name: "Nuevo", tagline: null });
  });

  it("un operador no puede, ni siquiera salteando la verificación de rol", async () => {
    const denied = await updateAgent({ ...base(analyticId), userClient: operator.client, profile: { role: "operator" } });
    expect(denied.ok).toBe(false);

    // RLS lo frena igual aunque la lógica creyera que es superadmin: la fila no cambia.
    await updateAgent({ ...base(analyticId), userClient: operator.client, profile: { role: "superadmin" }, name: "Hackeado" });
    const { data } = await admin.from("agents").select("name").eq("id", analyticId).single();
    expect(data?.name).toBe("Nuevo");
  });

  it("no ve ni cambia agentes de otra organización", async () => {
    const result = await updateAgent({ ...base(analyticId), userClient: foreigner.client, profile: { role: "superadmin" } });
    expect(result).toEqual({ ok: false, error: "El agente no existe." });
  });

  it("valida el largo del nombre y de la frase", async () => {
    const params = { ...base(analyticId), userClient: superadmin.client, profile: { role: "superadmin" as const } };
    expect((await updateAgent({ ...params, name: "   " })).ok).toBe(false);
    expect((await updateAgent({ ...params, name: "x".repeat(41) })).ok).toBe(false);
    expect((await updateAgent({ ...params, tagline: "x".repeat(141) })).ok).toBe(false);
  });

  it("no enciende al agente de atención sin configuración activa, y sí con ella", async () => {
    const params = { ...base(attentionId), userClient: superadmin.client, profile: { role: "superadmin" as const }, isEnabled: true };

    const without = await updateAgent(params);
    expect(without.ok).toBe(false);
    const { data: stillOff } = await admin.from("agents").select("is_enabled").eq("id", attentionId).single();
    expect(stillOff?.is_enabled).toBe(false);

    await admin.from("agent_configs").insert({
      organization_id: orgA,
      kind: "attention",
      model: "modelo-de-prueba",
      prompt: "Prompt de prueba",
      is_active: true,
    });

    expect(await updateAgent(params)).toEqual({ ok: true });
    const { data: on } = await admin.from("agents").select("is_enabled").eq("id", attentionId).single();
    expect(on?.is_enabled).toBe(true);
  });
});
