import type { NextRequest } from "next/server";

import { verifyWebhookRequest } from "@/lib/whatsapp/verify";

// Verificación del webhook: Meta llama a este GET cuando se configura la URL en el panel.
// Esta ruta queda fuera del proxy de sesión (ver src/proxy.ts): Meta no tiene usuario.
export async function GET(request: NextRequest) {
  const result = verifyWebhookRequest(
    request.nextUrl.searchParams,
    process.env.META_WEBHOOK_VERIFY_TOKEN,
  );

  if (!result.ok) {
    // Nunca se devuelve el motivo exacto: no se le dice a un tercero qué falló.
    const status = result.reason === "missing-config" ? 500 : 403;
    return new Response("Forbidden", { status });
  }

  return new Response(result.challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}
