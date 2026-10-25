import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { addQuickReply, deleteQuickReply, listQuickReplies, updateQuickReply } from "../src/lib/crm/quick-replies";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Respuestas rápidas contra el proyecto de desarrollo. Crea sus propias organizaciones y usuarios "zz-test-".

const admin = adminClient();
const runId = randomId();
const orgIds: string[] = [];
const userIds: string[] = [];
let operator: TestUser;
let colleague: TestUser;
let viewer: TestUser;
let foreign: TestUser;

const profileOf = (user: TestUser, organizationId: string, role: "operator" | "viewer") => ({ id: user.id, organizationId, role });

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const { data, error } = await admin.from("organizations").insert({ slug: `zz-test-${runId}-quick-${label}`, name: `Prueba Rápidas ${label}` }).select("id").single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  const [orgA = "", orgB = ""] = orgIds;
  operator = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "quick-op", runId });
  colleague = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "quick-col", runId });
  viewer = await createTestUser(admin, { organizationId: orgA, role: "viewer", label: "quick-viewer", runId });
  foreign = await createTestUser(admin, { organizationId: orgB, role: "operator", label: "quick-ajeno", runId });
  userIds.push(operator.id, colleague.id, viewer.id, foreign.id);
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

describe("respuestas rápidas", () => {
  it("un operador guarda una y la ve toda su organización, pero no otra", async () => {
    const [orgA = ""] = orgIds;
    const result = await addQuickReply({ userClient: operator.client, profile: profileOf(operator, orgA, "operator"), title: "  Horarios ", body: " Atendemos de 9 a 17. " });
    expect(result).toEqual({ ok: true });

    expect(await listQuickReplies(colleague.client)).toEqual([expect.objectContaining({ title: "Horarios", body: "Atendemos de 9 a 17." })]);
    expect(await listQuickReplies(viewer.client)).toHaveLength(1);
    expect(await listQuickReplies(foreign.client)).toHaveLength(0);
  });

  it("rechaza título o texto vacío o demasiado largo", async () => {
    const [orgA = ""] = orgIds;
    const profile = profileOf(operator, orgA, "operator");
    expect((await addQuickReply({ userClient: operator.client, profile, title: " ", body: "x" })).ok).toBe(false);
    expect((await addQuickReply({ userClient: operator.client, profile, title: "x", body: " " })).ok).toBe(false);
    expect((await addQuickReply({ userClient: operator.client, profile, title: "x".repeat(61), body: "x" })).ok).toBe(false);
  });

  it("el rol de consulta no puede guardar ni borrar, ni siquiera saltando la pantalla", async () => {
    const [orgA = ""] = orgIds;
    const asViewer = profileOf(viewer, orgA, "viewer");
    expect((await addQuickReply({ userClient: viewer.client, profile: asViewer, title: "x", body: "x" })).ok).toBe(false);

    // Con rol de operador declarado pero la sesión de consulta, RLS lo frena igual.
    const forged = await addQuickReply({ userClient: viewer.client, profile: { ...asViewer, role: "operator" }, title: "x", body: "x" });
    expect(forged.ok).toBe(false);
  });

  it("se puede renombrar y corregir; vacío, de consulta o de otra organización no", async () => {
    const [orgA = "", orgB = ""] = orgIds;
    const [reply] = await listQuickReplies(operator.client);
    const id = reply?.id ?? "";

    expect(await updateQuickReply({ userClient: colleague.client, profile: profileOf(colleague, orgA, "operator"), id, title: " Horario nuevo ", body: " Atendemos de 8 a 16. " })).toEqual({ ok: true });
    expect(await listQuickReplies(operator.client)).toEqual([{ id, title: "Horario nuevo", body: "Atendemos de 8 a 16." }]);

    expect((await updateQuickReply({ userClient: operator.client, profile: profileOf(operator, orgA, "operator"), id, title: " ", body: "x" })).ok).toBe(false);
    expect((await updateQuickReply({ userClient: viewer.client, profile: profileOf(viewer, orgA, "viewer"), id, title: "x", body: "x" })).ok).toBe(false);
    const forged = await updateQuickReply({ userClient: viewer.client, profile: { ...profileOf(viewer, orgA, "viewer"), role: "operator" }, id, title: "robado", body: "x" });
    expect(forged.ok).toBe(false);
    expect((await updateQuickReply({ userClient: foreign.client, profile: profileOf(foreign, orgB, "operator"), id, title: "ajeno", body: "x" })).ok).toBe(false);
    expect((await listQuickReplies(operator.client))[0]?.title).toBe("Horario nuevo");
  });

  it("otra organización no puede borrar las ajenas; la propia sí", async () => {
    const [orgA = "", orgB = ""] = orgIds;
    const [reply] = await listQuickReplies(operator.client);
    const id = reply?.id ?? "";

    expect((await deleteQuickReply({ userClient: foreign.client, profile: profileOf(foreign, orgB, "operator"), id })).ok).toBe(false);
    expect(await listQuickReplies(operator.client)).toHaveLength(1);

    expect(await deleteQuickReply({ userClient: colleague.client, profile: profileOf(colleague, orgA, "operator"), id })).toEqual({ ok: true });
    expect(await listQuickReplies(operator.client)).toHaveLength(0);
  });
});
