import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { OutsideWindowError } from "../src/lib/outbound/errors";
import { sendTextMessage } from "../src/lib/outbound/send";
import { adminClient, randomId } from "./helpers/supabase-test";

// Prueba de integración del envío contra el proyecto de desarrollo, con un "Telegram" falso (no se
// manda nada real). Crea su propia organización y canales con el prefijo "zz-test-".

const admin = adminClient();
const runId = randomId();
const tokenVar = `CHANNEL_TOKEN_ZZTEST_${runId.toUpperCase()}`;

let organizationId = "";
let telegramConversation = "";
let whatsappConversation = "";
let oldTelegramConversation = "";
let oldTelegramContact = "";
let counter = 100;

function fakeTelegram(ok = true) {
  return async () => {
    counter += 1;
    const body = ok
      ? { ok: true, result: { message_id: counter, date: Math.floor(Date.now() / 1000) } }
      : { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" };
    return new Response(JSON.stringify(body), { status: ok ? 200 : 403 });
  };
}

async function seedConversation(channelType: "telegram" | "whatsapp", identifier: string, lastInbound: string, suffix = "") {
  const { data: channel, error } = await admin
    .from("channels")
    .insert({
      organization_id: organizationId,
      type: channelType,
      name: `Canal ${channelType}`,
      external_id: `zz-test-${runId}-${channelType}${suffix}`,
      secret_ref: tokenVar,
    })
    .select("id")
    .single();
  if (error || !channel) throw new Error(`No se pudo crear el canal: ${error?.message}`);

  // Un mensaje entrante real, con la misma función que usa el trabajador.
  const { error: ingestError } = await admin.rpc("ingest_inbound_message", {
    p_organization_id: organizationId,
    p_channel_id: channel.id,
    p_channel_type: channelType,
    p_identifier: identifier,
    p_contact_name: "Ana Prueba",
    p_external_id: `${identifier}:1`,
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

  const { data: org, error } = await admin
    .from("organizations")
    .insert({ slug: `zz-test-${runId}-out`, name: "Prueba Envío" })
    .select("id")
    .single();
  if (error || !org) throw new Error(`No se pudo crear la organización: ${error?.message}`);
  organizationId = org.id;

  // Dentro de la ventana de 24 h (hace 1 hora) para Telegram; fuera (hace 3 días) para WhatsApp.
  telegramConversation = await seedConversation("telegram", `1${Date.now().toString().slice(-8)}`, new Date(Date.now() - 3600 * 1000).toISOString());
  whatsappConversation = await seedConversation("whatsapp", `549${Date.now().toString().slice(-8)}`, new Date(Date.now() - 72 * 3600 * 1000).toISOString());
  // Telegram con el último mensaje del contacto hace 3 días: no hay ventana abierta ahora.
  oldTelegramConversation = await seedConversation("telegram", `2${Date.now().toString().slice(-8)}`, new Date(Date.now() - 72 * 3600 * 1000).toISOString(), "-viejo");
  const { data: oldConversation } = await admin.from("conversations").select("contact_id").eq("id", oldTelegramConversation).single();
  oldTelegramContact = oldConversation?.contact_id ?? "";
});

afterAll(async () => {
  delete process.env[tokenVar];
  await admin.from("organizations").delete().eq("id", organizationId);
});

describe("envío de mensajes salientes", () => {
  it("guarda el mensaje como enviado, con el id del proveedor, y adelanta la conversación", async () => {
    const result = await sendTextMessage(admin, {
      conversationId: telegramConversation,
      text: "Hola Ana, te respondo desde Jarvis",
      sender: "operator",
      fetchImpl: fakeTelegram(),
    });

    const { data: message } = await admin.from("messages").select("direction, sender, status, body, external_id, error").eq("id", result.messageId).single();
    expect(message).toMatchObject({
      direction: "outbound",
      sender: "operator",
      status: "sent",
      body: "Hola Ana, te respondo desde Jarvis",
      error: null,
    });
    expect(message?.external_id).toBe(result.externalId);

    const { data: conversation } = await admin.from("conversations").select("last_message_at, last_inbound_at").eq("id", telegramConversation).single();
    expect(new Date(conversation?.last_message_at ?? 0).getTime()).toBeGreaterThan(new Date(conversation?.last_inbound_at ?? 0).getTime());
  });

  it("no cobra otro crédito si ya había una ventana abierta con ese contacto", async () => {
    const { data: conversation } = await admin.from("conversations").select("contact_id").eq("id", telegramConversation).single();
    const { data: windows } = await admin.from("conversation_windows").select("initiated_by").eq("contact_id", conversation?.contact_id ?? "");
    // Solo la ventana que abrió el contacto hace 1 hora: responder dentro de ella no abre otra.
    expect(windows).toEqual([{ initiated_by: "contact" }]);
  });

  it("si el negocio inicia una conversación nueva, abre su propia ventana de crédito", async () => {
    await sendTextMessage(admin, { conversationId: oldTelegramConversation, text: "te escribo yo", sender: "agent", fetchImpl: fakeTelegram() });

    const { data: windows } = await admin
      .from("conversation_windows")
      .select("initiated_by")
      .eq("contact_id", oldTelegramContact)
      .order("opened_at");
    expect(windows?.map((window) => window.initiated_by)).toEqual(["contact", "business"]);
  });

  it("si el proveedor rechaza el envío, deja el mensaje como fallido con su motivo", async () => {
    await expect(
      sendTextMessage(admin, { conversationId: telegramConversation, text: "no llega", sender: "agent", fetchImpl: fakeTelegram(false) }),
    ).rejects.toMatchObject({ name: "ChannelSendError", code: 403 });

    const { data: failed } = await admin
      .from("messages")
      .select("status, error, external_id")
      .eq("organization_id", organizationId)
      .eq("body", "no llega")
      .single();
    expect(failed?.status).toBe("failed");
    expect(failed?.external_id).toBeNull();
    expect(JSON.stringify(failed?.error)).toContain("403");
    expect(JSON.stringify(failed?.error)).not.toContain("token-de-prueba");
  });

  it("WhatsApp fuera de la ventana de 24 h rechaza el texto libre y no guarda nada", async () => {
    await expect(
      sendTextMessage(admin, { conversationId: whatsappConversation, text: "fuera de ventana", sender: "agent", fetchImpl: fakeTelegram() }),
    ).rejects.toBeInstanceOf(OutsideWindowError);

    const { data } = await admin.from("messages").select("id").eq("organization_id", organizationId).eq("body", "fuera de ventana");
    expect(data ?? []).toHaveLength(0);
  });

  it("falla con un motivo claro si el canal no tiene su token configurado", async () => {
    const saved = process.env[tokenVar];
    delete process.env[tokenVar];
    await expect(
      sendTextMessage(admin, { conversationId: telegramConversation, text: "sin token", sender: "agent", fetchImpl: fakeTelegram() }),
    ).rejects.toThrow("Falta la variable de entorno del canal");
    process.env[tokenVar] = saved;

    const { data } = await admin.from("messages").select("id").eq("organization_id", organizationId).eq("body", "sin token");
    expect(data ?? []).toHaveLength(0);
  });
});
