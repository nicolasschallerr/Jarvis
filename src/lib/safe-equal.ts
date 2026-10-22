import { timingSafeEqual } from "node:crypto";

// Compara dos textos en tiempo constante, para no filtrar un secreto por diferencias de tiempo.
export function safeEqual(received: string | null, expected: string | undefined): boolean {
  if (!received || !expected) {
    return false;
  }

  const left = Buffer.from(received);
  const right = Buffer.from(expected);

  return left.length === right.length && timingSafeEqual(left, right);
}
