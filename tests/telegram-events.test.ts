import { describe, expect, it } from "vitest";

import { extractTelegramEvents, mapTelegramType, normalizeTelegramEvent } from "../src/lib/inbound/telegram";

const BOT_ID = "123456789";

function update(message: Record<string, unknown>, updateId = 1000) {
  return {
    update_id: updateId,
    message: {
      message_id: 55,
      from: { id: 777, is_bot: false, first_name: "Ana", last_name: "Prueba", username: "ana_prueba" },
      chat: { id: 777, type: "private" },
      date: 1_700_000_000,
      ...message,
    },
  };
}

describe("extracción de eventos de Telegram", () => {
  it("convierte un mensaje de texto en un evento con clave tg:<update_id>", () => {
    const events = extractTelegramEvents(update({ text: "hola" }, 4242), BOT_ID);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ channelType: "telegram", channelExternalId: BOT_ID, dedupeKey: "tg:4242" });
  });

  it("ignora grupos, canales, bots, mensajes editados y datos incompletos", () => {
    expect(extractTelegramEvents(update({ chat: { id: -100, type: "group" }, text: "x" }), BOT_ID)).toEqual([]);
    expect(extractTelegramEvents(update({ chat: { id: -100, type: "channel" }, text: "x" }), BOT_ID)).toEqual([]);
    expect(
      extractTelegramEvents(update({ from: { id: 1, is_bot: true, first_name: "Bot" }, text: "x" }), BOT_ID),
    ).toEqual([]);
    expect(extractTelegramEvents({ update_id: 1, edited_message: { message_id: 1 } }, BOT_ID)).toEqual([]);
    expect(extractTelegramEvents({ message: { message_id: 1 } }, BOT_ID)).toEqual([]);
    expect(extractTelegramEvents(null, BOT_ID)).toEqual([]);
    expect(extractTelegramEvents("texto", BOT_ID)).toEqual([]);
  });
});

describe("normalización de mensajes de Telegram", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  function normalize(message: Record<string, unknown>) {
    const [event] = extractTelegramEvents(update(message), BOT_ID);
    if (!event) throw new Error("sin evento");
    return normalizeTelegramEvent(event.payload, now);
  }

  it("arma un mensaje de texto común a todos los canales", () => {
    const message = normalize({ text: "quiero un préstamo" });
    expect(message).toMatchObject({
      channelType: "telegram",
      channelExternalId: BOT_ID,
      identifier: "777",
      contactName: "Ana Prueba",
      externalId: "777:55",
      type: "text",
      body: "quiero un préstamo",
      providerTimestamp: "2023-11-14T22:13:20.000Z",
    });
  });

  it("usa el nombre de usuario si no hay nombre y la leyenda como texto de una foto", () => {
    const [event] = extractTelegramEvents(
      update({ from: { id: 777, is_bot: false, username: "solo_usuario" }, photo: [{ file_id: "f" }], caption: "mi DNI" }),
      BOT_ID,
    );
    const message = normalizeTelegramEvent(event?.payload ?? null, now);
    expect(message.contactName).toBe("solo_usuario");
    expect(message.type).toBe("image");
    expect(message.body).toBe("mi DNI");
  });

  it("distingue audio, documento, video, sticker, ubicación y lo desconocido", () => {
    expect(mapTelegramType({ voice: { file_id: "a" } })).toBe("audio");
    expect(mapTelegramType({ audio: { file_id: "a" } })).toBe("audio");
    expect(mapTelegramType({ document: { file_id: "d" } })).toBe("document");
    expect(mapTelegramType({ video: { file_id: "v" } })).toBe("video");
    expect(mapTelegramType({ sticker: { file_id: "s" } })).toBe("sticker");
    expect(mapTelegramType({ location: { latitude: 1, longitude: 2 } })).toBe("location");
    expect(mapTelegramType({ poll: {} })).toBe("unsupported");
  });

  it("usa la hora de respaldo si el mensaje no trae fecha", () => {
    const message = normalize({ text: "hola", date: undefined });
    expect(message.providerTimestamp).toBe(now.toISOString());
  });

  it("falla con un evento mal formado", () => {
    expect(() => normalizeTelegramEvent({ botId: BOT_ID }, now)).toThrow();
    expect(() => normalizeTelegramEvent(null, now)).toThrow();
  });
});
