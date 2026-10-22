import { timingSafeEqual } from "node:crypto";

// Las rutas del trabajador no tienen usuario: las invoca pg_cron o el propio sistema con un
// secreto compartido en el encabezado "Authorization: Bearer <secreto>".
export function isAuthorizedWorkerRequest(
  authorizationHeader: string | null,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret || !authorizationHeader?.startsWith("Bearer ")) {
    return false;
  }

  const received = Buffer.from(authorizationHeader.slice("Bearer ".length));
  const expected = Buffer.from(expectedSecret);

  return received.length === expected.length && timingSafeEqual(received, expected);
}
