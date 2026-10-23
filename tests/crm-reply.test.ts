import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MAX_REPLY_LENGTH, sendOperatorReply } from "../src/lib/crm/reply";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Respuesta de un operador desde el CRM contra el proyecto de desarrollo, con un Telegram falso
// (no se manda nada real). Crea sus propias organizaciones y usuarios con el prefijo "zz-test-".

const admin = adminClient();
const runId = randomId();
const tokenVar = `ZZ_TEST_TOKEN_${runId}`;
const orgIds: string[] = [];
const userIds: string[] = [];

let telegramConversation = "";
let whatsappConversation = "";
let operator: TestUser;
let viewer: TestUser;
let foreignOperator: TestUser;
let counter = 500;
let sentCalls = 0;

const fakeTelegram = async () => {
  counter += 1;
  sentCalls += 1;
  return new Response(JSON.stringify({ ok: true, result: { message_id: counter, date: Math.floor(Date.now() / 1000) } }), { status: 200 });
};
const blockedTelegram = async () =>
  new Response(JSON.stringify({ ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" }), { status: 403 });

async function seedConversation(orgId: string, type: "telegram" | "whatsapp", lastInbound: string) {
  const { data: channel, error } = await admin
    .from("channels")
    .insert({ organization_id: orgId, type, name: `Canal ${type}`, external_id: `zz-test-${runId}-${type}`, secret_ref: tokenVar })
    .select("id")
    .single();
  if (error || !channel) throw new Error(`No se pudo crear el canal: ${error?.message}`);

  const { error: ingestError } = await admin.rpc("ingest_inbound_message", {
    p_organization_id: orgId,
    p_channel_id: channel.id,
    p_channel_type: type,
    p_identifier: `${type === "telegram" ? "7" : "549"}${Date.now().toString().slice(-8)}`,
    p_contact_name: "Ana Prueba",
    p_external_id: `${runId}-${type}:1`,
    p_type: "text",
    p_body: "hola",
    p_provider_timestamp: lastInbound,
    p_raw: {},
  });
  if (ingestError) throw new Error(`No se pudo sembrar el mensaje: ${ingestError.message}`);

  const { data: conversation } = await admin.from("conversations").select("id").eq("channel_id", channel.id).single();
  if (!conversation) throw new Error("No se creó la conversación");
  return conversation.id;
}

beforeAll(async () => {
  process.env[tokenVar] = "123456:token-de-prueba";

  for (const label of ["a", "b"]) {
    const { data, error } = await admin
      .from("organizations")
      .insert({ slug: `zz-test-${runId}-reply-${label}`, name: `Prueba Respuesta ${label}` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  const [orgA = "", orgB = ""] = orgIds;

  operator = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "reply-op", runId });
  viewer = await createTestUser(admin, { organizationId: orgA, role: "viewer", label: "reply-viewer", runId });
  foreignOperator = await createTestUser(admin, { organizationId: orgB, role: "operator", label: "reply-ajeno", runId });
  userIds.push(operator.id, viewer.id, foreignOperator.id);

  telegramConversation = await seedConversation(orgA, "telegram", new Date(Date.now() - 3600 * 1000).toISOString());
  whatsappConversation = await seedConversation(orgA, "whatsapp", new Date(Date.now() - 72 * 3600 * 1000).toISOString());
});

afterAll(async () => {
  delete process.env[tokenVar];
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

function reply(user: TestUser, role: "operator" | "viewer", conversationId: string, text: string, fetchImpl = fakeTelegram) {
  return sendOperatorReply({ userClient: user.client, admin, profile: { id: user.id, role }, conversationId, text, fetchImpl });
}

describe("respuesta del operador desde el CRM", () => {
  it("guarda y envía la respuesta firmada por el operador", async () => {
    const result = await reply(operator, "operator", telegramConversation, "  Hola Ana, te ayudo  ");
    expect(result).toEqual({ ok: true });

    const { data } = await admin
      .from("messages")
      .select("body, sender, sender_profile_id, status, direction")
      .eq("conversation_id", telegramConversation)
      .eq("direction", "outbound")
      .single();
    expect(data).toEqual({
      body: "Hola Ana, te ayudo",
      sender: "operator",
      sender_profile_id: operator.id,
      status: "sent",
      direction: "outbound",
    });
  });

  it("el rol de consulta no puede responder y no se envía nada", async () => {
    const before = sentCalls;
    const result = await reply(viewer, "viewer", telegramConversation, "no debería salir");
    expect(result.ok).toBe(false);
    expect(sentCalls).toBe(before);
  });

  it("un operador de otra organización no encuentra la conversación y no se envía nada", async () => {
    const before = sentCalls;
    const result = await reply(foreignOperator, "operator", telegramConversation, "intruso");
    expect(result).toEqual({ ok: false, error: "La conversación no existe." });
    expect(sentCalls).toBe(before);
  });

  it("rechaza un mensaje vacío o demasiado largo antes de enviar", async () => {
    const before = sentCalls;
    expect((await reply(operator, "operator", telegramConversation, "   ")).ok).toBe(false);
    expect((await reply(operator, "operator", telegramConversation, "x".repeat(MAX_REPLY_LENGTH + 1))).ok).toBe(false);
    expect(sentCalls).toBe(before);
  });

  it("en WhatsApp fuera de las 24 h explica que solo se pueden enviar plantillas", async () => {
    const result = await reply(operator, "operator", whatsappConversation, "fuera de ventana");
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("plantillas");
  });

  it("si el canal rechaza el envío, devuelve un motivo claro y deja el mensaje como fallido", async () => {
    const result = await reply(operator, "operator", telegramConversation, "no llega", blockedTelegram);
    expect(result.ok).toBe(false);
    expect(result.ok ? "" : result.error).toContain("rechazó");

    const { data } = await admin.from("messages").select("status").eq("conversation_id", telegramConversation).eq("body", "no llega").single();
    expect(data?.status).toBe("failed");
  });
});
