import type { NextRequest } from "next/server";

import { storeEvents } from "@/lib/inbound/store";
import type { InboundEvent } from "@/lib/inbound/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { extractEvents } from "@/lib/whatsapp/events";
import { verifySignature } from "@/lib/whatsapp/signature";
import { verifyWebhookRequest } from "@/lib/whatsapp/verify";

import { extractMessagingEvents } from "./events";

// Un solo webhook para los tres canales de Meta. En el panel de Meta cada producto (WhatsApp, Messenger, Instagram)
// tiene su propia dirección de devolución de llamada, pero todas pueden apuntar acá: el cuerpo dice de cuál se trata
// ("whatsapp_business_account", "page" o "instagram"). Esta ruta queda fuera del proxy de sesión (ver src/proxy.ts):
// Meta no tiene usuario.

// Verificación del webhook: Meta llama a este GET cuando se configura la dirección en el panel.
export function verifyMetaWebhook(request: NextRequest): Response {
  const result = verifyWebhookRequest(request.nextUrl.searchParams, process.env.META_WEBHOOK_VERIFY_TOKEN);

  if (!result.ok) {
    // Nunca se devuelve el motivo exacto: no se le dice a un tercero qué falló.
    return new Response("Forbidden", { status: result.reason === "missing-config" ? 500 : 403 });
  }

  return new Response(result.challenge, { status: 200, headers: { "Content-Type": "text/plain" } });
}

// Los secretos con los que Meta puede firmar. Instagram con "inicio de sesión de Instagram" tiene su propio secreto de
// aplicación, distinto del de la aplicación de Meta: se aceptan los dos y la firma tiene que coincidir con alguno.
function appSecrets(): string[] {
  return [process.env.META_APP_SECRET, process.env.INSTAGRAM_APP_SECRET].filter((secret): secret is string => Boolean(secret));
}

// Recepción de eventos. Orden: validar la firma, guardar (idempotente) y responder 200 rápido.
// El procesamiento pesado (IA, transcripción, envíos) lo hace el trabajador, no esta ruta.
export async function receiveMetaWebhook(request: NextRequest): Promise<Response> {
  const secrets = appSecrets();
  if (secrets.length === 0) return new Response("Server misconfigured", { status: 500 });

  // La firma se calcula sobre el texto crudo: se lee una sola vez, antes de interpretarlo.
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!secrets.some((secret) => verifySignature(rawBody, signature, secret))) {
    return new Response("Invalid signature", { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  try {
    const events: InboundEvent[] = [
      ...extractEvents(body).map((event) => ({
        channelType: "whatsapp" as const,
        channelExternalId: event.phoneNumberId,
        dedupeKey: event.dedupeKey,
        payload: event.payload,
      })),
      ...extractMessagingEvents(body),
    ];
    await storeEvents(createAdminClient(), events);
  } catch (error) {
    // Se registra solo el motivo, nunca el cuerpo: contiene datos personales.
    console.error("meta webhook: no se pudo guardar", error instanceof Error ? error.message : error);
    // 500 hace que Meta reintente más tarde, que es lo que queremos si la base falló.
    return new Response("Error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
