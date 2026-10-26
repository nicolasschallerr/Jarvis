import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { Json } from "../src/lib/supabase/database.types";

import { buildSystemPrompt } from "../src/lib/agent/context";
import { buildAttentionSettings } from "../src/lib/client-config/attention";
import { parseClientConfig } from "../src/lib/client-config/load";
import { isMetaFileUrl } from "../src/lib/inbound/media";
import { normalizeMessagingEvent } from "../src/lib/inbound/messaging";
import { extractWhatsAppMedia } from "../src/lib/inbound/whatsapp";
import { extractMessagingEvents } from "../src/lib/meta/events";
import { ChannelSendError } from "../src/lib/outbound/errors";
import { formatForChannel } from "../src/lib/outbound/format";
import { fetchProfileName, instagramApiFrom, MESSAGE_LIMITS, sendMessagingText, sendWhatsAppText, splitText } from "../src/lib/outbound/meta-messaging";
import { canSendFreeText, sendMode } from "../src/lib/outbound/rules";

// Messenger, Instagram y WhatsApp: recepción, normalización y envío con un Meta falso (no se llama a nadie).

const NOW = new Date("2026-10-26T15:00:00.000Z");
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * 3600 * 1000);

function envelope(object: "page" | "instagram", messaging: unknown[]) {
  return { object, entry: [{ id: "ACCOUNT_1", time: 1761490800000, messaging }] };
}

function textEvent(mid: string, text = "hola") {
  return { sender: { id: "PERSONA_1" }, recipient: { id: "CUENTA_1" }, timestamp: 1761490800000, message: { mid, text } };
}

describe("recepción de Messenger e Instagram", () => {
  it("separa los mensajes de cada canal con su clave de deduplicación", () => {
    const messenger = extractMessagingEvents(envelope("page", [textEvent("m_1")]));
    expect(messenger).toHaveLength(1);
    expect(messenger[0]).toMatchObject({ channelType: "messenger", channelExternalId: "CUENTA_1", dedupeKey: "fb:m_1" });

    const instagram = extractMessagingEvents(envelope("instagram", [textEvent("ig_1")]));
    expect(instagram[0]).toMatchObject({ channelType: "instagram", channelExternalId: "CUENTA_1", dedupeKey: "ig:ig_1" });
  });

  it("ignora ecos, lecturas, entregas y datos incompletos en vez de romper", () => {
    const events = extractMessagingEvents(
      envelope("page", [
        { ...textEvent("m_echo"), message: { mid: "m_echo", text: "lo mandó la página", is_echo: true } },
        { sender: { id: "P" }, recipient: { id: "C" }, read: { watermark: 1 } },
        { sender: { id: "P" }, recipient: { id: "C" }, delivery: { mids: ["m_x"] } },
        { sender: { id: "P" }, recipient: { id: "C" }, message: { text: "sin mid" } },
        { recipient: { id: "C" }, message: { mid: "m_2", text: "sin remitente" } },
        "basura",
        textEvent("m_ok"),
      ]),
    );
    expect(events.map((event) => event.dedupeKey)).toEqual(["fb:m_ok"]);
  });

  it("no toma sobres de otros productos ni formas inesperadas", () => {
    expect(extractMessagingEvents({ object: "whatsapp_business_account", entry: [] })).toEqual([]);
    expect(extractMessagingEvents({ object: "page" })).toEqual([]);
    expect(extractMessagingEvents(null)).toEqual([]);
    expect(extractMessagingEvents("texto")).toEqual([]);
  });
});

describe("mensaje normalizado de Messenger e Instagram", () => {
  const payload = (message: Record<string, unknown>) => ({ sender: { id: "PERSONA_1" }, recipient: { id: "CUENTA_1" }, timestamp: 1761490800000, message }) as Json;

  it("un texto: la persona es el remitente y la cuenta es el canal; la hora viene en milisegundos", () => {
    const normalized = normalizeMessagingEvent("messenger", payload({ mid: "m_1", text: "Hola, quiero asociarme" }), NOW);
    expect(normalized).toMatchObject({
      channelType: "messenger",
      channelExternalId: "CUENTA_1",
      identifier: "PERSONA_1",
      externalId: "m_1",
      type: "text",
      body: "Hola, quiero asociarme",
      media: null,
      providerTimestamp: "2025-10-26T15:00:00.000Z",
    });
  });

  it("un adjunto trae su dirección de descarga y se mapea al tipo común", () => {
    const image = normalizeMessagingEvent("instagram", payload({ mid: "ig_1", attachments: [{ type: "image", payload: { url: "https://scontent.cdninstagram.com/foto.jpg" } }] }), NOW);
    expect(image.type).toBe("image");
    expect(image.body).toBeNull();
    expect(image.media).toMatchObject({ url: "https://scontent.cdninstagram.com/foto.jpg", mimeType: "image/jpeg" });

    expect(normalizeMessagingEvent("messenger", payload({ mid: "m_a", attachments: [{ type: "audio", payload: { url: "https://cdn.fbsbx.com/a.mp4" } }] }), NOW).type).toBe("audio");
    expect(normalizeMessagingEvent("messenger", payload({ mid: "m_f", attachments: [{ type: "file", payload: { url: "https://cdn.fbsbx.com/a.pdf" } }] }), NOW).type).toBe("document");
  });

  it("lo que no se entiende queda como no compatible, sin perder el mensaje", () => {
    const share = normalizeMessagingEvent("instagram", payload({ mid: "ig_2", attachments: [{ type: "share", payload: { url: "https://instagram.com/p/x" } }] }), NOW);
    expect(share).toMatchObject({ type: "unsupported", media: null });
    expect(normalizeMessagingEvent("instagram", payload({ mid: "ig_3" }), NOW).type).toBe("unsupported");
  });

  it("si trae texto y adjunto, manda el texto", () => {
    const both = normalizeMessagingEvent("messenger", payload({ mid: "m_b", text: "mirá", attachments: [{ type: "image", payload: { url: "https://x.fbcdn.net/a.jpg" } }] }), NOW);
    expect(both.type).toBe("text");
  });

  it("rechaza un evento sin lo esencial", () => {
    expect(() => normalizeMessagingEvent("messenger", { sender: { id: "P" }, message: { mid: "m" } }, NOW)).toThrow();
    expect(() => normalizeMessagingEvent("messenger", payload({ text: "sin mid" }), NOW)).toThrow();
  });
});

describe("adjuntos de Meta", () => {
  it("WhatsApp manda el id del archivo, no su dirección", () => {
    expect(extractWhatsAppMedia({ type: "image", image: { id: "MEDIA_1", mime_type: "image/jpeg" } })).toEqual({
      providerMediaId: "MEDIA_1",
      mimeType: "image/jpeg",
      fileName: null,
      sizeBytes: null,
    });
    expect(extractWhatsAppMedia({ type: "document", document: { id: "MEDIA_2", filename: "dni.pdf", mime_type: "application/pdf" } })?.fileName).toBe("dni.pdf");
    expect(extractWhatsAppMedia({ type: "text", text: { body: "hola" } })).toBeNull();
    expect(extractWhatsAppMedia({ type: "image", image: {} })).toBeNull();
  });

  it("solo se descarga de los servidores de archivos de Meta, por https", () => {
    expect(isMetaFileUrl("https://scontent-eze1-1.xx.fbcdn.net/v/foto.jpg")).toBe(true);
    expect(isMetaFileUrl("https://lookaside.fbsbx.com/whatsapp_business/attachments/?mid=1")).toBe(true);
    expect(isMetaFileUrl("https://scontent.cdninstagram.com/a.jpg")).toBe(true);
    expect(isMetaFileUrl("http://scontent.fbcdn.net/a.jpg")).toBe(false);
    expect(isMetaFileUrl("https://evil.example.com/fbcdn.net")).toBe(false);
    expect(isMetaFileUrl("https://fbcdn.net.evil.com/a.jpg")).toBe(false);
    expect(isMetaFileUrl("https://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isMetaFileUrl("no es una dirección")).toBe(false);
  });
});

describe("ventana de atención", () => {
  it("WhatsApp, Messenger e Instagram dejan texto libre solo dentro de las 24 h", () => {
    for (const channel of ["whatsapp", "messenger", "instagram"] as const) {
      expect(canSendFreeText(channel, hoursAgo(1), NOW)).toBe(true);
      expect(canSendFreeText(channel, hoursAgo(23.9), NOW)).toBe(true);
      expect(canSendFreeText(channel, hoursAgo(24.1), NOW)).toBe(false);
      expect(canSendFreeText(channel, null, NOW)).toBe(false);
    }
  });

  it("Telegram y el correo no tienen ventana", () => {
    expect(canSendFreeText("telegram", hoursAgo(500), NOW)).toBe(true);
    expect(canSendFreeText("telegram", null, NOW)).toBe(true);
    expect(canSendFreeText("email", null, NOW)).toBe(true);
  });

  it("agente humano: solo Messenger e Instagram, entre 24 h y 7 días y con el permiso habilitado", () => {
    expect(sendMode("messenger", hoursAgo(48), NOW, { humanAgentTag: true })).toBe("human_agent");
    expect(sendMode("instagram", hoursAgo(167), NOW, { humanAgentTag: true })).toBe("human_agent");
    expect(sendMode("instagram", hoursAgo(169), NOW, { humanAgentTag: true })).toBe("closed");
    expect(sendMode("messenger", hoursAgo(48), NOW)).toBe("closed");
    expect(sendMode("messenger", hoursAgo(48), NOW, { humanAgentTag: false })).toBe("closed");
    // WhatsApp no tiene etiqueta equivalente: fuera de las 24 h solo plantillas.
    expect(sendMode("whatsapp", hoursAgo(48), NOW, { humanAgentTag: true })).toBe("closed");
    expect(sendMode("messenger", hoursAgo(2), NOW, { humanAgentTag: true })).toBe("free");
  });
});

describe("partir textos largos", () => {
  it("un texto corto sale entero y uno vacío no sale", () => {
    expect(splitText("Hola", MESSAGE_LIMITS.messenger)).toEqual(["Hola"]);
    expect(splitText("   ", MESSAGE_LIMITS.messenger)).toEqual([]);
  });

  it("corta en el párrafo y cada parte respeta el límite de caracteres", () => {
    const paragraph = "a".repeat(1500);
    const parts = splitText(`${paragraph}\n\n${paragraph}`, MESSAGE_LIMITS.messenger);
    expect(parts).toEqual([paragraph, paragraph]);
  });

  it("Instagram cuenta bytes: con acentos y emojis cada parte entra en 1000 bytes y no se pierde texto", () => {
    const sentence = "Está en Santa Fe, 😀 ñandú. ";
    const text = sentence.repeat(120).trim();
    const parts = splitText(text, MESSAGE_LIMITS.instagram);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(Buffer.byteLength(part, "utf8")).toBeLessThanOrEqual(1000);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(text.replace(/\s+/g, " "));
    // Ningún emoji quedó cortado a la mitad.
    for (const part of parts) expect(part).not.toMatch(/[\uD800-\uDBFF]$/);
  });

  it("sin espacios ni puntos corta en seco pero respeta el límite", () => {
    const parts = splitText("x".repeat(2500), MESSAGE_LIMITS.messenger);
    expect(parts.map((part) => part.length)).toEqual([2000, 500]);
  });
});

type Call = { url: string; init: RequestInit };

function fakeMeta(respond: (call: Call, index: number) => Response) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    return respond(call, calls.length - 1);
  };
  return { calls, fetchImpl };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const bodyOf = (call: Call | undefined) => JSON.parse(String(call?.init.body)) as Record<string, unknown>;

describe("envío por Messenger e Instagram", () => {
  it("Messenger: POST a la página con el token en el encabezado y tipo RESPONSE", async () => {
    const meta = fakeMeta(() => json({ recipient_id: "PERSONA_1", message_id: "m_out_1" }));
    const sent = await sendMessagingText({ channel: "messenger", token: "TOKEN-SECRETO", recipientId: "PERSONA_1", text: "Hola Ana", fetchImpl: meta.fetchImpl, now: NOW });

    expect(sent).toEqual({ externalId: "m_out_1", providerTimestamp: NOW.toISOString() });
    expect(meta.calls[0]?.url).toBe("https://graph.facebook.com/v23.0/me/messages");
    expect(meta.calls[0]?.init.headers).toMatchObject({ authorization: "Bearer TOKEN-SECRETO" });
    expect(bodyOf(meta.calls[0])).toEqual({ recipient: { id: "PERSONA_1" }, message: { text: "Hola Ana" }, messaging_type: "RESPONSE" });
    // El token no viaja en la dirección.
    expect(meta.calls[0]?.url).not.toContain("TOKEN-SECRETO");
  });

  it("Instagram con inicio de sesión de Instagram usa graph.instagram.com; con Facebook, graph.facebook.com", async () => {
    const meta = fakeMeta(() => json({ recipient_id: "P", message_id: "ig_out" }));
    await sendMessagingText({ channel: "instagram", token: "t", recipientId: "P", text: "Hola", fetchImpl: meta.fetchImpl });
    await sendMessagingText({ channel: "instagram", token: "t", recipientId: "P", text: "Hola", api: "facebook_login", fetchImpl: meta.fetchImpl });
    expect(meta.calls.map((call) => call.url)).toEqual(["https://graph.instagram.com/v23.0/me/messages", "https://graph.facebook.com/v23.0/me/messages"]);
    expect(instagramApiFrom({ api: "facebook_login" })).toBe("facebook_login");
    expect(instagramApiFrom({})).toBe("instagram_login");
    expect(instagramApiFrom(null)).toBe("instagram_login");
  });

  it("respuesta manual de una persona fuera de las 24 h: etiqueta de agente humano", async () => {
    const meta = fakeMeta(() => json({ recipient_id: "P", message_id: "m_h" }));
    await sendMessagingText({ channel: "messenger", token: "t", recipientId: "P", text: "Le respondo yo", humanAgent: true, fetchImpl: meta.fetchImpl });
    expect(bodyOf(meta.calls[0])).toMatchObject({ messaging_type: "MESSAGE_TAG", tag: "HUMAN_AGENT" });
  });

  it("un texto largo sale en varios mensajes, en orden, y devuelve el id del último", async () => {
    const meta = fakeMeta((_, index) => json({ recipient_id: "P", message_id: `m_${index}` }));
    const text = `${"a".repeat(1500)}\n\n${"b".repeat(1500)}`;
    const sent = await sendMessagingText({ channel: "messenger", token: "t", recipientId: "P", text, fetchImpl: meta.fetchImpl });
    expect(meta.calls).toHaveLength(2);
    expect((bodyOf(meta.calls[0]).message as { text: string }).text.startsWith("a")).toBe(true);
    expect((bodyOf(meta.calls[1]).message as { text: string }).text.startsWith("b")).toBe(true);
    expect(sent.externalId).toBe("m_1");
  });

  it("si Meta rechaza: error definitivo con el motivo, sin el token; los límites de velocidad sí se reintentan", async () => {
    const outside = fakeMeta(() => json({ error: { message: "This message is sent outside of allowed window.", code: 10, error_subcode: 2018278 } }, 400));
    const rejected = await sendMessagingText({ channel: "messenger", token: "TOKEN-SECRETO", recipientId: "P", text: "x", fetchImpl: outside.fetchImpl }).catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(ChannelSendError);
    expect(rejected).toMatchObject({ code: 10, retryable: false });
    expect(String((rejected as Error).message)).not.toContain("TOKEN-SECRETO");

    const throttled = fakeMeta(() => json({ error: { message: "Application request limit reached", code: 4 } }, 400));
    await expect(sendMessagingText({ channel: "instagram", token: "t", recipientId: "P", text: "x", fetchImpl: throttled.fetchImpl })).rejects.toMatchObject({ retryable: true });

    const down = fakeMeta(() => new Response("", { status: 503 }));
    await expect(sendMessagingText({ channel: "messenger", token: "t", recipientId: "P", text: "x", fetchImpl: down.fetchImpl })).rejects.toMatchObject({ retryable: true });
  });

  it("sin id en la respuesta o sin red falla con un error claro", async () => {
    const noId = fakeMeta(() => json({ recipient_id: "P" }));
    await expect(sendMessagingText({ channel: "messenger", token: "t", recipientId: "P", text: "x", fetchImpl: noId.fetchImpl })).rejects.toMatchObject({ code: "sin-id", retryable: false });

    const offline = async () => {
      throw new Error("ECONNRESET");
    };
    await expect(sendMessagingText({ channel: "messenger", token: "t", recipientId: "P", text: "x", fetchImpl: offline })).rejects.toMatchObject({ code: "network", retryable: true });
  });
});

describe("envío de texto por WhatsApp", () => {
  it("manda un mensaje de texto al número con la forma de la Cloud API", async () => {
    const meta = fakeMeta(() => json({ messages: [{ id: "wamid.OUT1" }] }));
    const sent = await sendWhatsAppText({ token: "TOKEN-SECRETO", phoneNumberId: "PHONE_1", to: "5493420000001", text: "Hola Ana", fetchImpl: meta.fetchImpl, now: NOW });
    expect(sent.externalId).toBe("wamid.OUT1");
    expect(meta.calls[0]?.url).toBe("https://graph.facebook.com/v23.0/PHONE_1/messages");
    expect(meta.calls[0]?.init.headers).toMatchObject({ authorization: "Bearer TOKEN-SECRETO" });
    expect(bodyOf(meta.calls[0])).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "5493420000001",
      type: "text",
      text: { body: "Hola Ana", preview_url: false },
    });
  });

  it("parte los textos de más de 4096 caracteres", async () => {
    const meta = fakeMeta((_, index) => json({ messages: [{ id: `wamid.${index}` }] }));
    const sent = await sendWhatsAppText({ token: "t", phoneNumberId: "P", to: "1", text: `${"a".repeat(3000)}\n\n${"b".repeat(3000)}`, fetchImpl: meta.fetchImpl });
    expect(meta.calls).toHaveLength(2);
    expect(sent.externalId).toBe("wamid.1");
  });
});

describe("nombre de la persona", () => {
  it("lo pide a la API con el token en el encabezado", async () => {
    const meta = fakeMeta(() => json({ name: "  Ana Prueba  ", id: "PERSONA_1" }));
    expect(await fetchProfileName({ channel: "messenger", token: "TOKEN-SECRETO", personId: "PERSONA_1", fetchImpl: meta.fetchImpl })).toBe("Ana Prueba");
    expect(meta.calls[0]?.url).toBe("https://graph.facebook.com/v23.0/PERSONA_1?fields=name");
    expect(meta.calls[0]?.url).not.toContain("TOKEN-SECRETO");
  });

  it("en Instagram usa el usuario si no hay nombre", async () => {
    const meta = fakeMeta(() => json({ username: "ana.prueba" }));
    expect(await fetchProfileName({ channel: "instagram", token: "t", personId: "P", fetchImpl: meta.fetchImpl })).toBe("ana.prueba");
    expect(meta.calls[0]?.url).toBe("https://graph.instagram.com/v23.0/P?fields=name,username");
  });

  it("si falla, no rompe: devuelve null", async () => {
    expect(await fetchProfileName({ channel: "messenger", token: "t", personId: "P", fetchImpl: fakeMeta(() => json({ error: { code: 190 } }, 400)).fetchImpl })).toBeNull();
    expect(
      await fetchProfileName({
        channel: "messenger",
        token: "t",
        personId: "P",
        fetchImpl: async () => {
          throw new Error("sin red");
        },
      }),
    ).toBeNull();
  });
});

describe("formato del texto del agente según el canal", () => {
  const markdown = "## Hotel\n**Baviera** entra 450 personas en cóctel.\n\n\n\nUsá `consultar` si querés.";

  it("WhatsApp usa un asterisco para la negrita; el resto no tiene formato", () => {
    expect(formatForChannel(markdown, "whatsapp")).toBe("Hotel\n*Baviera* entra 450 personas en cóctel.\n\nUsá consultar si querés.");
    for (const channel of ["instagram", "messenger", "telegram"] as const) {
      expect(formatForChannel(markdown, channel)).toBe("Hotel\nBaviera entra 450 personas en cóctel.\n\nUsá consultar si querés.");
    }
  });

  it("no toca un texto sin Markdown ni un asterisco suelto", () => {
    expect(formatForChannel("Hola, ¿cómo estás? 2 * 3 = 6", "instagram")).toBe("Hola, ¿cómo estás? 2 * 3 = 6");
  });
});

describe("el agente sabe por qué canal escribe la persona", () => {
  const parsed = parseClientConfig(readFileSync("clientes/_plantilla/sectores-y-reglas.yaml", "utf8"));
  if (!parsed.ok) throw new Error(parsed.errors.join("; "));
  const settings = buildAttentionSettings(parsed.config, {});

  it("en Instagram y Messenger avisa que no tiene el teléfono y que no hay formato", () => {
    const instagram = buildSystemPrompt("Sos el asistente.", settings, NOW, "instagram");
    expect(instagram).toContain("Instagram");
    expect(instagram).toContain("No tenés su teléfono");
    expect(buildSystemPrompt("x", settings, NOW, "messenger")).toContain("Facebook Messenger");
  });

  it("en WhatsApp no agrega nota de canal", () => {
    expect(buildSystemPrompt("x", settings, NOW, "whatsapp")).not.toContain("## Canal");
    expect(buildSystemPrompt("x", settings, NOW)).not.toContain("## Canal");
  });
});
