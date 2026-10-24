import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { answerAreaQuery } from "../src/lib/crm/area-queries";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Respuesta del sector a las consultas del agente, contra el proyecto de desarrollo. Usa
// organizaciones y usuarios propios con el prefijo "zz-test-".

const admin = adminClient();
const runId = randomId();
const orgIds: string[] = [];
const userIds: string[] = [];

let orgA = "";
let sectorId = "";
let otherSectorId = "";
let contactId = "";
let superadmin: TestUser;
let member: TestUser;
let outsider: TestUser;
let viewer: TestUser;
let foreigner: TestUser;
let counter = 0;

// Un caso en espera del área con una consulta pendiente al sector indicado.
async function seedQuery(sector: string) {
  counter += 1;
  const { data: caso, error } = await admin
    .from("cases")
    .insert({ organization_id: orgA, contact_id: contactId, title: `Caso ${counter}`, status: "waiting_area", sector_id: sector })
    .select("id")
    .single();
  if (error || !caso) throw new Error(`No se pudo crear el caso: ${error?.message}`);

  const { data: query, error: queryError } = await admin
    .from("area_queries")
    .insert({ organization_id: orgA, case_id: caso.id, sector_id: sector, question: "¿Hay cupo en marzo?" })
    .select("id")
    .single();
  if (queryError || !query) throw new Error(`No se pudo crear la consulta: ${queryError?.message}`);
  return { caseId: caso.id, queryId: query.id };
}

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const { data, error } = await admin
      .from("organizations")
      .insert({ slug: `zz-test-${runId}-aq-${label}`, name: `Prueba Consultas ${label}` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  orgA = orgIds[0] ?? "";
  const orgB = orgIds[1] ?? "";

  superadmin = await createTestUser(admin, { organizationId: orgA, role: "superadmin", label: "aq-super", runId });
  member = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "aq-miembro", runId });
  outsider = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "aq-otro", runId });
  viewer = await createTestUser(admin, { organizationId: orgA, role: "viewer", label: "aq-viewer", runId });
  foreigner = await createTestUser(admin, { organizationId: orgB, role: "operator", label: "aq-ajeno", runId });
  userIds.push(superadmin.id, member.id, outsider.id, viewer.id, foreigner.id);

  const { data: sectors, error } = await admin
    .from("sectors")
    .insert([
      { organization_id: orgA, slug: "viajes", name: "Viajes" },
      { organization_id: orgA, slug: "creditos", name: "Créditos" },
    ])
    .select("id, slug");
  if (error || !sectors) throw new Error(`No se pudieron crear los sectores: ${error?.message}`);
  sectorId = sectors.find((sector) => sector.slug === "viajes")?.id ?? "";
  otherSectorId = sectors.find((sector) => sector.slug === "creditos")?.id ?? "";

  await admin.from("sector_members").insert({ sector_id: sectorId, profile_id: member.id, organization_id: orgA });

  const { data: contact, error: contactError } = await admin
    .from("contacts")
    .insert({ organization_id: orgA, display_name: "Ana Prueba" })
    .select("id")
    .single();
  if (contactError || !contact) throw new Error(`No se pudo crear el contacto: ${contactError?.message}`);
  contactId = contact.id;
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

function as(user: TestUser, role: "superadmin" | "operator" | "viewer") {
  return { userClient: user.client, profile: { id: user.id, role } };
}

describe("responder una consulta al área", () => {
  it("un miembro del sector responde, queda registrado y el caso sigue su curso", async () => {
    const { caseId, queryId } = await seedQuery(sectorId);

    expect(await answerAreaQuery({ ...as(member, "operator"), queryId, answer: "  Hay 4 lugares.  " })).toEqual({ ok: true });

    const { data: query } = await admin.from("area_queries").select("status, answer, answered_by, answered_at, reply_sent_at").eq("id", queryId).single();
    expect(query).toMatchObject({ status: "answered", answer: "Hay 4 lugares.", answered_by: member.id, reply_sent_at: null });
    expect(query?.answered_at).not.toBeNull();

    const { data: caso } = await admin.from("cases").select("status").eq("id", caseId).single();
    expect(caso?.status).toBe("in_progress");
  });

  it("el superadmin puede responder consultas de cualquier sector", async () => {
    const { queryId } = await seedQuery(otherSectorId);
    expect(await answerAreaQuery({ ...as(superadmin, "superadmin"), queryId, answer: "Sí." })).toEqual({ ok: true });
  });

  it("un operador de otro sector no puede responder, y la consulta sigue pendiente", async () => {
    const { queryId } = await seedQuery(sectorId);
    const result = await answerAreaQuery({ ...as(outsider, "operator"), queryId, answer: "Me meto." });
    expect(result.ok).toBe(false);

    const { data } = await admin.from("area_queries").select("status, answer").eq("id", queryId).single();
    expect(data).toEqual({ status: "pending", answer: null });
  });

  it("un usuario de consulta no puede responder", async () => {
    const { queryId } = await seedQuery(sectorId);
    expect((await answerAreaQuery({ ...as(viewer, "viewer"), queryId, answer: "No." })).ok).toBe(false);
  });

  it("no ve consultas de otra organización", async () => {
    const { queryId } = await seedQuery(sectorId);
    expect(await answerAreaQuery({ ...as(foreigner, "operator"), queryId, answer: "No." })).toEqual({ ok: false, error: "La consulta no existe." });
  });

  it("no responde dos veces la misma consulta", async () => {
    const { queryId } = await seedQuery(sectorId);
    expect(await answerAreaQuery({ ...as(member, "operator"), queryId, answer: "Primera." })).toEqual({ ok: true });
    expect(await answerAreaQuery({ ...as(superadmin, "superadmin"), queryId, answer: "Segunda." })).toEqual({
      ok: false,
      error: "La consulta ya no está pendiente.",
    });

    const { data } = await admin.from("area_queries").select("answer").eq("id", queryId).single();
    expect(data?.answer).toBe("Primera.");
  });

  it("rechaza respuestas vacías o demasiado largas", async () => {
    const { queryId } = await seedQuery(sectorId);
    expect((await answerAreaQuery({ ...as(member, "operator"), queryId, answer: "   " })).ok).toBe(false);
    expect((await answerAreaQuery({ ...as(member, "operator"), queryId, answer: "x".repeat(2001) })).ok).toBe(false);
  });

  it("el caso sigue esperando al área mientras queden consultas pendientes", async () => {
    const { caseId, queryId } = await seedQuery(sectorId);
    await admin.from("area_queries").insert({ organization_id: orgA, case_id: caseId, sector_id: sectorId, question: "¿Y el precio?" });

    await answerAreaQuery({ ...as(member, "operator"), queryId, answer: "Hay cupo." });
    const { data } = await admin.from("cases").select("status").eq("id", caseId).single();
    expect(data?.status).toBe("waiting_area");
  });
});
