import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

import type { Database, Json } from "../src/lib/supabase/database.types";

// Registra un canal (un número de WhatsApp, una página de Facebook o una cuenta de Instagram) en una organización. El
// webhook usa el external_id para saber a qué organización pertenece cada mensaje entrante:
//   whatsapp   el phone_number_id de Meta (no el número de teléfono)
//   messenger  el id de la página de Facebook
//   instagram  el id de la cuenta profesional de Instagram (el que llega en el webhook como "recipient")
//
// Uso (desde la carpeta jarvis):
//   npx tsx --env-file=.env.local scripts/crear-canal.mts \
//     --org-slug mi-cliente --name "Número de prueba" --external-id 123456789012345
//
// Opcionales:
//   --type          whatsapp (por defecto), messenger, instagram, telegram, email
//   --secret-ref    nombre de la variable de entorno con el token del canal (nunca el token). Por defecto:
//                   WHATSAPP_ACCESS_TOKEN, MESSENGER_ACCESS_TOKEN o INSTAGRAM_ACCESS_TOKEN según el tipo. Con varios canales
//                   del mismo tipo, usar un sufijo: INSTAGRAM_ACCESS_TOKEN_CLIENTE1
//   --waba-id       id de la cuenta de WhatsApp Business, para sincronizar las plantillas de Meta (Fase 9)
//   --api           solo Instagram: instagram_login (por defecto, token de la cuenta de Instagram) o facebook_login
//                   (token de la página de Facebook vinculada)
//   --human-agent   Messenger e Instagram: la cuenta tiene el permiso "Human Agent" y una persona puede responder hasta
//                   7 días después del último mensaje (ver docs/guia-conectar-meta.md)
// Si el canal ya existe, solo completa lo que se pase (--waba-id, --api, --human-agent, --secret-ref).

const CHANNEL_TYPES = ["whatsapp", "instagram", "messenger", "email", "telegram"] as const;
type ChannelType = (typeof CHANNEL_TYPES)[number];

const DEFAULT_SECRET_REF: Partial<Record<ChannelType, string>> = {
  whatsapp: "WHATSAPP_ACCESS_TOKEN",
  messenger: "MESSENGER_ACCESS_TOKEN",
  instagram: "INSTAGRAM_ACCESS_TOKEN",
};

const { values } = parseArgs({
  options: {
    "org-slug": { type: "string" },
    name: { type: "string" },
    "external-id": { type: "string" },
    type: { type: "string", default: "whatsapp" },
    "secret-ref": { type: "string" },
    "waba-id": { type: "string" },
    api: { type: "string" },
    "human-agent": { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const orgSlug = values["org-slug"];
const name = values.name;
const externalId = values["external-id"];
const type = values.type;

if (!orgSlug || !name || !externalId) {
  fail("Faltan argumentos. Se necesitan --org-slug, --name y --external-id.");
}

function isChannelType(value: string | undefined): value is ChannelType {
  return CHANNEL_TYPES.includes(value as ChannelType);
}

if (!isChannelType(type)) {
  fail(`--type debe ser uno de: ${CHANNEL_TYPES.join(", ")}.`);
}

const wabaId = values["waba-id"];
if (wabaId !== undefined && !/^\d{5,30}$/.test(wabaId)) {
  fail("--waba-id debe ser el número de la cuenta de WhatsApp Business (solo dígitos).");
}

const api = values.api;
if (api !== undefined && (type !== "instagram" || (api !== "instagram_login" && api !== "facebook_login"))) {
  fail("--api solo se usa con --type instagram y vale instagram_login o facebook_login.");
}

if (values["human-agent"] && type !== "messenger" && type !== "instagram") {
  fail("--human-agent solo se usa con Messenger o Instagram.");
}

if ((type === "messenger" || type === "instagram" || type === "whatsapp") && !/^\d{5,30}$/.test(externalId)) {
  fail("--external-id debe ser el id numérico que da Meta (solo dígitos).");
}

const secretRef = values["secret-ref"] ?? DEFAULT_SECRET_REF[type] ?? null;
if (secretRef !== null && !/^(TELEGRAM_BOT_TOKEN|WHATSAPP_ACCESS_TOKEN|MESSENGER_ACCESS_TOKEN|INSTAGRAM_ACCESS_TOKEN|CHANNEL_TOKEN)(_[A-Z0-9]+)*$/.test(secretRef)) {
  fail("--secret-ref debe ser el NOMBRE de una variable de entorno de canal (por ejemplo INSTAGRAM_ACCESS_TOKEN), no el token.");
}

// Solo lo que se pidió: nunca se pisa lo que ya tenía el canal.
const wanted: Record<string, Json> = {};
if (wabaId) wanted.waba_id = wabaId;
if (api) wanted.api = api;
if (values["human-agent"]) wanted.human_agent = true;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (usá --env-file=.env.local).");
}

const supabase = createClient<Database>(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: organization, error: organizationError } = await supabase
  .from("organizations")
  .select("id, name")
  .eq("slug", orgSlug)
  .maybeSingle();

if (organizationError) {
  fail(`No se pudo consultar la organización: ${organizationError.message}`);
}
if (!organization) {
  fail(`No existe la organización con slug "${orgSlug}".`);
}

const { data: existing, error: existingError } = await supabase
  .from("channels")
  .select("id, organization_id, name, config, secret_ref")
  .eq("type", type)
  .eq("external_id", externalId)
  .maybeSingle();

if (existingError) {
  fail(`No se pudo consultar el canal: ${existingError.message}`);
}

if (existing) {
  if (existing.organization_id !== organization.id) {
    fail("Ese external_id ya está registrado en OTRA organización.");
  }

  const changes: { config?: Record<string, Json>; secret_ref?: string } = {};
  if (Object.keys(wanted).length > 0) changes.config = { ...((existing.config as Record<string, Json> | null) ?? {}), ...wanted };
  if (values["secret-ref"] && values["secret-ref"] !== existing.secret_ref) changes.secret_ref = values["secret-ref"];

  if (Object.keys(changes).length > 0) {
    const { error: updateError } = await supabase.from("channels").update(changes).eq("id", existing.id);
    if (updateError) fail(`No se pudo actualizar el canal: ${updateError.message}`);
    console.log(`El canal ya existía: ${existing.name}. Se actualizó: ${Object.keys(changes).join(", ")}.`);
    process.exit(0);
  }
  console.log(`El canal ya existía: ${existing.name} (${type}, ${externalId}). No se cambió nada.`);
  process.exit(0);
}

const { error: insertError } = await supabase.from("channels").insert({
  organization_id: organization.id,
  type,
  name,
  external_id: externalId,
  secret_ref: secretRef,
  config: wanted,
});

if (insertError) {
  fail(`No se pudo crear el canal: ${insertError.message}`);
}

console.log(`Canal creado en ${organization.name}: ${name} (${type}, ${externalId}).`);
if (secretRef) console.log(`Token: se lee de la variable de entorno ${secretRef} (cargala en .env.local y en Vercel).`);
