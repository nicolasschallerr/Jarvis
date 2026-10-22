import { timingSafeEqual } from "node:crypto";

export type VerificationResult =
  | { ok: true; challenge: string }
  | { ok: false; reason: "missing-config" | "invalid-request" | "token-mismatch" };

// Comparación de tiempo constante para no filtrar el token por diferencias de tiempo.
function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// Meta verifica el webhook con un GET que trae hub.mode, hub.verify_token y hub.challenge.
// Hay que devolver el challenge tal cual si el token coincide con el que configuramos.
export function verifyWebhookRequest(
  params: URLSearchParams,
  expectedToken: string | undefined,
): VerificationResult {
  if (!expectedToken) {
    return { ok: false, reason: "missing-config" };
  }

  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode !== "subscribe" || !token || !challenge) {
    return { ok: false, reason: "invalid-request" };
  }

  if (!safeEqual(token, expectedToken)) {
    return { ok: false, reason: "token-mismatch" };
  }

  return { ok: true, challenge };
}
