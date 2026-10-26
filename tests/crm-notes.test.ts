import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createCase } from "../src/lib/crm/cases";
import { addNote, MAX_NOTE_LENGTH } from "../src/lib/crm/notes";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Notas internas contra el proyecto de desarrollo. Usa organizaciones y usuarios propios con el
// prefijo "zz-test-".

const admin = adminClient();
const runId = randomId();
const orgIds: string[] = [];
const userIds: string[] = [];

let orgA = "";
let conversationA = "";
let conversationB = "";
let operator: TestUser;
let otherOperator: TestUser;
let viewer: TestUser;
let foreigner: TestUser;

async function seedConversation(orgId: string, label: string) {
  const { data: channel } = await admin
    .from("channels")
    .insert({ organization_id: orgId, type: "telegram", name: "Bot", external_id: `zz-test-${runId}-notes-${label}` })
    .select("id")
    .single();
  if (!channel) throw new Error("No se creó el canal");

  await admin.rpc("ingest_inbound_message", {
    p_organization_id: orgId,
    p_channel_id: channel.id,
    p_channel_type: "telegram",
    p_identifier: `${label === "a" ? "4" : "5"}${Date.now().toString().slice(-8)}`,
    p_contact_name: "Ana Prueba",
    p_external_id: `${runId}-notes-${label}:1`,
    p_type: "text",
    p_body: "hola",
    p_provider_timestamp: new Date().toISOString(),
    p_raw: {},
  });
  const { data } = await admin.from("conversations").select("id").eq("channel_id", channel.id).single();
  return data?.id ?? "";
}

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const { data, error } = await admin
      .from("organizations")
      .insert({ slug: `zz-test-${runId}-notes-${label}`, name: `Prueba Notas ${label}` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  orgA = orgIds[0] ?? "";
  const orgB = orgIds[1] ?? "";

  operator = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "notes-op", runId });
  otherOperator = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "notes-op2", runId });
  viewer = await createTestUser(admin, { organizationId: orgA, role: "viewer", label: "notes-vw", runId });
  foreigner = await createTestUser(admin, { organizationId: orgB, role: "operator", label: "notes-aj", runId });
  userIds.push(operator.id, otherOperator.id, viewer.id, foreigner.id);

  conversationA = await seedConversation(orgA, "a");
  conversationB = await seedConversation(orgB, "b");
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

const as = (user: TestUser, role: "operator" | "viewer" = "operator", organizationId = orgA) => ({
  userClient: user.client,
  profile: { id: user.id, role, organizationId },
});

describe("notas internas", () => {
  it("un operador anota en una conversación sin caso", async () => {
    expect(await addNote({ ...as(operator), conversationId: conversationA, body: "  El afiliado prefiere que lo llamen a la tarde  " })).toEqual({ ok: true });

    const { data } = await admin.from("internal_notes").select("body, author_id, case_id, conversation_id").eq("conversation_id", conversationA).single();
    expect(data).toEqual({ body: "El afiliado prefiere que lo llamen a la tarde", author_id: operator.id, case_id: null, conversation_id: conversationA });
  });

  it("si hay un caso abierto, la nota queda atada también al caso", async () => {
    const created = await createCase({ ...as(operator), conversationId: conversationA, title: "Caso de prueba", sectorId: null, priority: "normal" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    expect((await addNote({ ...as(operator), conversationId: conversationA, body: "Pidió el formulario" })).ok).toBe(true);
    const { data } = await admin.from("internal_notes").select("case_id").eq("conversation_id", conversationA).eq("body", "Pidió el formulario").single();
    expect(data?.case_id).toBe(created.caseId);
  });

  it("otro operador de la organización las lee (lectura abierta, ADR-016)", async () => {
    const { data } = await otherOperator.client.from("internal_notes").select("body").eq("conversation_id", conversationA);
    expect(data?.map((note) => note.body).sort()).toEqual(["El afiliado prefiere que lo llamen a la tarde", "Pidió el formulario"].sort());
  });

  it("rechaza consulta y reportes, otra organización, vacía o demasiado larga", async () => {
    expect((await addNote({ ...as(viewer, "viewer"), conversationId: conversationA, body: "no" })).ok).toBe(false);
    expect(await addNote({ ...as(foreigner, "operator", orgIds[1]), conversationId: conversationA, body: "intruso" })).toEqual({
      ok: false,
      error: "La conversación no existe.",
    });
    expect((await addNote({ ...as(operator), conversationId: conversationA, body: "   " })).ok).toBe(false);
    expect((await addNote({ ...as(operator), conversationId: conversationA, body: "x".repeat(MAX_NOTE_LENGTH + 1) })).ok).toBe(false);
  });

  it("la organización ajena no ve las notas", async () => {
    const { data } = await foreigner.client.from("internal_notes").select("id");
    expect(data ?? []).toHaveLength(0);
  });

  it("por la base directamente, no se puede apuntar a una conversación de otra organización", async () => {
    const { error } = await foreigner.client.from("internal_notes").insert({
      organization_id: orgIds[1] ?? "",
      conversation_id: conversationA,
      author_id: foreigner.id,
      body: "referencia ajena",
    });
    expect(error).not.toBeNull();

    // Y con una conversación propia sí puede (control positivo).
    const { error: ownError } = await foreigner.client.from("internal_notes").insert({
      organization_id: orgIds[1] ?? "",
      conversation_id: conversationB,
      author_id: foreigner.id,
      body: "nota propia",
    });
    expect(ownError).toBeNull();
  });

  it("nadie puede firmar una nota con el nombre de otra persona", async () => {
    const { error } = await operator.client.from("internal_notes").insert({
      organization_id: orgA,
      conversation_id: conversationA,
      author_id: otherOperator.id,
      body: "suplantación",
    });
    expect(error).not.toBeNull();
  });

  it("las notas no se editan ni se borran desde el CRM", async () => {
    const { data: updated } = await operator.client.from("internal_notes").update({ body: "editada" }).eq("conversation_id", conversationA).select("id");
    expect(updated ?? []).toHaveLength(0);

    const { data: deleted } = await operator.client.from("internal_notes").delete().eq("conversation_id", conversationA).select("id");
    expect(deleted ?? []).toHaveLength(0);

    const { data: still } = await admin.from("internal_notes").select("body").eq("conversation_id", conversationA);
    expect(still).toHaveLength(2);
  });
});
