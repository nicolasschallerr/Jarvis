import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { extractEvents } from "@/lib/whatsapp/events";
import { storeEvents } from "@/lib/inbound/store";
import { verifySignature } from "@/lib/whatsapp/signature";
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

// Recepción de eventos. Orden: validar la firma, guardar (idempotente) y responder 200 rápido.
// El procesamiento pesado (IA, transcripción, envíos) lo hace el trabajador, no esta ruta.
export async function POST(request: NextRequest) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) {
    return new Response("Server misconfigured", { status: 500 });
  }

  // La firma se calcula sobre el texto crudo: se lee una sola vez, antes de interpretarlo.
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  try {
    const events = extractEvents(body).map((event) => ({
      channelType: "whatsapp" as const,
      channelExternalId: event.phoneNumberId,
      dedupeKey: event.dedupeKey,
      payload: event.payload,
    }));
    await storeEvents(createAdminClient(), events);
  } catch (error) {
    // Se registra solo el motivo, nunca el cuerpo: contiene datos personales.
    console.error("whatsapp webhook: no se pudo guardar", error instanceof Error ? error.message : error);
    // 500 hace que Meta reintente más tarde, que es lo que queremos si la base falló.
    return new Response("Error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
