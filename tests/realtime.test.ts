import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Realtime con RLS: un usuario suscrito a los mensajes recibe los de su organización y no los de otra.
// Es lo que usa el CRM para actualizarse solo (LiveRefresh).

const admin = adminClient();
const runId = randomId();
const orgIds: string[] = [];
const userIds: string[] = [];
const conversations: { orgId: string; conversationId: string }[] = [];

let userA: TestUser;

async function seed(orgId: string, label: string) {
  const { data: channel, error } = await admin
    .from("channels")
    .insert({ organization_id: orgId, type: "telegram", name: "Bot", external_id: `zz-test-${runId}-${label}` })
    .select("id")
    .single();
  if (error || !channel) throw new Error(`No se pudo crear el canal: ${error?.message}`);

  const { error: ingestError } = await admin.rpc("ingest_inbound_message", {
    p_organization_id: orgId,
    p_channel_id: channel.id,
    p_channel_type: "telegram",
    p_identifier: `${label === "a" ? "8" : "9"}${Date.now().toString().slice(-8)}`,
    p_contact_name: "Ana Prueba",
    p_external_id: `${runId}-${label}:1`,
    p_type: "text",
    p_body: "primero",
    p_provider_timestamp: new Date().toISOString(),
    p_raw: {},
  });
  if (ingestError) throw new Error(ingestError.message);

  const { data: conversation } = await admin.from("conversations").select("id").eq("channel_id", channel.id).single();
  if (!conversation) throw new Error("No se creó la conversación");
  conversations.push({ orgId, conversationId: conversation.id });
  return conversation.id;
}

let conversationA = "";
let conversationB = "";

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const { data, error } = await admin
      .from("organizations")
      .insert({ slug: `zz-test-${runId}-rt-${label}`, name: `Prueba Realtime ${label}` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  userA = await createTestUser(admin, { organizationId: orgIds[0] ?? "", role: "operator", label: "rt-a", runId });
  userIds.push(userA.id);

  conversationA = await seed(orgIds[0] ?? "", "a");
  conversationB = await seed(orgIds[1] ?? "", "b");
});

afterAll(async () => {
  await userA.client.removeAllChannels();
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

async function insertMessage(orgId: string, conversationId: string, body: string) {
  const { error } = await admin
    .from("messages")
    .insert({ organization_id: orgId, conversation_id: conversationId, direction: "inbound", sender: "contact", body });
  if (error) throw new Error(error.message);
}

describe("realtime con RLS", () => {
  it("recibe los mensajes nuevos de su organización y no los de otra", async () => {
    const received: string[] = [];

    const { data: session } = await userA.client.auth.getSession();
    await userA.client.realtime.setAuth(session.session?.access_token ?? null);

    const subscribed = new Promise<void>((resolve, reject) => {
      userA.client
        // wait: true espera a que el servidor confirme la suscripción antes de avisar SUBSCRIBED.
        .channel(`zz-test-${runId}`, { config: { postgres_changes_options: { wait: true } } })
        // Sin filtro: si RLS fallara, llegarían también los de la otra organización.
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, (payload) => {
          received.push(String((payload.new as { body?: string }).body));
        })
        .subscribe((status) => {
          if (status === "SUBSCRIBED") resolve();
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") reject(new Error(`Realtime: ${status}`));
        });
    });
    await subscribed;

    await insertMessage(orgIds[1] ?? "", conversationB, "de la otra organizacion");
    await insertMessage(orgIds[0] ?? "", conversationA, "de mi organizacion");

    // Se espera hasta 10 s a que llegue el propio; el ajeno ya habría llegado antes que él.
    for (let attempt = 0; attempt < 40 && !received.includes("de mi organizacion"); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    expect(received).toContain("de mi organizacion");
    expect(received).not.toContain("de la otra organizacion");
  });
});
