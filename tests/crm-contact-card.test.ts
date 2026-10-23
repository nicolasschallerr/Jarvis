import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MAX_NAME_LENGTH, updateContactCard, type ContactCardInput } from "../src/lib/crm/contact-card";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Ficha del asociado contra el proyecto de desarrollo. Todos los datos son inventados con formato
// evidente de prueba (documentos 11111111 y 22222222).

const admin = adminClient();
const runId = randomId();
const orgIds: string[] = [];
const userIds: string[] = [];

let orgA = "";
let contactId = "";
let otherContactId = "";
let operator: TestUser;
let viewer: TestUser;
let foreigner: TestUser;

const blank: ContactCardInput = { displayName: "", documentNumber: "", locality: "", notes: "" };

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const { data, error } = await admin
      .from("organizations")
      .insert({ slug: `zz-test-${runId}-card-${label}`, name: `Prueba Ficha ${label}` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  orgA = orgIds[0] ?? "";

  operator = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "card-op", runId });
  viewer = await createTestUser(admin, { organizationId: orgA, role: "viewer", label: "card-vw", runId });
  foreigner = await createTestUser(admin, { organizationId: orgIds[1] ?? "", role: "operator", label: "card-aj", runId });
  userIds.push(operator.id, viewer.id, foreigner.id);

  const contacts = await admin
    .from("contacts")
    .insert([
      { organization_id: orgA, display_name: "Ana Prueba" },
      { organization_id: orgA, display_name: "Beto Prueba" },
    ])
    .select("id, display_name");
  contactId = contacts.data?.find((contact) => contact.display_name === "Ana Prueba")?.id ?? "";
  otherContactId = contacts.data?.find((contact) => contact.display_name === "Beto Prueba")?.id ?? "";
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

const save = (user: TestUser, role: "operator" | "viewer", id: string, input: Partial<ContactCardInput>) =>
  updateContactCard({ userClient: user.client, profile: { role }, contactId: id, input: { ...blank, ...input } });

async function audit(id: string) {
  const { data } = await admin.from("audit_log").select("action, actor_profile_id, data").eq("entity_id", id).eq("action", "contact.updated").order("created_at");
  return data ?? [];
}

describe("ficha del asociado", () => {
  it("un operador completa la ficha y el documento se guarda solo con dígitos", async () => {
    const result = await save(operator, "operator", contactId, {
      displayName: "  Ana Prueba  ",
      documentNumber: "11.111.111",
      locality: "Ciudad de Prueba",
      notes: "Prefiere que la llamen a la tarde",
    });
    expect(result).toEqual({ ok: true, changed: ["document_number", "locality", "notes"], warning: null });

    const { data } = await admin.from("contacts").select("display_name, document_number, locality, notes").eq("id", contactId).single();
    expect(data).toEqual({ display_name: "Ana Prueba", document_number: "11111111", locality: "Ciudad de Prueba", notes: "Prefiere que la llamen a la tarde" });
  });

  it("deja en la auditoría qué campos cambiaron y quién, sin guardar los valores", async () => {
    const log = await audit(contactId);
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actor_profile_id: operator.id, data: { fields: ["document_number", "locality", "notes"] } });
    expect(JSON.stringify(log[0]?.data)).not.toContain("11111111");
  });

  it("guardar sin cambios no escribe nada en la auditoría", async () => {
    const result = await save(operator, "operator", contactId, { displayName: "Ana Prueba", documentNumber: "11111111", locality: "Ciudad de Prueba", notes: "Prefiere que la llamen a la tarde" });
    expect(result).toEqual({ ok: true, changed: [], warning: null });
    expect(await audit(contactId)).toHaveLength(1);
  });

  it("vaciar un campo lo borra y queda registrado", async () => {
    const result = await save(operator, "operator", contactId, { displayName: "Ana Prueba", documentNumber: "11111111", locality: "Ciudad de Prueba", notes: "" });
    expect(result.ok && result.changed).toEqual(["notes"]);

    const { data } = await admin.from("contacts").select("notes").eq("id", contactId).single();
    expect(data?.notes).toBeNull();
  });

  it("valida el documento, el nombre y la localidad", async () => {
    expect((await save(operator, "operator", contactId, { documentNumber: "abc123" })).ok).toBe(false);
    expect((await save(operator, "operator", contactId, { documentNumber: "123" })).ok).toBe(false);
    expect((await save(operator, "operator", contactId, { documentNumber: "1".repeat(12) })).ok).toBe(false);
    expect((await save(operator, "operator", contactId, { displayName: "x".repeat(MAX_NAME_LENGTH + 1) })).ok).toBe(false);
    expect((await save(operator, "operator", contactId, { locality: "x".repeat(81) })).ok).toBe(false);
  });

  it("consulta y reportes no edita y otra organización no encuentra el contacto", async () => {
    expect((await save(viewer, "viewer", contactId, { displayName: "Cambiado" })).ok).toBe(false);
    expect(await save(foreigner, "operator", contactId, { displayName: "Intruso" })).toEqual({ ok: false, error: "El contacto no existe." });

    const { data } = await admin.from("contacts").select("display_name").eq("id", contactId).single();
    expect(data?.display_name).toBe("Ana Prueba");
  });

  it("avisa si otra ficha tiene el mismo documento, pero guarda igual", async () => {
    const result = await save(operator, "operator", otherContactId, { displayName: "Beto Prueba", documentNumber: "11111111" });
    expect(result.ok).toBe(true);
    expect(result.ok && result.warning).toContain("otra ficha");

    const { data } = await admin.from("contacts").select("document_number").eq("id", otherContactId).single();
    expect(data?.document_number).toBe("11111111");
  });

  it("el cambio hecho por el servidor queda en la auditoría sin actor", async () => {
    await admin.from("contacts").update({ locality: "Otra Ciudad de Prueba" }).eq("id", otherContactId);
    const log = await audit(otherContactId);
    expect(log.at(-1)).toMatchObject({ actor_profile_id: null, data: { fields: ["locality"] } });
  });
});
