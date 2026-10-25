import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { processPendingMessages } from "../src/lib/inbound/process";
import { adminClient, randomId } from "./helpers/supabase-test";

// Prueba de integración de punta a punta del canal de Telegram contra el proyecto de desarrollo:
// webhook -> bandeja -> trabajador -> contacto, conversación, mensaje y crédito.
// Crea su propia organización y canal con el prefijo "zz-test-" y los borra al terminar.

const SECRET = "secreto-de-prueba-telegram";
const admin = adminClient();
const runId = randomId();
const botId = `990${Date.now().toString().slice(-8)}`;
const chatId = Number(`8${Date.now().toString().slice(-8)}`);

let organizationId = "";
let POST: (request: NextRequest, context: { params: Promise<{ botId: string }> }) => Promise<Response>;

function body(updateId: number, text: string, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    update_id: updateId,
    message: {
      message_id: updateId,
      from: { id: chatId, is_bot: false, first_name: "Ana", last_name: "Prueba" },
      chat: { id: chatId, type: "private" },
      date: 1_800_000_000 + updateId,
      text,
      ...extra,
    },
  });
}

function request(payload: string, secret: string | null = SECRET, id = botId) {
  const headers = new Headers({ "content-type": "application/json" });
  if (secret !== null) headers.set("x-telegram-bot-api-secret-token", secret);
  return [
    new NextRequest(`http://localhost/api/webhooks/telegram/${id}`, { method: "POST", body: payload, headers }),
    { params: Promise.resolve({ botId: id }) },
  ] as const;
}

async function send(payload: string, secret: string | null = SECRET, id = botId) {
  return POST(...request(payload, secret, id));
}

async function countEvents(key: string): Promise<number> {
  const { data } = await admin.from("webhook_events").select("id").eq("dedupe_key", key).eq("channel_type", "telegram");
  return data?.length ?? 0;
}

beforeAll(async () => {
  process.env.TELEGRAM_WEBHOOK_SECRET = SECRET;
  ({ POST } = await import("../src/app/api/webhooks/telegram/[botId]/route"));

  const { data: org, error } = await admin
    .from("organizations")
    .insert({ slug: `zz-test-${runId}-tg`, name: "Prueba Telegram" })
    .select("id")
    .single();
  if (error || !org) throw new Error(`No se pudo crear la organización: ${error?.message}`);
  organizationId = org.id;

  const { error: channelError } = await admin
    .from("channels")
    .insert({ organization_id: organizationId, type: "telegram", name: "Bot de prueba", external_id: botId });
  if (channelError) throw new Error(`No se pudo crear el canal: ${channelError.message}`);
});

afterAll(async () => {
  await admin.from("webhook_events").delete().eq("organization_id", organizationId);
  await admin.from("webhook_events").delete().eq("channel_type", "telegram").is("organization_id", null).like("error", "Canal no registrado: telegram 990%");
  await admin.from("organizations").delete().eq("id", organizationId);
});

describe("webhook de Telegram", () => {
  it("rechaza un secreto incorrecto o ausente y no guarda nada", async () => {
    expect((await send(body(1, "hola"), "otro-secreto")).status).toBe(401);
    expect((await send(body(1, "hola"), null)).status).toBe(401);
    expect(await countEvents(`tg:${botId}:1`)).toBe(0);
  });

  it("rechaza un cuerpo que no es JSON", async () => {
    expect((await send("esto no es json")).status).toBe(400);
  });

  it("guarda el mensaje, lo asocia a la organización del bot y no lo duplica si Telegram reintenta", async () => {
    const payload = body(2, "quiero un préstamo");
    expect((await send(payload)).status).toBe(200);
    expect((await send(payload)).status).toBe(200);
    expect((await send(payload)).status).toBe(200);
    expect(await countEvents(`tg:${botId}:2`)).toBe(1);

    const { data } = await admin
      .from("webhook_events")
      .select("organization_id, processed_at")
      .eq("dedupe_key", `tg:${botId}:2`)
      .eq("channel_type", "telegram")
      .single();
    expect(data?.organization_id).toBe(organizationId);
    expect(data?.processed_at).toBeNull();
  });

  it("responde 200 y descarta lo que no es un mensaje privado (grupos, ediciones)", async () => {
    const group = JSON.stringify({
      update_id: 3,
      message: { message_id: 3, from: { id: 1, is_bot: false, first_name: "X" }, chat: { id: -5, type: "group" }, date: 1, text: "x" },
    });
    expect((await send(group)).status).toBe(200);
    expect(await countEvents(`tg:${botId}:3`)).toBe(0);
  });

  it("guarda pero marca como procesado un bot sin canal registrado", async () => {
    const unknown = `990${Date.now().toString().slice(-7)}0`;
    expect((await send(body(4, "hola"), SECRET, unknown)).status).toBe(200);

    const { data } = await admin
      .from("webhook_events")
      .select("organization_id, processed_at, error")
      .eq("dedupe_key", `tg:${unknown}:4`)
      .eq("channel_type", "telegram")
      .is("organization_id", null)
      .single();
    expect(data?.processed_at).not.toBeNull();
    expect(data?.error).toContain("Canal no registrado");
  });
});

describe("procesamiento de punta a punta", () => {
  it("el trabajador crea contacto, conversación, mensaje y crédito", async () => {
    expect((await send(body(5, "segundo mensaje"))).status).toBe(200);
    const result = await processPendingMessages(admin, 50, new Date(), null);
    expect(result.failed).toBe(0);

    const { data: identity } = await admin
      .from("contact_identities")
      .select("contact_id, channel_type")
      .eq("organization_id", organizationId)
      .eq("identifier", String(chatId))
      .single();
    expect(identity?.channel_type).toBe("telegram");

    const { data: contact } = await admin.from("contacts").select("display_name").eq("id", identity?.contact_id ?? "").single();
    expect(contact?.display_name).toBe("Ana Prueba");

    const { data: messages } = await admin
      .from("messages")
      .select("body, type, direction, external_id")
      .eq("organization_id", organizationId)
      .order("provider_timestamp");
    expect(messages?.map((message) => message.body)).toEqual(["quiero un préstamo", "segundo mensaje"]);
    expect(messages?.[0]).toMatchObject({ type: "text", direction: "inbound", external_id: `${chatId}:2` });

    // Dos mensajes dentro de las 24 h: un solo crédito.
    const { data: windows } = await admin.from("conversation_windows").select("id").eq("organization_id", organizationId);
    expect(windows).toHaveLength(1);
  });

  it("un audio queda guardado como mensaje de tipo audio, sin texto", async () => {
    expect((await send(body(6, "", { text: undefined, voice: { file_id: "AwAD", duration: 3, mime_type: "audio/ogg" } }))).status).toBe(200);
    await processPendingMessages(admin, 50, new Date(), null);

    const { data } = await admin
      .from("messages")
      .select("type, body")
      .eq("organization_id", organizationId)
      .eq("type", "audio")
      .single();
    expect(data?.type).toBe("audio");
    expect(data?.body ?? "").toBe("");
  });
});
