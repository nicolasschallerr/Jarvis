import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { assignCase, changeCasePriority, changeCaseSector, changeCaseStatus, createCase, MAX_CASE_TITLE_LENGTH } from "../src/lib/crm/cases";
import { listCases } from "../src/lib/crm/case-list";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Casos desde el CRM contra el proyecto de desarrollo: creación, estados e historial automático.
// Usa organizaciones y usuarios propios con el prefijo "zz-test-".

const admin = adminClient();
const runId = randomId();
const orgIds: string[] = [];
const userIds: string[] = [];

let orgA = "";
let conversationId = "";
let sectorMain = "";
let sectorOther = "";
let operatorMain: TestUser; // miembro del sector principal
let operatorOther: TestUser; // miembro de otro sector
let viewer: TestUser;
let foreigner: TestUser;
let caseId = "";

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const { data, error } = await admin
      .from("organizations")
      .insert({ slug: `zz-test-${runId}-cases-${label}`, name: `Prueba Casos ${label}` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  orgA = orgIds[0] ?? "";

  operatorMain = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "cases-op", runId });
  operatorOther = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "cases-op2", runId });
  viewer = await createTestUser(admin, { organizationId: orgA, role: "viewer", label: "cases-vw", runId });
  foreigner = await createTestUser(admin, { organizationId: orgIds[1] ?? "", role: "operator", label: "cases-aj", runId });
  userIds.push(operatorMain.id, operatorOther.id, viewer.id, foreigner.id);

  const sectors = await admin
    .from("sectors")
    .insert([
      { organization_id: orgA, slug: "principal", name: "Principal" },
      { organization_id: orgA, slug: "otro", name: "Otro" },
    ])
    .select("id, slug");
  sectorMain = sectors.data?.find((sector) => sector.slug === "principal")?.id ?? "";
  sectorOther = sectors.data?.find((sector) => sector.slug === "otro")?.id ?? "";

  await admin.from("sector_members").insert([
    { sector_id: sectorMain, profile_id: operatorMain.id, organization_id: orgA },
    { sector_id: sectorOther, profile_id: operatorOther.id, organization_id: orgA },
  ]);

  const { data: channel } = await admin
    .from("channels")
    .insert({ organization_id: orgA, type: "telegram", name: "Bot", external_id: `zz-test-${runId}-cases` })
    .select("id")
    .single();
  if (!channel) throw new Error("No se creó el canal");

  await admin.rpc("ingest_inbound_message", {
    p_organization_id: orgA,
    p_channel_id: channel.id,
    p_channel_type: "telegram",
    p_identifier: `6${Date.now().toString().slice(-8)}`,
    p_contact_name: "Ana Prueba",
    p_external_id: `${runId}-cases:1`,
    p_type: "text",
    p_body: "hola",
    p_provider_timestamp: new Date().toISOString(),
    p_raw: {},
  });
  const { data: conversation } = await admin.from("conversations").select("id").eq("channel_id", channel.id).single();
  conversationId = conversation?.id ?? "";
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

const as = (user: TestUser, role: "operator" | "viewer" = "operator", organizationId = orgA) => ({
  userClient: user.client,
  profile: { id: user.id, role, organizationId },
});

async function events() {
  const { data } = await admin.from("case_events").select("event_type, actor_type, actor_profile_id, data").eq("case_id", caseId).order("created_at");
  return data ?? [];
}

describe("casos desde el CRM", () => {
  it("un operador abre un caso en la conversación y queda el evento de alta", async () => {
    const result = await createCase({ ...as(operatorMain), conversationId, title: "  Consulta de préstamo  ", sectorId: sectorMain, priority: "normal" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    caseId = result.caseId;

    const { data } = await admin.from("cases").select("title, status, contact_id, sector_id").eq("id", caseId).single();
    expect(data).toMatchObject({ title: "Consulta de préstamo", status: "new", sector_id: sectorMain });
    expect(data?.contact_id).toBeTruthy();

    const log = await events();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ event_type: "created", actor_type: "operator", actor_profile_id: operatorMain.id });
  });

  it("no permite un segundo caso abierto en la misma conversación", async () => {
    const result = await createCase({ ...as(operatorMain), conversationId, title: "Otro", sectorId: null, priority: "low" });
    expect(result).toEqual({ ok: false, error: "Esta conversación ya tiene un caso abierto." });
  });

  it("rechaza consulta y reportes, otra organización, título vacío o largo y sector inexistente", async () => {
    expect((await createCase({ ...as(viewer, "viewer"), conversationId, title: "x", sectorId: null, priority: "low" })).ok).toBe(false);
    expect(await createCase({ ...as(foreigner, "operator", orgIds[1]), conversationId, title: "x", sectorId: null, priority: "low" })).toEqual({
      ok: false,
      error: "La conversación no existe.",
    });
    expect((await createCase({ ...as(operatorMain), conversationId, title: "   ", sectorId: null, priority: "low" })).ok).toBe(false);
    expect((await createCase({ ...as(operatorMain), conversationId, title: "x".repeat(MAX_CASE_TITLE_LENGTH + 1), sectorId: null, priority: "low" })).ok).toBe(false);
    expect((await createCase({ ...as(operatorMain), conversationId, title: "x", sectorId: crypto.randomUUID(), priority: "low" })).ok).toBe(false);
  });

  it("el operador del sector cambia el estado y la prioridad, y todo queda en el historial", async () => {
    expect((await changeCaseStatus({ ...as(operatorMain), caseId, status: "in_progress" })).ok).toBe(true);
    expect((await changeCasePriority({ ...as(operatorMain), caseId, priority: "urgent" })).ok).toBe(true);

    const log = await events();
    expect(log.map((event) => event.event_type)).toEqual(["created", "status_changed", "priority_changed"]);
    expect(log[1]?.data).toEqual({ from: "new", to: "in_progress" });
    expect(log[2]?.data).toEqual({ from: "normal", to: "urgent" });
  });

  it("un operador de otro sector ve el caso pero no puede modificarlo", async () => {
    const result = await changeCaseStatus({ ...as(operatorOther), caseId, status: "resolved" });
    expect(result.ok).toBe(false);

    const { data } = await admin.from("cases").select("status").eq("id", caseId).single();
    expect(data?.status).toBe("in_progress");
  });

  it("consulta y reportes no cambia estados", async () => {
    expect((await changeCaseStatus({ ...as(viewer, "viewer"), caseId, status: "resolved" })).ok).toBe(false);
  });

  it("al resolver se completa resolved_at y la resolución; al reabrir se borra la fecha", async () => {
    expect((await changeCaseStatus({ ...as(operatorMain), caseId, status: "resolved", resolution: "Se entregó la documentación" })).ok).toBe(true);
    const { data: resolved } = await admin.from("cases").select("resolved_at, resolution").eq("id", caseId).single();
    expect(resolved?.resolved_at).not.toBeNull();
    expect(resolved?.resolution).toBe("Se entregó la documentación");

    expect((await changeCaseStatus({ ...as(operatorMain), caseId, status: "in_progress" })).ok).toBe(true);
    const { data: reopened } = await admin.from("cases").select("resolved_at").eq("id", caseId).single();
    expect(reopened?.resolved_at).toBeNull();
  });

  it("resuelto el caso, se puede abrir uno nuevo en la misma conversación", async () => {
    await changeCaseStatus({ ...as(operatorMain), caseId, status: "resolved" });
    const result = await createCase({ ...as(operatorMain), conversationId, title: "Segundo caso", sectorId: null, priority: "low" });
    expect(result.ok).toBe(true);
  });

  it("un cambio hecho por el servidor queda como del sistema", async () => {
    const { data: another } = await admin.from("cases").select("id").eq("conversation_id", conversationId).eq("title", "Segundo caso").single();
    await admin.from("cases").update({ priority: "high" }).eq("id", another?.id ?? "");
    const { data: log } = await admin.from("case_events").select("actor_type, actor_profile_id").eq("case_id", another?.id ?? "").eq("event_type", "priority_changed").single();
    expect(log).toEqual({ actor_type: "system", actor_profile_id: null });
  });
});

describe("asignación, derivación y listas", () => {
  let secondCase = "";

  beforeAll(async () => {
    const { data } = await admin.from("cases").select("id").eq("conversation_id", conversationId).eq("title", "Segundo caso").single();
    secondCase = data?.id ?? "";
  });

  async function caseEvents(types: string[]) {
    const { data } = await admin.from("case_events").select("event_type, data").eq("case_id", secondCase).in("event_type", types).order("created_at");
    return data ?? [];
  }

  it("un operador se asigna un caso de su sector y aparece en 'mis casos'", async () => {
    // El segundo caso no tiene sector: se lo ponemos desde el servidor para que el operador pueda tomarlo.
    await admin.from("cases").update({ sector_id: sectorMain }).eq("id", secondCase);

    expect(await assignCase({ ...as(operatorMain), caseId: secondCase, assigneeId: operatorMain.id })).toEqual({ ok: true, caseId: secondCase });

    const mine = await listCases({ userClient: operatorMain.client, view: "mine", userId: operatorMain.id });
    expect(mine.map((item) => item.id)).toContain(secondCase);

    const unassigned = await listCases({ userClient: operatorMain.client, view: "unassigned", userId: operatorMain.id });
    expect(unassigned.map((item) => item.id)).not.toContain(secondCase);

    const assigned = (await caseEvents(["assigned"])).at(-1);
    expect(assigned?.data).toEqual({ from: null, to: operatorMain.id });
  });

  it("no se asigna a un usuario de consulta, ni a alguien de otra organización", async () => {
    expect((await assignCase({ ...as(operatorMain), caseId: secondCase, assigneeId: viewer.id })).ok).toBe(false);
    expect(await assignCase({ ...as(operatorMain), caseId: secondCase, assigneeId: foreigner.id })).toEqual({ ok: false, error: "La persona no existe." });
  });

  it("un operador de otro sector no puede reasignar ni derivar un caso ajeno", async () => {
    expect((await assignCase({ ...as(operatorOther), caseId: secondCase, assigneeId: operatorOther.id })).ok).toBe(false);
    expect((await changeCaseSector({ ...as(operatorOther), caseId: secondCase, sectorId: sectorOther })).ok).toBe(false);

    const { data } = await admin.from("cases").select("assigned_to, sector_id").eq("id", secondCase).single();
    expect(data).toEqual({ assigned_to: operatorMain.id, sector_id: sectorMain });
  });

  it("al derivar a otro sector se quita la asignación y quedan los dos eventos", async () => {
    expect(await changeCaseSector({ ...as(operatorMain), caseId: secondCase, sectorId: sectorOther })).toEqual({ ok: true, caseId: secondCase });

    const { data } = await admin.from("cases").select("assigned_to, sector_id").eq("id", secondCase).single();
    expect(data).toEqual({ assigned_to: null, sector_id: sectorOther });

    const events = await caseEvents(["sector_changed", "assigned"]);
    expect(events.some((event) => event.data && (event.data as { to?: string }).to === sectorOther)).toBe(true);
    expect(events.at(-1)?.data).toEqual({ from: operatorMain.id, to: null });
  });

  it("el sector nuevo lo ve en su lista y su operador puede tomarlo; el anterior ya no puede modificarlo", async () => {
    const bySector = await listCases({ userClient: operatorOther.client, view: "sector", userId: operatorOther.id, sectorId: sectorOther });
    expect(bySector.map((item) => item.id)).toContain(secondCase);

    expect((await assignCase({ ...as(operatorMain), caseId: secondCase, assigneeId: operatorMain.id })).ok).toBe(false);
    expect((await assignCase({ ...as(operatorOther), caseId: secondCase, assigneeId: operatorOther.id })).ok).toBe(true);
  });

  it("derivar al mismo sector no hace nada y consulta y reportes no puede derivar", async () => {
    const before = (await caseEvents(["sector_changed"])).length;
    expect((await changeCaseSector({ ...as(operatorOther), caseId: secondCase, sectorId: sectorOther })).ok).toBe(true);
    expect((await caseEvents(["sector_changed"])).length).toBe(before);

    expect((await changeCaseSector({ ...as(viewer, "viewer"), caseId: secondCase, sectorId: sectorMain })).ok).toBe(false);
  });

  it("'por sector' sin sector elegido devuelve una lista vacía y la vista 'todos' trae los de la organización", async () => {
    expect(await listCases({ userClient: viewer.client, view: "sector", userId: viewer.id, sectorId: null })).toEqual([]);

    const all = await listCases({ userClient: viewer.client, view: "all", userId: viewer.id, includeResolved: true });
    expect(all.length).toBeGreaterThanOrEqual(2);
    expect(all.every((item) => item.id !== undefined)).toBe(true);
  });
});

describe("listas para el tablero: resueltos recientes", () => {
  it("'solo resueltos' trae únicamente los resueltos y respeta el límite", async () => {
    const resolved = await listCases({ userClient: viewer.client, view: "all", userId: viewer.id, resolvedOnly: true, limit: 1 });
    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.status).toBe("resolved");
  });

  it("la lista normal no mezcla resueltos y la de resueltos no trae abiertos", async () => {
    const open = await listCases({ userClient: viewer.client, view: "all", userId: viewer.id });
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((item) => item.status !== "resolved")).toBe(true);

    const resolved = await listCases({ userClient: viewer.client, view: "all", userId: viewer.id, resolvedOnly: true });
    expect(resolved.every((item) => item.status === "resolved")).toBe(true);
  });
});
