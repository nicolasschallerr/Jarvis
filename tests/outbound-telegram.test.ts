import { describe, expect, it } from "vitest";

import { ChannelSendError } from "../src/lib/outbound/errors";
import { canSendFreeText } from "../src/lib/outbound/rules";
import { sendTelegramText, TELEGRAM_MAX_TEXT } from "../src/lib/outbound/telegram";

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl = async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
    return new Response(JSON.stringify(body), { status });
  };
  return { impl, calls };
}

describe("envío de texto por Telegram", () => {
  it("manda el texto y devuelve el id con formato <chat>:<mensaje>", async () => {
    const { impl, calls } = fakeFetch(200, { ok: true, result: { message_id: 77, date: 1_800_000_000 } });
    const sent = await sendTelegramText({ token: "123:abc", chatId: "555", text: "hola", fetchImpl: impl });

    expect(sent).toEqual({ externalId: "555:77", providerTimestamp: "2027-01-15T08:00:00.000Z" });
    expect(calls[0]?.url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(calls[0]?.body).toEqual({ chat_id: "555", text: "hola" });
  });

  it("marca como NO reintentable un chat bloqueado o inexistente", async () => {
    const { impl } = fakeFetch(403, { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" });
    await expect(sendTelegramText({ token: "t", chatId: "1", text: "hola", fetchImpl: impl })).rejects.toMatchObject({
      name: "ChannelSendError",
      code: 403,
      retryable: false,
    });
  });

  it("marca como reintentable el límite de velocidad y trae cuánto esperar", async () => {
    const { impl } = fakeFetch(429, { ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 7 } });
    await expect(sendTelegramText({ token: "t", chatId: "1", text: "hola", fetchImpl: impl })).rejects.toMatchObject({
      code: 429,
      retryable: true,
      retryAfterSeconds: 7,
    });
  });

  it("marca como reintentable una falla de red, sin filtrar el token", async () => {
    const impl = async () => {
      throw new Error("fallo con https://api.telegram.org/botSECRETO/sendMessage");
    };
    const error = await sendTelegramText({ token: "SECRETO", chatId: "1", text: "hola", fetchImpl: impl }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChannelSendError);
    expect((error as ChannelSendError).retryable).toBe(true);
    expect((error as ChannelSendError).message).not.toContain("SECRETO");
  });

  it("rechaza un texto vacío o demasiado largo antes de llamar a Telegram", async () => {
    const { impl, calls } = fakeFetch(200, { ok: true, result: { message_id: 1, date: 1 } });
    await expect(sendTelegramText({ token: "t", chatId: "1", text: "", fetchImpl: impl })).rejects.toMatchObject({ code: "empty" });
    await expect(
      sendTelegramText({ token: "t", chatId: "1", text: "x".repeat(TELEGRAM_MAX_TEXT + 1), fetchImpl: impl }),
    ).rejects.toMatchObject({ code: "too-long" });
    expect(calls).toHaveLength(0);
  });

  it("tolera una respuesta que no es JSON", async () => {
    const impl = async () => new Response("<html>Bad Gateway</html>", { status: 502 });
    await expect(sendTelegramText({ token: "t", chatId: "1", text: "hola", fetchImpl: impl })).rejects.toMatchObject({
      code: 502,
      retryable: true,
    });
  });
});

describe("regla de texto libre por canal", () => {
  const now = new Date("2026-10-23T12:00:00.000Z");
  const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3600 * 1000);

  it("Telegram siempre permite texto libre", () => {
    expect(canSendFreeText("telegram", null, now)).toBe(true);
    expect(canSendFreeText("telegram", hoursAgo(500), now)).toBe(true);
  });

  it("WhatsApp lo permite solo dentro de las 24 h desde el último mensaje del contacto", () => {
    expect(canSendFreeText("whatsapp", hoursAgo(1), now)).toBe(true);
    expect(canSendFreeText("whatsapp", hoursAgo(23.9), now)).toBe(true);
    expect(canSendFreeText("whatsapp", hoursAgo(24), now)).toBe(false);
    expect(canSendFreeText("whatsapp", hoursAgo(48), now)).toBe(false);
  });

  it("WhatsApp no permite texto libre si el contacto nunca escribió", () => {
    expect(canSendFreeText("whatsapp", null, now)).toBe(false);
  });
});
