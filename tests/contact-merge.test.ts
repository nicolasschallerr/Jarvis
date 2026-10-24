import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { findDuplicateContacts, mergeContacts } from "../src/lib/crm/contact-merge";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Unir contactos duplicados contra el proyecto de desarrollo. Datos inventados; organizaciones y usuarios
// propios con el prefijo "zz-test-".

const admin = adminClient();
const runId = randomId();
const orgIds: string[] = [];
const userIds: string[] = [];

let orgA = "";
let telegramChannel = "";
let whatsappChannel = "";
let superadmin: TestUser;
let operator: TestUser;
let foreigner: TestUser;
let seed = 0;
let clock = Date.now() - 60 * 60 * 1000;

function tick(): string {
  clock += 1000;
  return new Date(clock).toISOString();
}

// Un contacto que escribió por un canal: la ingesta crea el contacto, su identidad, la conversación y la
// ventana de crédito, igual que en producción.
async function seedContact(channelId: string, channelType: "telegram" | "whatsapp", name: string, body = "hola") {
  seed += 1;
  const identifier = channelType === "whatsapp" ? `54900${Date.now().toString().slice(-6)}${seed}` : `7${Date.now().toString().slice(-6)}${seed}`;
  const result = await ingest(channelId, channelType, identifier, name, body);
  return { identifier, ...result };
}

async function ingest(channelId: string, channelType: "telegram" | "whatsapp", identifier: string, name: string, body: string) {
  seed += 1;
  const externalId = `${identifier}:${seed}`;
  const { error } = await admin.rpc("ingest_inbound_message", {
    p_organization_id: orgA,
    p_channel_id: channelId,
    p_channel_type: channelType,
    p_identifier: identifier,
    p_contact_name: name,
    p_external_id: externalId,
    p_type: "text",
    p_body: body,
    p_provider_timestamp: tick(),
    p_raw: {},
  });
  if (error) throw new Error(`No se pudo ingresar el mensaje: ${error.message}`);
  const { data: message } = await admin.from("messages").select("conversation_id").eq("external_id", externalId).single();
  const { data: conversation } = await admin.from("conversations").select("contact_id").eq("id", message?.conversation_id ?? "").single();
  return { conversationId: message?.conversation_id ?? "", contactId: conversation?.contact_id ?? "" };
}

async function openCase(contactId: string, conversationId: string, title: string) {
  const { data, error } = await admin
    .from("cases")
    .insert({ organization_id: orgA, contact_id: contactId, conversation_id: conversationId, title })
    .select("id")
    .single();
  if (error || !data) throw new Error(`No se pudo crear el caso: ${error?.message}`);
  return data.id;
}

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const { data, error } = await admin
      .from("organizations")
      .insert({ slug: `zz-test-${runId}-merge-${label}`, name: `Prueba Unión ${label}` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  orgA = orgIds[0] ?? "";
  const orgB = orgIds[1] ?? "";

  superadmin = await createTestUser(admin, { organizationId: orgA, role: "superadmin", label: "mg-super", runId });
  operator = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "mg-op", runId });
  foreigner = await createTestUser(admin, { organizationId: orgB, role: "superadmin", label: "mg-ajeno", runId });
  userIds.push(superadmin.id, operator.id, foreigner.id);

  const channels = await admin
    .from("channels")
    .insert([
      { organization_id: orgA, type: "telegram", name: "Bot", external_id: `zz-test-${runId}-tg` },
      { organization_id: orgA, type: "whatsapp", name: "Línea", external_id: `zz-test-${runId}-wa` },
    ])
    .select("id, type");
  telegramChannel = channels.data?.find((channel) => channel.type === "telegram")?.id ?? "";
  whatsappChannel = channels.data?.find((channel) => channel.type === "whatsapp")?.id ?? "";
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

const as = (user: TestUser, role: "superadmin" | "operator" | "viewer") => ({ userClient: user.client, profile: { role } });

describe("unir contactos de canales distintos", () => {
  it("pasa identidades, conversación y casos; completa la ficha y deja al absorbido vacío y marcado", async () => {
    const keep = await seedContact(telegramChannel, "telegram", "Ana Prueba");
    const remove = await seedContact(whatsappChannel, "whatsapp", "A. Prueba");
    const caseId = await openCase(remove.contactId, remove.conversationId, "Consulta de viaje");

    await admin.from("contacts").update({ document_number: "11111111" }).eq("id", keep.contactId);
    await admin.from("contacts").update({ document_number: "11111111", locality: "Villa Ejemplo", notes: "Prefiere la mañana" }).eq("id", remove.contactId);

    const result = await mergeContacts({ ...as(superadmin, "superadmin"), keepId: keep.contactId, removeId: remove.contactId });
    expect(result).toEqual({ ok: true, summary: { identitiesMoved: 1, conversationsMoved: 1, conversationsMerged: 0, casesMoved: 1 } });

    // Las dos identidades son del conservado.
    const { data: identities } = await admin.from("contact_identities").select("channel_type").eq("contact_id", keep.contactId);
    expect(identities?.map((identity) => identity.channel_type).sort()).toEqual(["telegram", "whatsapp"]);

    // La conversación y el caso del absorbido ahora son del conservado.
    const { data: conversation } = await admin.from("conversations").select("contact_id").eq("id", remove.conversationId).single();
    expect(conversation?.contact_id).toBe(keep.contactId);
    const { data: caso } = await admin.from("cases").select("contact_id, conversation_id").eq("id", caseId).single();
    expect(caso).toEqual({ contact_id: keep.contactId, conversation_id: remove.conversationId });

    // La ficha del conservado se completó con lo que le faltaba.
    const { data: kept } = await admin.from("contacts").select("display_name, document_number, locality, notes, merged_into").eq("id", keep.contactId).single();
    expect(kept).toEqual({ display_name: "Ana Prueba", document_number: "11111111", locality: "Villa Ejemplo", notes: "Prefiere la mañana", merged_into: null });

    // El absorbido queda vacío y marcado, sin borrarse.
    const { data: removed } = await admin.from("contacts").select("display_name, document_number, locality, notes, merged_into, merged_at").eq("id", remove.contactId).single();
    expect(removed).toMatchObject({ display_name: null, document_number: null, locality: null, notes: null, merged_into: keep.contactId });
    expect(removed?.merged_at).not.toBeNull();

    // Su ventana de crédito sigue a su nombre: el historial de facturación no se toca.
    const { data: windows } = await admin.from("conversation_windows").select("contact_id").eq("contact_id", remove.contactId);
    expect(windows).toHaveLength(1);

    // Queda registrado.
    const { data: audit } = await admin.from("audit_log").select("actor_profile_id, data").eq("entity_id", keep.contactId).eq("action", "contact.merged").single();
    expect(audit?.actor_profile_id).toBe(superadmin.id);
    expect(audit?.data).toMatchObject({ absorbed_contact: remove.contactId, identities_moved: 1 });
  });

  it("un mensaje nuevo del número absorbido cae en el contacto conservado", async () => {
    const keep = await seedContact(telegramChannel, "telegram", "Beto Prueba");
    const remove = await seedContact(whatsappChannel, "whatsapp", "Beto P.");
    await mergeContacts({ ...as(superadmin, "superadmin"), keepId: keep.contactId, removeId: remove.contactId });

    const again = await ingest(whatsappChannel, "whatsapp", remove.identifier, "Beto P.", "hola de nuevo");
    expect(again.contactId).toBe(keep.contactId);
    expect(again.conversationId).toBe(remove.conversationId);
  });
});

describe("unir contactos en el mismo canal", () => {
  it("junta los mensajes en la conversación del conservado y elimina la otra", async () => {
    const keep = await seedContact(telegramChannel, "telegram", "Carla Prueba", "primer mensaje de Carla");
    const remove = await seedContact(telegramChannel, "telegram", "Carla P.", "primer mensaje del duplicado");
    await ingest(telegramChannel, "telegram", remove.identifier, "Carla P.", "segundo mensaje del duplicado");
    const caseId = await openCase(remove.contactId, remove.conversationId, "Consulta");

    const result = await mergeContacts({ ...as(superadmin, "superadmin"), keepId: keep.contactId, removeId: remove.contactId });
    expect(result).toEqual({ ok: true, summary: { identitiesMoved: 1, conversationsMoved: 0, conversationsMerged: 1, casesMoved: 1 } });

    const { data: messages } = await admin.from("messages").select("body").eq("conversation_id", keep.conversationId);
    expect(messages?.map((message) => message.body).sort()).toEqual([
      "primer mensaje de Carla",
      "primer mensaje del duplicado",
      "segundo mensaje del duplicado",
    ]);

    // La conversación del absorbido ya no existe y su caso se mudó a la del conservado.
    const { data: gone } = await admin.from("conversations").select("id").eq("id", remove.conversationId);
    expect(gone).toEqual([]);
    const { data: caso } = await admin.from("cases").select("conversation_id, contact_id").eq("id", caseId).single();
    expect(caso).toEqual({ conversation_id: keep.conversationId, contact_id: keep.contactId });

    // La conversación conserva la actividad más reciente de las dos.
    const { data: conversation } = await admin.from("conversations").select("last_message_at, last_inbound_at").eq("id", keep.conversationId).single();
    const { data: newest } = await admin.from("messages").select("provider_timestamp").eq("conversation_id", keep.conversationId).order("provider_timestamp", { ascending: false }).limit(1).single();
    expect(new Date(conversation?.last_message_at ?? 0).getTime()).toBe(new Date(newest?.provider_timestamp ?? 0).getTime());
  });

  it("si los dos tienen un caso abierto en el mismo canal, no se une nada", async () => {
    const keep = await seedContact(telegramChannel, "telegram", "Dani Prueba");
    const remove = await seedContact(telegramChannel, "telegram", "Dani P.");
    await openCase(keep.contactId, keep.conversationId, "Caso uno");
    await openCase(remove.contactId, remove.conversationId, "Caso dos");

    const result = await mergeContacts({ ...as(superadmin, "superadmin"), keepId: keep.contactId, removeId: remove.contactId });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("caso abierto en el mismo canal");

    // Atómico: nada cambió.
    const { data: conversation } = await admin.from("conversations").select("contact_id").eq("id", remove.conversationId).single();
    expect(conversation?.contact_id).toBe(remove.contactId);
    const { data: removed } = await admin.from("contacts").select("merged_into, display_name").eq("id", remove.contactId).single();
    expect(removed).toEqual({ merged_into: null, display_name: "Dani P." });
  });

  it("si uno de los dos casos está resuelto, sí se puede unir", async () => {
    const keep = await seedContact(telegramChannel, "telegram", "Eva Prueba");
    const remove = await seedContact(telegramChannel, "telegram", "Eva P.");
    await openCase(keep.contactId, keep.conversationId, "Abierto");
    const closed = await openCase(remove.contactId, remove.conversationId, "Cerrado");
    await admin.from("cases").update({ status: "resolved" }).eq("id", closed);

    const result = await mergeContacts({ ...as(superadmin, "superadmin"), keepId: keep.contactId, removeId: remove.contactId });
    expect(result.ok).toBe(true);
  });
});

describe("permisos y límites", () => {
  it("un operador no puede unir contactos", async () => {
    const keep = await seedContact(telegramChannel, "telegram", "Fede Prueba");
    const remove = await seedContact(whatsappChannel, "whatsapp", "Fede P.");

    expect((await mergeContacts({ ...as(operator, "operator"), keepId: keep.contactId, removeId: remove.contactId })).ok).toBe(false);

    // Ni siquiera salteando la verificación de rol: la base lo exige también.
    const forced = await mergeContacts({ ...as(operator, "superadmin"), keepId: keep.contactId, removeId: remove.contactId });
    expect(forced.ok).toBe(false);
    const { data } = await admin.from("contacts").select("merged_into").eq("id", remove.contactId).single();
    expect(data?.merged_into).toBeNull();
  });

  it("un superadmin de otra organización no ve esos contactos", async () => {
    const keep = await seedContact(telegramChannel, "telegram", "Gabi Prueba");
    const remove = await seedContact(whatsappChannel, "whatsapp", "Gabi P.");
    const result = await mergeContacts({ ...as(foreigner, "superadmin"), keepId: keep.contactId, removeId: remove.contactId });
    expect(result.ok).toBe(false);
  });

  it("no se une un contacto consigo mismo ni uno ya unido", async () => {
    const keep = await seedContact(telegramChannel, "telegram", "Hugo Prueba");
    const remove = await seedContact(whatsappChannel, "whatsapp", "Hugo P.");

    expect(await mergeContacts({ ...as(superadmin, "superadmin"), keepId: keep.contactId, removeId: keep.contactId })).toEqual({
      ok: false,
      error: "No se puede unir un contacto consigo mismo.",
    });

    expect((await mergeContacts({ ...as(superadmin, "superadmin"), keepId: keep.contactId, removeId: remove.contactId })).ok).toBe(true);
    const again = await mergeContacts({ ...as(superadmin, "superadmin"), keepId: keep.contactId, removeId: remove.contactId });
    expect(again).toEqual({ ok: false, error: "Uno de los contactos ya fue unido a otro" });
  });
});

describe("posibles duplicados", () => {
  it("encuentra otras fichas con el mismo documento y no las ya unidas ni las de otro documento", async () => {
    const main = await seedContact(telegramChannel, "telegram", "Irene Prueba");
    const same = await seedContact(whatsappChannel, "whatsapp", "Irene P.");
    const other = await seedContact(telegramChannel, "telegram", "Otra Prueba");
    const already = await seedContact(whatsappChannel, "whatsapp", "Irene Q.");

    await admin.from("contacts").update({ document_number: "22222222" }).in("id", [main.contactId, same.contactId, already.contactId]);
    await admin.from("contacts").update({ document_number: "33333333" }).eq("id", other.contactId);

    const before = await findDuplicateContacts({ userClient: superadmin.client, contactId: main.contactId });
    expect(before.map((candidate) => candidate.id).sort()).toEqual([already.contactId, same.contactId].sort());
    expect(before.find((candidate) => candidate.id === same.contactId)?.identities).toEqual([{ channelType: "whatsapp", identifier: same.identifier }]);

    await mergeContacts({ ...as(superadmin, "superadmin"), keepId: main.contactId, removeId: already.contactId });
    const after = await findDuplicateContacts({ userClient: superadmin.client, contactId: main.contactId });
    expect(after.map((candidate) => candidate.id)).toEqual([same.contactId]);
  });

  it("sin documento no hay candidatos", async () => {
    const lonely = await seedContact(telegramChannel, "telegram", "Sin Documento");
    expect(await findDuplicateContacts({ userClient: superadmin.client, contactId: lonely.contactId })).toEqual([]);
  });
});
