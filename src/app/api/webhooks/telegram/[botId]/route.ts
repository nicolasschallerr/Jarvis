import type { NextRequest } from "next/server";

import { extractTelegramEvents } from "@/lib/inbound/telegram";
import { storeEvents } from "@/lib/inbound/store";
import { safeEqual } from "@/lib/safe-equal";
import { createAdminClient } from "@/lib/supabase/admin";

// Webhook de Telegram. La URL lleva el id del bot (/api/webhooks/telegram/<id del bot>) porque
// Telegram no lo incluye en cada pedido, y es lo que permite saber a qué organización pertenece.
// Queda fuera del proxy de sesión: Telegram no tiene usuario; se valida con el secreto que se
// configuró en setWebhook y que Telegram devuelve en X-Telegram-Bot-Api-Secret-Token.
export async function POST(request: NextRequest, context: { params: Promise<{ botId: string }> }) {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    return new Response("Server misconfigured", { status: 500 });
  }

  if (!safeEqual(request.headers.get("x-telegram-bot-api-secret-token"), secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: unknown;
  try {
    update = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { botId } = await context.params;

  try {
    await storeEvents(createAdminClient(), extractTelegramEvents(update, botId));
  } catch (error) {
    // Se registra solo el motivo, nunca el cuerpo: contiene datos personales.
    console.error("telegram webhook: no se pudo guardar", error instanceof Error ? error.message : error);
    // Un 500 hace que Telegram reintente, que es lo que queremos si la base falló.
    return new Response("Error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
