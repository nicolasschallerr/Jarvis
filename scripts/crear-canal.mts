import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types";

// Registra un canal (por ejemplo un número de WhatsApp) en una organización. El webhook usa el
// external_id (en WhatsApp, el phone_number_id de Meta) para saber a qué organización pertenece
// cada mensaje entrante.
//
// Uso (desde la carpeta jarvis):
//   npx tsx --env-file=.env.local scripts/crear-canal.mts \
//     --org-slug mi-cliente --name "Número de prueba" --external-id 123456789012345
//
// Opcional: --type (whatsapp por defecto), --secret-ref (nombre de la variable de entorno con el
// token del canal; nunca el token) y --waba-id (id de la cuenta de WhatsApp Business, para sincronizar las
// plantillas de Meta, Fase 9). Si el canal ya existe, solo completa el --waba-id si se pasa.

const CHANNEL_TYPES = ["whatsapp", "instagram", "messenger", "email", "telegram"] as const;
type ChannelType = (typeof CHANNEL_TYPES)[number];

const { values } = parseArgs({
  options: {
    "org-slug": { type: "string" },
    name: { type: "string" },
    "external-id": { type: "string" },
    type: { type: "string", default: "whatsapp" },
    "secret-ref": { type: "string" },
    "waba-id": { type: "string" },
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
  .select("id, organization_id, name, config")
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
  if (wabaId) {
    const config = { ...((existing.config as Record<string, unknown> | null) ?? {}), waba_id: wabaId };
    const { error: updateError } = await supabase.from("channels").update({ config }).eq("id", existing.id);
    if (updateError) fail(`No se pudo guardar el waba_id: ${updateError.message}`);
    console.log(`El canal ya existía: ${existing.name}. Se guardó el waba_id ${wabaId}.`);
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
  secret_ref: values["secret-ref"] ?? null,
  config: wabaId ? { waba_id: wabaId } : {},
});

if (insertError) {
  fail(`No se pudo crear el canal: ${insertError.message}`);
}

console.log(`Canal creado en ${organization.name}: ${name} (${type}, ${externalId}).`);
