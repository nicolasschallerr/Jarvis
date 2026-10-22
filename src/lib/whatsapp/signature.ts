import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256=";

// Meta firma cada POST con HMAC-SHA256 del cuerpo, usando el secreto de la app, y manda el
// resultado en hexadecimal en el encabezado X-Hub-Signature-256 como "sha256=<hash>".
// Hay que calcularlo sobre el cuerpo EXACTO que llegó (texto crudo), no sobre un objeto
// reserializado: cualquier diferencia de espacios o escapes cambia el hash.
export function verifySignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): boolean {
  if (!signatureHeader || !signatureHeader.startsWith(PREFIX)) {
    return false;
  }

  const received = signatureHeader.slice(PREFIX.length).toLowerCase();
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");

  const receivedBuffer = Buffer.from(received);
  const expectedBuffer = Buffer.from(expected);

  return (
    receivedBuffer.length === expectedBuffer.length &&
    timingSafeEqual(receivedBuffer, expectedBuffer)
  );
}
