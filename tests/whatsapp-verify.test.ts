import { describe, expect, it } from "vitest";

import { verifyWebhookRequest } from "../src/lib/whatsapp/verify";

const TOKEN = "token-de-prueba-123";

function params(values: Record<string, string>): URLSearchParams {
  return new URLSearchParams(values);
}

describe("verificación del webhook de WhatsApp", () => {
  it("devuelve el challenge cuando el token coincide", () => {
    const result = verifyWebhookRequest(
      params({ "hub.mode": "subscribe", "hub.verify_token": TOKEN, "hub.challenge": "1158201444" }),
      TOKEN,
    );
    expect(result).toEqual({ ok: true, challenge: "1158201444" });
  });

  it("rechaza un token incorrecto", () => {
    const result = verifyWebhookRequest(
      params({ "hub.mode": "subscribe", "hub.verify_token": "otro", "hub.challenge": "1" }),
      TOKEN,
    );
    expect(result).toEqual({ ok: false, reason: "token-mismatch" });
  });

  it("rechaza si el modo no es subscribe", () => {
    const result = verifyWebhookRequest(
      params({ "hub.mode": "unsubscribe", "hub.verify_token": TOKEN, "hub.challenge": "1" }),
      TOKEN,
    );
    expect(result).toEqual({ ok: false, reason: "invalid-request" });
  });

  it("rechaza si falta el challenge o el token", () => {
    expect(
      verifyWebhookRequest(params({ "hub.mode": "subscribe", "hub.verify_token": TOKEN }), TOKEN),
    ).toEqual({ ok: false, reason: "invalid-request" });
    expect(
      verifyWebhookRequest(params({ "hub.mode": "subscribe", "hub.challenge": "1" }), TOKEN),
    ).toEqual({ ok: false, reason: "invalid-request" });
  });

  it("falla de forma segura si el servidor no tiene token configurado", () => {
    const result = verifyWebhookRequest(
      params({ "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1" }),
      undefined,
    );
    expect(result).toEqual({ ok: false, reason: "missing-config" });
  });
});
