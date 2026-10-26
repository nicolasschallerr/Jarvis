import { createHmac } from "node:crypto";

import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { inboxQueryFrom } from "../src/lib/crm/inbox";
import { processPendingMessages } from "../src/lib/inbound/process";
import { OutsideWindowError } from "../src/lib/outbound/errors";
import { sendTextMessage } from "../src/lib/outbound/send";
import { adminClient, randomId } from "./helpers/supabase-test";

// Messenger, Instagram y WhatsApp de punta a punta contra el proyecto de desarrollo, con un Meta falso (no se llama a
// nadie): el webhook firmado, el procesamiento, los adjuntos, los estados de entrega y el envío con sus ventanas.
// Crea su propia organización y canales con el prefijo "zz-test-" y los borra al terminar.

const APP_SECRET = "secreto-de-la-app-de-prueba";
const INSTAGRAM_SECRET = "secreto-de-instagram-de-prueba";
const VERIFY_TOKEN = "token-de-verificacion-de-prueba";

const admin = adminClient();
const runId = randomId();
const suffix = runId.toUpperCase();
const messengerAccount = `zz-test-${runId}-fb`;
const instagramAccount = `zz-test-${runId}-ig`;
const whatsappAccount = `zz-test-${runId}-wa`;
const messengerToken = `MESSENGER_ACCESS_TOKEN_ZZ${suffix}`;
const instagramToken = `INSTAGRAM_ACCESS_TOKEN_ZZ${suffix}`;
const whatsappToken = `WHATSAPP_ACCESS_TOKEN_ZZ${suffix}`;

let organizationId = "";
let GET: (request: NextRequest) => Promise<Response>;
let POST: (request: NextRequest) => Promise<Response>;

type Call = { url: string; init?: RequestInit };

// Los ids que inventa el Meta falso no se pueden repetir entre una llamada y otra (lección 55).
let outgoing = 0;

// Un Meta falso: contesta según la dirección. Guarda las llamadas para revisar a quién se le habló y con qué.
function fakeMeta() {
  const calls: Call[] = [];
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url: input, init });
    const url = new URL(input);

    if (init?.method === "POST" && url.pathname.endsWith("/me/messages")) {
      outgoing += 1;
      return new Response(JSON.stringify({ recipient_id: "x", message_id: `mid.${runId}.${outgoing}` }), { status: 200 });
    }
    if (init?.method === "POST" && url.pathname.endsWith("/messages")) {
      outgoing += 1;
      return new Response(JSON.stringify({ messages: [{ id: `wamid.${runId}.${outgoing}` }] }), { status: 200 });
    }
    if (url.hostname.endsWith("graph.facebook.com") || url.hostname.endsWith("graph.instagram.com")) {
      if (url.pathname.endsWith(`/MEDIA_${suffix}`)) {
        return new Response(JSON.stringify({ url: `https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=${suffix}`, mime_type: "image/jpeg", file_size: 8 }), { status: 200 });
      }
      return new Response(JSON.stringify({ name: "Ana Prueba", id: url.pathname.split("/").at(-1) }), { status: 200 });
    }
    if (url.hostname.endsWith("fbcdn.net") || url.hostname.endsWith("cdninstagram.com") || url.hostname.endsWith("fbsbx.com")) {
      return new Response(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), { status: 200, headers: { "content-type": "image/jpeg" } });
    }
    throw new Error(`Llamada inesperada a ${input}`);
  };
  return { calls, fetchImpl };
}

function signed(body: string, secret = APP_SECRET, path = "/api/webhooks/meta") {
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  return new NextRequest(`http://localhost${path}`, { method: "POST", body, headers: { "content-type": "application/json", "x-hub-signature-256": signature } });
}

function messagingBody(object: "page" | "instagram", account: string, person: string, message: Record<string, unknown>, timestamp = Date.now()) {
  return JSON.stringify({ object, entry: [{ id: account, time: timestamp, messaging: [{ sender: { id: person }, recipient: { id: account }, timestamp, message }] }] });
}

async function receive(body: string, secret = APP_SECRET) {
  const response = await POST(signed(body, secret));
  expect(response.status).toBe(200);
}

async function drain(fetchImpl: (input: string, init?: RequestInit) => Promise<Response>) {
  return processPendingMessages(admin, 50, new Date(), null, null, fetchImpl);
}

async function messageByExternalId(externalId: string) {
  const { data } = await admin.from("messages").select("id, type, body, status, error, conversation_id, direction").eq("organization_id", organizationId).eq("external_id", externalId).maybeSingle();
  return data;
}

// Un mensaje entrante ya guardado, con la hora del proveedor que se indique: sirve para armar conversaciones con la
// ventana abierta o vencida.
async function seedConversation(channelType: "messenger" | "instagram" | "whatsapp", account: string, person: string, hoursAgo: number) {
  const { data: channel } = await admin.from("channels").select("id").eq("organization_id", organizationId).eq("external_id", account).single();
  if (!channel) throw new Error("Falta el canal");
  const { error } = await admin.rpc("ingest_inbound_message", {
    p_organization_id: organizationId,
    p_channel_id: channel.id,
    p_channel_type: channelType,
    p_identifier: person,
    p_contact_name: "Ana Prueba",
    p_external_id: `seed.${runId}.${person}`,
    p_type: "text",
    p_body: "hola",
    p_provider_timestamp: new Date(Date.now() - hoursAgo * 3600 * 1000).toISOString(),
    p_raw: {},
  });
  if (error) throw new Error(`No se pudo sembrar: ${error.message}`);
  const { data: identity } = await admin.from("contact_identities").select("contact_id").eq("organization_id", organizationId).eq("channel_type", channelType).eq("identifier", person).single();
  const { data: conversation } = await admin.from("conversations").select("id").eq("channel_id", channel.id).eq("contact_id", identity?.contact_id ?? "").single();
  if (!conversation) throw new Error("No se creó la conversación");
  return conversation.id;
}

beforeAll(async () => {
  process.env.META_APP_SECRET = APP_SECRET;
  process.env.INSTAGRAM_APP_SECRET = INSTAGRAM_SECRET;
  process.env.META_WEBHOOK_VERIFY_TOKEN = VERIFY_TOKEN;
  process.env[messengerToken] = "TOKEN-MESSENGER-DE-PRUEBA";
  process.env[instagramToken] = "TOKEN-INSTAGRAM-DE-PRUEBA";
  process.env[whatsappToken] = "TOKEN-WHATSAPP-DE-PRUEBA";
  ({ GET, POST } = await import("../src/app/api/webhooks/meta/route"));

  const { data: org, error } = await admin.from("organizations").insert({ slug: `zz-test-${runId}-meta`, name: "Prueba Meta" }).select("id").single();
  if (error || !org) throw new Error(`No se pudo crear la organización: ${error?.message}`);
  organizationId = org.id;

  const { error: channelsError } = await admin.from("channels").insert([
    { organization_id: organizationId, type: "messenger", name: "Página de prueba", external_id: messengerAccount, secret_ref: messengerToken },
    { organization_id: organizationId, type: "instagram", name: "Instagram de prueba", external_id: instagramAccount, secret_ref: instagramToken },
    { organization_id: organizationId, type: "whatsapp", name: "Número de prueba", external_id: whatsappAccount, secret_ref: whatsappToken },
  ]);
  if (channelsError) throw new Error(`No se pudieron crear los canales: ${channelsError.message}`);
});

afterAll(async () => {
  delete process.env[messengerToken];
  delete process.env[instagramToken];
  delete process.env[whatsappToken];
  await admin.from("webhook_events").delete().eq("organization_id", organizationId);
  await admin.from("organizations").delete().eq("id", organizationId);
});

describe("webhook de Meta", () => {
  it("el GET de verificación devuelve el desafío solo con el token correcto", async () => {
    const ok = await GET(new NextRequest(`http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=12345`));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("12345");
    const bad = await GET(new NextRequest("http://localhost/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=12345"));
    expect(bad.status).toBe(403);
  });

  it("rechaza lo que no está firmado o está mal firmado", async () => {
    const body = messagingBody("page", messengerAccount, `p-${runId}-0`, { mid: `m.${runId}.sinfirma`, text: "hola" });
    const missing = await POST(new NextRequest("http://localhost/api/webhooks/meta", { method: "POST", body, headers: { "content-type": "application/json" } }));
    expect(missing.status).toBe(401);
    const wrong = await POST(signed(body, "otro-secreto"));
    expect(wrong.status).toBe(401);
    expect(await messageByExternalId(`m.${runId}.sinfirma`)).toBeNull();
    const { data: stored } = await admin.from("webhook_events").select("id").eq("dedupe_key", `fb:m.${runId}.sinfirma`);
    expect(stored ?? []).toHaveLength(0);
  });

  it("acepta la firma de la aplicación de Instagram además de la de Meta", async () => {
    const body = messagingBody("instagram", instagramAccount, `p-${runId}-sig`, { mid: `ig.${runId}.firma`, text: "hola por instagram" });
    await receive(body, INSTAGRAM_SECRET);
    const { data: stored } = await admin.from("webhook_events").select("organization_id, channel_type").eq("dedupe_key", `ig:ig.${runId}.firma`);
    expect(stored).toEqual([{ organization_id: organizationId, channel_type: "instagram" }]);
  });

  it("un reintento de Meta no duplica el evento", async () => {
    const body = messagingBody("page", messengerAccount, `p-${runId}-dup`, { mid: `m.${runId}.dup`, text: "hola" });
    await receive(body);
    await receive(body);
    const { data: stored } = await admin.from("webhook_events").select("id").eq("dedupe_key", `fb:m.${runId}.dup`);
    expect(stored).toHaveLength(1);
  });

  it("la dirección original de WhatsApp sigue funcionando y se separan los tres canales en un mismo sobre", async () => {
    const { POST: legacyPost } = await import("../src/app/api/webhooks/whatsapp/route");
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "1", changes: [{ field: "messages", value: { metadata: { phone_number_id: whatsappAccount }, contacts: [{ profile: { name: "Ana" }, wa_id: `549${runId}1` }], messages: [{ from: `549${runId}1`, id: `wamid.${runId}.legacy`, timestamp: "1800000000", type: "text", text: { body: "hola" } }] } }] }],
    });
    const response = await legacyPost(signed(body, APP_SECRET, "/api/webhooks/whatsapp"));
    expect(response.status).toBe(200);
    const { data: stored } = await admin.from("webhook_events").select("channel_type").eq("dedupe_key", `msg:wamid.${runId}.legacy`);
    expect(stored).toEqual([{ channel_type: "whatsapp" }]);
  });
});

describe("procesamiento de Messenger e Instagram", () => {
  it("guarda el mensaje con su contacto y pide el nombre una sola vez, con el token en el encabezado", async () => {
    const person = `p-${runId}-nombre`;
    await receive(messagingBody("page", messengerAccount, person, { mid: `m.${runId}.nombre`, text: "Hola, quiero asociarme" }));
    const meta = fakeMeta();
    await drain(meta.fetchImpl);

    const message = await messageByExternalId(`m.${runId}.nombre`);
    expect(message).toMatchObject({ type: "text", body: "Hola, quiero asociarme", direction: "inbound" });

    const { data: identity } = await admin.from("contact_identities").select("channel_type, contacts(display_name)").eq("organization_id", organizationId).eq("identifier", person).single();
    expect(identity).toMatchObject({ channel_type: "messenger", contacts: { display_name: "Ana Prueba" } });

    const profileCalls = meta.calls.filter((call) => call.url.includes(`/${person}?fields=name`));
    expect(profileCalls).toHaveLength(1);
    expect(profileCalls[0]?.init?.headers).toMatchObject({ authorization: "Bearer TOKEN-MESSENGER-DE-PRUEBA" });
    expect(profileCalls[0]?.url).not.toContain("TOKEN-MESSENGER-DE-PRUEBA");

    // Un segundo mensaje de la misma persona no vuelve a pedir el nombre.
    await receive(messagingBody("page", messengerAccount, person, { mid: `m.${runId}.nombre2`, text: "otra cosa" }));
    const second = fakeMeta();
    await drain(second.fetchImpl);
    expect(second.calls.filter((call) => call.url.includes("fields=name"))).toHaveLength(0);
  });

  it("un adjunto de Instagram se descarga de los servidores de Meta y queda guardado", async () => {
    const person = `p-${runId}-foto`;
    await receive(messagingBody("instagram", instagramAccount, person, { mid: `ig.${runId}.foto`, attachments: [{ type: "image", payload: { url: "https://scontent.cdninstagram.com/v/foto.jpg" } }] }));
    const meta = fakeMeta();
    await drain(meta.fetchImpl);

    const message = await messageByExternalId(`ig.${runId}.foto`);
    expect(message).toMatchObject({ type: "image" });
    const { data: file } = await admin.from("media_files").select("mime_type, size_bytes").eq("message_id", message?.id ?? "").single();
    expect(file).toEqual({ mime_type: "image/jpeg", size_bytes: 8 });
    expect(meta.calls.some((call) => call.url === "https://scontent.cdninstagram.com/v/foto.jpg")).toBe(true);
  });

  it("una dirección de adjunto que no es de Meta no se descarga, pero el mensaje se guarda igual", async () => {
    const person = `p-${runId}-malo`;
    await receive(messagingBody("page", messengerAccount, person, { mid: `m.${runId}.malo`, attachments: [{ type: "image", payload: { url: "https://evil.example.com/foto.jpg" } }] }));
    const meta = fakeMeta();
    await drain(meta.fetchImpl);

    const message = await messageByExternalId(`m.${runId}.malo`);
    expect(message).toMatchObject({ type: "image" });
    expect(meta.calls.some((call) => call.url.includes("evil.example.com"))).toBe(false);
    const { data: files } = await admin.from("media_files").select("id").eq("message_id", message?.id ?? "");
    expect(files ?? []).toHaveLength(0);
    // El evento no queda con error ni se reintenta: la dirección de un adjunto de Meta caduca y reintentar no sirve.
    const { data: event } = await admin.from("webhook_events").select("processed_at, error").eq("dedupe_key", `fb:m.${runId}.malo`).single();
    expect(event?.error).toBeNull();
    expect(event?.processed_at).not.toBeNull();
  });

  it("un adjunto de WhatsApp se pide por su id y se baja con el token del canal", async () => {
    const person = `549${runId}2`;
    const body = JSON.stringify({
      object: "whatsapp_business_account",
      entry: [{ id: "1", changes: [{ field: "messages", value: { metadata: { phone_number_id: whatsappAccount }, contacts: [{ profile: { name: "Ana" }, wa_id: person }], messages: [{ from: person, id: `wamid.${runId}.foto`, timestamp: "1800000000", type: "image", image: { id: `MEDIA_${suffix}`, mime_type: "image/jpeg", caption: "mi DNI" } }] } }] }],
    });
    await receive(body);
    const meta = fakeMeta();
    await drain(meta.fetchImpl);

    const message = await messageByExternalId(`wamid.${runId}.foto`);
    expect(message).toMatchObject({ type: "image", body: "mi DNI" });
    const { data: file } = await admin.from("media_files").select("size_bytes").eq("message_id", message?.id ?? "").single();
    expect(file?.size_bytes).toBe(8);
    const authorized = meta.calls.filter((call) => (call.init?.headers as Record<string, string> | undefined)?.authorization === "Bearer TOKEN-WHATSAPP-DE-PRUEBA");
    expect(authorized).toHaveLength(2);
  });
});

describe("estados de entrega de WhatsApp", () => {
  it("el estado solo avanza y un fallo guarda su motivo", async () => {
    const conversation = await seedConversation("whatsapp", whatsappAccount, `549${runId}3`, 1);
    const meta = fakeMeta();
    const sent = await sendTextMessage(admin, { conversationId: conversation, text: "Hola Ana", sender: "agent", fetchImpl: meta.fetchImpl });

    const status = (state: string, extra: Record<string, unknown> = {}) =>
      JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { metadata: { phone_number_id: whatsappAccount }, statuses: [{ id: sent.externalId, status: state, timestamp: "1800000000", recipient_id: "x", ...extra }] } }] }] });

    await receive(status("delivered"));
    await drain(meta.fetchImpl);
    expect((await messageByExternalId(sent.externalId))?.status).toBe("delivered");

    await receive(status("read"));
    await drain(meta.fetchImpl);
    expect((await messageByExternalId(sent.externalId))?.status).toBe("read");

    // Un "sent" que llega tarde no hace retroceder el estado.
    await receive(status("sent"));
    await drain(meta.fetchImpl);
    expect((await messageByExternalId(sent.externalId))?.status).toBe("read");

    const failedConversation = await seedConversation("whatsapp", whatsappAccount, `549${runId}4`, 1);
    const failedMessage = await sendTextMessage(admin, { conversationId: failedConversation, text: "No llega", sender: "agent", fetchImpl: meta.fetchImpl });
    await receive(
      JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { metadata: { phone_number_id: whatsappAccount }, statuses: [{ id: failedMessage.externalId, status: "failed", timestamp: "1800000001", errors: [{ code: 131026, title: "Message undeliverable" }] }] } }] }] }),
    );
    await drain(meta.fetchImpl);
    const failed = await messageByExternalId(failedMessage.externalId);
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toEqual({ code: 131026, message: "Message undeliverable" });
  });

  it("un aviso de un mensaje que todavía no existe se deja pendiente un rato y después se descarta sin romper", async () => {
    await receive(
      JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { metadata: { phone_number_id: whatsappAccount }, statuses: [{ id: `wamid.${runId}.fantasma`, status: "delivered", timestamp: "1800000000" }] } }] }] }),
    );
    const meta = fakeMeta();
    await drain(meta.fetchImpl);

    // Recién llegado: el envío puede estar todavía guardándose su id, así que no se da por perdido.
    const key = `status:wamid.${runId}.fantasma:delivered`;
    const { data: waiting } = await admin.from("webhook_events").select("processed_at, error, claimed_at").eq("dedupe_key", key).single();
    expect(waiting?.processed_at).toBeNull();
    expect(waiting?.error).toBeNull();
    expect(waiting?.claimed_at).toBeNull();

    // Pasado el tiempo de espera, se descarta sin error.
    await admin.from("webhook_events").update({ received_at: new Date(Date.now() - 20 * 60 * 1000).toISOString() }).eq("dedupe_key", key);
    await drain(meta.fetchImpl);
    const { data: event } = await admin.from("webhook_events").select("processed_at, error").eq("dedupe_key", key).single();
    expect(event?.error).toBeNull();
    expect(event?.processed_at).not.toBeNull();
  });

  it("un aviso llega antes de que el envío termine de guardarse: se aplica cuando aparece el id", async () => {
    const conversation = await seedConversation("whatsapp", whatsappAccount, `549${runId}7`, 1);
    const meta = fakeMeta();
    const wamid = `wamid.${runId}.adelantado`;
    // El aviso llega primero.
    await receive(
      JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "1", changes: [{ field: "messages", value: { metadata: { phone_number_id: whatsappAccount }, statuses: [{ id: wamid, status: "delivered", timestamp: "1800000000" }] } }] }] }),
    );
    await drain(meta.fetchImpl);
    // Después se guarda el mensaje con ese id (lo que hace el cierre del envío).
    const { data: queued } = await admin
      .from("messages")
      .insert({ organization_id: organizationId, conversation_id: conversation, direction: "outbound", sender: "agent", type: "text", body: "hola", status: "queued", provider_timestamp: new Date().toISOString() })
      .select("id")
      .single();
    await admin.rpc("finalize_outbound_message", { p_message_id: queued?.id ?? "", p_external_id: wamid, p_provider_timestamp: new Date().toISOString() });
    await admin.from("webhook_events").update({ claimed_at: null }).eq("dedupe_key", `status:${wamid}:delivered`);
    await drain(meta.fetchImpl);
    expect((await messageByExternalId(wamid))?.status).toBe("delivered");
  });
});

describe("envío por cada canal", () => {
  it("Messenger dentro de la ventana: sale por la página con tipo RESPONSE y queda guardado como enviado", async () => {
    const conversation = await seedConversation("messenger", messengerAccount, `p-${runId}-envio`, 2);
    const meta = fakeMeta();
    const sent = await sendTextMessage(admin, { conversationId: conversation, text: "Hola Ana, ya te ayudo", sender: "agent", fetchImpl: meta.fetchImpl });

    expect(meta.calls).toHaveLength(1);
    expect(meta.calls[0]?.url).toBe("https://graph.facebook.com/v23.0/me/messages");
    expect(JSON.parse(String(meta.calls[0]?.init?.body))).toEqual({ recipient: { id: `p-${runId}-envio` }, message: { text: "Hola Ana, ya te ayudo" }, messaging_type: "RESPONSE" });
    const message = await messageByExternalId(sent.externalId);
    expect(message).toMatchObject({ direction: "outbound", status: "sent", body: "Hola Ana, ya te ayudo" });
  });

  it("Instagram usa su propio host y el token de su canal", async () => {
    const conversation = await seedConversation("instagram", instagramAccount, `p-${runId}-igenvio`, 1);
    const meta = fakeMeta();
    await sendTextMessage(admin, { conversationId: conversation, text: "Hola por Instagram", sender: "operator", fetchImpl: meta.fetchImpl });
    expect(meta.calls[0]?.url).toBe("https://graph.instagram.com/v23.0/me/messages");
    expect(meta.calls[0]?.init?.headers).toMatchObject({ authorization: "Bearer TOKEN-INSTAGRAM-DE-PRUEBA" });
  });

  it("WhatsApp manda texto libre dentro de la ventana, a la cuenta del canal", async () => {
    const conversation = await seedConversation("whatsapp", whatsappAccount, `549${runId}5`, 1);
    const meta = fakeMeta();
    await sendTextMessage(admin, { conversationId: conversation, text: "Hola por WhatsApp", sender: "operator", fetchImpl: meta.fetchImpl });
    expect(meta.calls[0]?.url).toBe(`https://graph.facebook.com/v23.0/${whatsappAccount}/messages`);
    expect(JSON.parse(String(meta.calls[0]?.init?.body))).toMatchObject({ messaging_product: "whatsapp", to: `549${runId}5`, type: "text" });
  });

  it("fuera de las 24 h Messenger no deja escribir ni a la IA ni a una persona, y no guarda nada", async () => {
    const conversation = await seedConversation("messenger", messengerAccount, `p-${runId}-vencida`, 72);
    const meta = fakeMeta();
    await expect(sendTextMessage(admin, { conversationId: conversation, text: "fuera de ventana agente", sender: "agent", fetchImpl: meta.fetchImpl })).rejects.toBeInstanceOf(OutsideWindowError);
    await expect(sendTextMessage(admin, { conversationId: conversation, text: "fuera de ventana persona", sender: "operator", fetchImpl: meta.fetchImpl })).rejects.toBeInstanceOf(OutsideWindowError);
    expect(meta.calls).toHaveLength(0);
    const { data } = await admin.from("messages").select("id").eq("conversation_id", conversation).eq("direction", "outbound");
    expect(data ?? []).toHaveLength(0);
  });

  it("con el permiso de agente humano, una persona responde hasta 7 días después; la IA nunca", async () => {
    const { data: channel } = await admin.from("channels").select("config").eq("external_id", messengerAccount).single();
    await admin.from("channels").update({ config: { ...(channel?.config as object), human_agent: true } }).eq("external_id", messengerAccount);

    const conversation = await seedConversation("messenger", messengerAccount, `p-${runId}-humano`, 72);
    const meta = fakeMeta();
    await expect(sendTextMessage(admin, { conversationId: conversation, text: "la IA no puede", sender: "agent", fetchImpl: meta.fetchImpl })).rejects.toBeInstanceOf(OutsideWindowError);
    await expect(sendTextMessage(admin, { conversationId: conversation, text: "el sistema no puede", sender: "system", fetchImpl: meta.fetchImpl })).rejects.toBeInstanceOf(OutsideWindowError);

    await sendTextMessage(admin, { conversationId: conversation, text: "Le respondo yo", sender: "operator", fetchImpl: meta.fetchImpl });
    expect(JSON.parse(String(meta.calls[0]?.init?.body))).toMatchObject({ messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" });

    // A los 8 días ya no.
    const tooOld = await seedConversation("messenger", messengerAccount, `p-${runId}-muyvieja`, 200);
    await expect(sendTextMessage(admin, { conversationId: tooOld, text: "demasiado tarde", sender: "operator", fetchImpl: meta.fetchImpl })).rejects.toBeInstanceOf(OutsideWindowError);
  });

  it("WhatsApp fuera de la ventana sigue pidiendo plantilla aunque el canal tenga la etiqueta", async () => {
    const conversation = await seedConversation("whatsapp", whatsappAccount, `549${runId}6`, 72);
    await expect(sendTextMessage(admin, { conversationId: conversation, text: "texto libre vencido", sender: "operator", fetchImpl: fakeMeta().fetchImpl })).rejects.toBeInstanceOf(OutsideWindowError);
  });
});

describe("bandeja", () => {
  it("se puede filtrar por Instagram y Messenger, y un canal desconocido se ignora", () => {
    expect(inboxQueryFrom({ canal: "instagram" }).channel).toBe("instagram");
    expect(inboxQueryFrom({ canal: "messenger" }).channel).toBe("messenger");
    expect(inboxQueryFrom({ canal: "whatsapp" }).channel).toBe("whatsapp");
    expect(inboxQueryFrom({ canal: "telegram" }).channel).toBe("telegram");
    expect(inboxQueryFrom({ canal: "fax" }).channel).toBeNull();
  });
});
