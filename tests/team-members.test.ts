import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMember, resetMemberAccess, setMemberActive, setMemberRole } from "../src/lib/team/members";
import { adminClient, anonClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Personas de la organización contra el proyecto de desarrollo (ADR-033). Crea sus propias organizaciones y usuarios
// con el prefijo "zz-test-". El enlace de acceso se canjea de verdad con la API de cuentas.

const admin = adminClient();
const runId = randomId();
const SITE = "https://orbita.test";
const orgIds: string[] = [];
const userIds: string[] = [];
let orgA = "";
let orgB = "";
let boss: TestUser;
let foreign: TestUser;

const emailOf = (label: string) => `zz-test-${runId}-${label}@example.test`;

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const { data, error } = await admin.from("organizations").insert({ slug: `zz-test-${runId}-team-${label}`, name: `Prueba Equipo ${label}` }).select("id").single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  [orgA = "", orgB = ""] = orgIds;
  boss = await createTestUser(admin, { organizationId: orgA, role: "superadmin", label: "team-boss", runId });
  foreign = await createTestUser(admin, { organizationId: orgB, role: "operator", label: "team-ajeno", runId });
  userIds.push(boss.id, foreign.id);
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

describe("alta de personas", () => {
  it("crea la persona con su perfil y un enlace; con el enlace elige su contraseña y entra", async () => {
    const created = await createMember(admin, { organizationId: orgA, email: emailOf("nueva"), fullName: "Nora Prueba", role: "operator", siteUrl: SITE });
    expect(created.ok).toBe(true);
    const link = created.ok ? (created.link ?? "") : "";
    expect(link.startsWith(`${SITE}/auth/confirmar?token_hash=`)).toBe(true);
    expect(link).toContain("type=recovery");

    const { data: user } = await admin.auth.admin.listUsers({ perPage: 200 });
    const userId = user.users.find((candidate) => candidate.email === emailOf("nueva"))?.id ?? "";
    userIds.push(userId);
    const { data: profile } = await admin.from("profiles").select("organization_id, role, is_active, full_name").eq("id", userId).single();
    expect(profile).toEqual({ organization_id: orgA, role: "operator", is_active: true, full_name: "Nora Prueba" });

    // Canje del enlace (lo que hace /auth/confirmar) y elección de contraseña.
    const client = anonClient();
    const token = new URL(link).searchParams.get("token_hash") ?? "";
    const { error: verifyError } = await client.auth.verifyOtp({ type: "recovery", token_hash: token });
    expect(verifyError).toBeNull();
    const password = `clave-de-prueba-${runId}-larga`;
    expect((await client.auth.updateUser({ password })).error).toBeNull();

    const { error: signInError } = await anonClient().auth.signInWithPassword({ email: emailOf("nueva"), password });
    expect(signInError).toBeNull();

    // Es de un solo uso.
    const { error: again } = await anonClient().auth.verifyOtp({ type: "recovery", token_hash: token });
    expect(again).not.toBeNull();
  });

  it("rechaza email o nombre inválidos, rol desconocido y un email que ya existe", async () => {
    const base = { organizationId: orgA, siteUrl: SITE, role: "operator" };
    expect((await createMember(admin, { ...base, email: "no-es-un-email", fullName: "Ana Prueba" })).ok).toBe(false);
    expect((await createMember(admin, { ...base, email: emailOf("x"), fullName: "A" })).ok).toBe(false);
    expect((await createMember(admin, { ...base, role: "dueño", email: emailOf("x"), fullName: "Ana Prueba" })).ok).toBe(false);

    const repeated = await createMember(admin, { ...base, email: emailOf("nueva"), fullName: "Otra Persona" });
    expect(repeated).toEqual({ ok: false, error: "Ya hay una cuenta con ese email." });
  });
});

describe("administrar personas", () => {
  let operatorId = "";

  beforeAll(async () => {
    const operator = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "team-op", runId });
    operatorId = operator.id;
    userIds.push(operatorId);
  });

  it("no toca a personas de otra organización", async () => {
    expect(await setMemberRole(admin, { organizationId: orgA, actorId: boss.id, userId: foreign.id, role: "viewer" })).toEqual({ ok: false, error: "La persona no existe." });
    expect((await setMemberActive(admin, { organizationId: orgA, actorId: boss.id, userId: foreign.id, active: false })).ok).toBe(false);
    expect((await resetMemberAccess(admin, { organizationId: orgA, userId: foreign.id, siteUrl: SITE })).ok).toBe(false);
    const { data } = await admin.from("profiles").select("role, is_active").eq("id", foreign.id).single();
    expect(data).toEqual({ role: "operator", is_active: true });
  });

  it("cambia el rol de otra persona, pero no el propio", async () => {
    expect((await setMemberRole(admin, { organizationId: orgA, actorId: boss.id, userId: operatorId, role: "viewer" })).ok).toBe(true);
    const { data } = await admin.from("profiles").select("role").eq("id", operatorId).single();
    expect(data?.role).toBe("viewer");
    expect((await setMemberRole(admin, { organizationId: orgA, actorId: boss.id, userId: boss.id, role: "viewer" })).ok).toBe(false);
  });

  it("desactivar bloquea el ingreso y reactivar lo devuelve", async () => {
    expect((await setMemberActive(admin, { organizationId: orgA, actorId: boss.id, userId: operatorId, active: false })).ok).toBe(true);
    const { data: off } = await admin.from("profiles").select("is_active").eq("id", operatorId).single();
    expect(off?.is_active).toBe(false);

    // Sin acceso no se le puede generar un enlace.
    expect((await resetMemberAccess(admin, { organizationId: orgA, userId: operatorId, siteUrl: SITE })).ok).toBe(false);

    expect((await setMemberActive(admin, { organizationId: orgA, actorId: boss.id, userId: operatorId, active: true })).ok).toBe(true);
    const { data: on } = await admin.from("profiles").select("is_active").eq("id", operatorId).single();
    expect(on?.is_active).toBe(true);
    expect((await resetMemberAccess(admin, { organizationId: orgA, userId: operatorId, siteUrl: SITE })).ok).toBe(true);
  });

  it("no se puede desactivar a uno mismo ni dejar la organización sin superadministrador", async () => {
    expect((await setMemberActive(admin, { organizationId: orgA, actorId: boss.id, userId: boss.id, active: false })).ok).toBe(false);

    // Otro superadmin: ahora el primero sí se puede bajar, y el último ya no.
    const second = await createTestUser(admin, { organizationId: orgA, role: "superadmin", label: "team-boss2", runId });
    userIds.push(second.id);
    expect((await setMemberRole(admin, { organizationId: orgA, actorId: second.id, userId: boss.id, role: "operator" })).ok).toBe(true);
    const last = await setMemberRole(admin, { organizationId: orgA, actorId: boss.id, userId: second.id, role: "operator" });
    expect(last).toEqual({ ok: false, error: "Tiene que quedar al menos un superadministrador activo." });
    expect((await setMemberActive(admin, { organizationId: orgA, actorId: boss.id, userId: second.id, active: false })).ok).toBe(false);
  });
});
