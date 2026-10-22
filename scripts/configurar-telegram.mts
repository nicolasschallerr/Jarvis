import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types";

// Conecta un bot de Telegram con Jarvis: registra el canal en la organización y le dice a
// Telegram a qué URL mandar los mensajes (setWebhook).
//
// Uso (desde la carpeta jarvis), con TELEGRAM_BOT_TOKEN y TELEGRAM_WEBHOOK_SECRET en .env.local:
//   npx tsx --env-file=.env.local scripts/configurar-telegram.mts --org-slug mi-cliente
//
// Opcional: --base-url (por defecto https://jarvis-mu-inky.vercel.app) y --name (nombre del canal).
// Es idempotente: se puede correr de nuevo sin duplicar nada. Nunca imprime el token.

const { values } = parseArgs({
  options: {
    "org-slug": { type: "string" },
    "base-url": { type: "string", default: "https://jarvis-mu-inky.vercel.app" },
    name: { type: "string" },
  },
});

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const orgSlug = values["org-slug"];
const baseUrl = (values["base-url"] ?? "").replace(/\/+$/, "");

const botToken = process.env.TELEGRAM_BOT_TOKEN;
const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!orgSlug) fail("Falta --org-slug.");
if (!botToken) fail("Falta TELEGRAM_BOT_TOKEN en .env.local (el token que da @BotFather).");
if (!webhookSecret) fail("Falta TELEGRAM_WEBHOOK_SECRET en .env.local.");
if (!/^[A-Za-z0-9_-]{1,256}$/.test(webhookSecret)) {
  fail("TELEGRAM_WEBHOOK_SECRET solo puede tener letras, números, guion y guion bajo (1 a 256).");
}
if (!baseUrl.startsWith("https://")) fail("--base-url tiene que empezar con https:// (Telegram lo exige).");
if (!supabaseUrl || !serviceRoleKey) fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");

type TelegramResponse<T> = { ok: boolean; result?: T; description?: string };

async function telegram<T>(method: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = (await response.json()) as TelegramResponse<T>;
  if (!data.ok || data.result === undefined) {
    fail(`Telegram rechazó ${method}: ${data.description ?? response.status}`);
  }
  return data.result;
}

const bot = await telegram<{ id: number; username?: string; first_name: string }>("getMe");
const botId = String(bot.id);
console.log(`Bot encontrado: @${bot.username ?? "sin-usuario"} (id ${botId})`);

const supabase = createClient<Database>(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: organization, error: organizationError } = await supabase
  .from("organizations")
  .select("id, name")
  .eq("slug", orgSlug)
  .maybeSingle();
if (organizationError) fail(`No se pudo consultar la organización: ${organizationError.message}`);
if (!organization) fail(`No existe la organización con slug "${orgSlug}".`);

const { data: existing, error: existingError } = await supabase
  .from("channels")
  .select("id, organization_id")
  .eq("type", "telegram")
  .eq("external_id", botId)
  .maybeSingle();
if (existingError) fail(`No se pudo consultar el canal: ${existingError.message}`);

if (existing) {
  if (existing.organization_id !== organization.id) fail("Ese bot ya está registrado en OTRA organización.");
  console.log("El canal ya estaba registrado.");
} else {
  const { error: insertError } = await supabase.from("channels").insert({
    organization_id: organization.id,
    type: "telegram",
    name: values.name ?? `Telegram @${bot.username ?? botId}`,
    external_id: botId,
    config: { username: bot.username ?? null },
    secret_ref: "TELEGRAM_BOT_TOKEN",
  });
  if (insertError) fail(`No se pudo crear el canal: ${insertError.message}`);
  console.log(`Canal creado en ${organization.name}.`);
}

const webhookUrl = `${baseUrl}/api/webhooks/telegram/${botId}`;
await telegram<boolean>("setWebhook", {
  url: webhookUrl,
  secret_token: webhookSecret,
  allowed_updates: ["message"],
});
console.log(`Webhook configurado: ${webhookUrl}`);

const info = await telegram<{
  url: string;
  pending_update_count: number;
  last_error_date?: number;
  last_error_message?: string;
}>("getWebhookInfo");
console.log(`Telegram ve la URL: ${info.url === webhookUrl ? "correcta" : "DISTINTA"}`);
console.log(`Mensajes pendientes de entregar: ${info.pending_update_count}`);
if (info.last_error_message) {
  console.log(`Último error de entrega: ${info.last_error_message}`);
}
