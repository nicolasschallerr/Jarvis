import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifySignature } from "../src/lib/whatsapp/signature";

const SECRET = "secreto-de-prueba";
const BODY = '{"object":"whatsapp_business_account","entry":[{"id":"1","changes":[]}]}';

function sign(body: string, secret = SECRET): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("firma del webhook de WhatsApp", () => {
  it("acepta una firma válida", () => {
    expect(verifySignature(BODY, sign(BODY), SECRET)).toBe(true);
  });

  it("rechaza si el cuerpo fue modificado", () => {
    expect(verifySignature(`${BODY} `, sign(BODY), SECRET)).toBe(false);
  });

  it("rechaza si se firmó con otro secreto", () => {
    expect(verifySignature(BODY, sign(BODY, "otro-secreto"), SECRET)).toBe(false);
  });

  it("rechaza si falta el encabezado o no tiene el prefijo sha256=", () => {
    expect(verifySignature(BODY, null, SECRET)).toBe(false);
    expect(verifySignature(BODY, sign(BODY).replace("sha256=", ""), SECRET)).toBe(false);
    expect(verifySignature(BODY, "sha1=abc", SECRET)).toBe(false);
  });

  it("rechaza una firma de largo distinto sin fallar", () => {
    expect(verifySignature(BODY, "sha256=abc", SECRET)).toBe(false);
  });

  it("firma bien un cuerpo con acentos y emojis", () => {
    const body = '{"text":"¡Hola! Quiero un préstamo 👍"}';
    expect(verifySignature(body, sign(body), SECRET)).toBe(true);
  });
});
