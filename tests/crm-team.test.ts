import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addSectorMember, removeSectorMember, setSectorLead } from "../src/lib/crm/team";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Gestión de equipos por sector contra el proyecto de desarrollo. Usa organizaciones y usuarios
// propios con el prefijo "zz-test-".

const admin = adminClient();
const runId = randomId();
const orgIds: string[] = [];
const userIds: string[] = [];

let orgA = "";
let sectorId = "";
let superadmin: TestUser;
let operator: TestUser;
let otherOperator: TestUser;
let viewer: TestUser;
let foreigner: TestUser;

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const { data, error } = await admin
      .from("organizations")
      .insert({ slug: `zz-test-${runId}-team-${label}`, name: `Prueba Equipo ${label}` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  orgA = orgIds[0] ?? "";
  const orgB = orgIds[1] ?? "";

  superadmin = await createTestUser(admin, { organizationId: orgA, role: "superadmin", label: "team-super", runId });
  operator = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "team-op", runId });
  otherOperator = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "team-op2", runId });
  viewer = await createTestUser(admin, { organizationId: orgA, role: "viewer", label: "team-viewer", runId });
  foreigner = await createTestUser(admin, { organizationId: orgB, role: "operator", label: "team-ajeno", runId });
  userIds.push(superadmin.id, operator.id, otherOperator.id, viewer.id, foreigner.id);

  const { data: sector, error } = await admin
    .from("sectors")
    .insert({ organization_id: orgA, slug: "sector-prueba", name: "Sector de prueba" })
    .select("id")
    .single();
  if (error || !sector) throw new Error(`No se pudo crear el sector: ${error?.message}`);
  sectorId = sector.id;
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

function asSuper() {
  return { userClient: superadmin.client, profile: { id: superadmin.id, role: "superadmin" as const, organizationId: orgA } };
}
function asOperator() {
  return { userClient: operator.client, profile: { id: operator.id, role: "operator" as const, organizationId: orgA } };
}

async function memberIds() {
  const { data } = await admin.from("sector_members").select("profile_id").eq("sector_id", sectorId);
  return (data ?? []).map((row) => row.profile_id);
}

describe("equipos por sector", () => {
  it("el superadmin suma a un operador", async () => {
    expect(await addSectorMember({ ...asSuper(), sectorId, profileId: operator.id })).toEqual({ ok: true });
    expect(await memberIds()).toEqual([operator.id]);
  });

  it("no se puede sumar dos veces a la misma persona", async () => {
    const result = await addSectorMember({ ...asSuper(), sectorId, profileId: operator.id });
    expect(result).toEqual({ ok: false, error: "La persona ya está en este sector." });
  });

  it("un operador no puede cambiar equipos, ni lo logra por la base directamente", async () => {
    const result = await addSectorMember({ ...asOperator(), sectorId, profileId: otherOperator.id });
    expect(result.ok).toBe(false);
    expect(await memberIds()).toEqual([operator.id]);

    // Aunque se saltee la validación de la función, RLS lo impide.
    const { error } = await operator.client
      .from("sector_members")
      .insert({ sector_id: sectorId, profile_id: otherOperator.id, organization_id: orgA });
    expect(error).not.toBeNull();
    expect(await memberIds()).toEqual([operator.id]);
  });

  it("no suma a un usuario de consulta ni a alguien de otra organización", async () => {
    const asViewer = await addSectorMember({ ...asSuper(), sectorId, profileId: viewer.id });
    expect(asViewer.ok).toBe(false);

    const asForeigner = await addSectorMember({ ...asSuper(), sectorId, profileId: foreigner.id });
    expect(asForeigner).toEqual({ ok: false, error: "La persona no existe." });
    expect(await memberIds()).toEqual([operator.id]);
  });

  it("marca y desmarca al responsable del sector", async () => {
    expect(await setSectorLead({ ...asSuper(), sectorId, profileId: operator.id, isLead: true })).toEqual({ ok: true });
    const { data } = await admin.from("sector_members").select("is_lead").eq("profile_id", operator.id).single();
    expect(data?.is_lead).toBe(true);

    expect(await setSectorLead({ ...asSuper(), sectorId, profileId: operator.id, isLead: false })).toEqual({ ok: true });
    const { data: after } = await admin.from("sector_members").select("is_lead").eq("profile_id", operator.id).single();
    expect(after?.is_lead).toBe(false);
  });

  it("quita a una persona del sector, y avisa si no estaba", async () => {
    expect(await removeSectorMember({ ...asSuper(), sectorId, profileId: operator.id })).toEqual({ ok: true });
    expect(await memberIds()).toEqual([]);

    const again = await removeSectorMember({ ...asSuper(), sectorId, profileId: operator.id });
    expect(again).toEqual({ ok: false, error: "La persona no estaba en este sector." });
  });
});
