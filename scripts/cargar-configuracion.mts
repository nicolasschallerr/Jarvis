import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

import { syncAttentionConfig } from "../src/lib/client-config/attention";
import { readAttentionFiles } from "../src/lib/client-config/read-dir";
import { configuredSources, parseClientConfig, syncAgents, syncSectorsAndUnits } from "../src/lib/client-config/load";
import { syncSourcesFromConfig } from "../src/lib/catalog/sources";
import type { Database } from "../src/lib/supabase/database.types";

// Valida clientes/<carpeta>/sectores-y-reglas.yaml y carga sectores y unidades en la organización.
// Se puede repetir sin duplicar; lo que ya no está en el archivo se desactiva, no se borra.
//
// Uso (desde la carpeta jarvis):
//   npx tsx --env-file=.env.local scripts/cargar-configuracion.mts --org-slug mi-cliente
//   (por defecto lee clientes/<org-slug>/; con --dir se indica otra carpeta, por ejemplo clientes/_plantilla)
//
// Con --validar-solo solo revisa el archivo, sin tocar la base.

const { values } = parseArgs({
  options: {
    "org-slug": { type: "string" },
    dir: { type: "string" },
    "validar-solo": { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const orgSlug = values["org-slug"];
const validateOnly = values["validar-solo"] === true;

if (!validateOnly && !orgSlug) fail("Falta --org-slug.");
if (validateOnly && !values.dir && !orgSlug) fail("Indicá --dir o --org-slug para saber qué archivo revisar.");

const directory = values.dir ?? join("clientes", orgSlug ?? "");
const file = join(directory, "sectores-y-reglas.yaml");

let text: string;
try {
  text = readFileSync(file, "utf8");
} catch {
  fail(`No encuentro ${file}. Ejecutá el script desde la carpeta jarvis.`);
}

const parsed = parseClientConfig(text);
if (!parsed.ok) {
  console.error(`El archivo ${file} tiene errores:`);
  for (const error of parsed.errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`Archivo válido: ${parsed.config.sectores.length} sectores y ${parsed.config.unidades.length} unidades.`);
if (validateOnly) process.exit(0);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.");

const admin = createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: organization, error } = await admin.from("organizations").select("id").eq("slug", orgSlug ?? "").maybeSingle();
if (error) fail(`No se pudo consultar la organización: ${error.message}`);
if (!organization) fail(`No existe la organización "${orgSlug}". Crearla primero con crear-superadmin.mts.`);

const summary = await syncSectorsAndUnits(admin, organization.id, parsed.config);

console.log("Sectores:", summary.sectors);
console.log("Unidades:", summary.units);

const agents = await syncAgents(admin, organization.id, parsed.config);
console.log("Agentes:", agents);

// Fuentes de stock (ADR-047): el CRM las lee solo. Las claves de las bases van en variables CATALOGO_… del servidor.
const sources = configuredSources(parsed.config);
const sourcesSummary = await syncSourcesFromConfig(admin, organization.id, sources);
console.log("Fuentes de stock:", sourcesSummary);
for (const source of sources) {
  if (source.config.keyEnv && !process.env[source.config.keyEnv]) {
    console.warn(`Aviso: la fuente "${source.name}" usa ${source.config.keyEnv}, que no está en este entorno. Cargala en Vercel y en el .env antes de sincronizar.`);
  }
}

// Prompt y conocimiento del agente de atención (agente-prompt.md y conocimiento/<unidad>.md).
const files = readAttentionFiles(directory);
if (files) {
  const unitIds = parsed.config.unidades.map((unit) => unit.id);
  for (const id of Object.keys(files.knowledge)) {
    if (!unitIds.includes(id)) console.warn(`Aviso: conocimiento/${id}.md no corresponde a ninguna unidad del YAML.`);
  }
  for (const id of unitIds) {
    if (!(id in files.knowledge)) console.warn(`Aviso: la unidad "${id}" no tiene conocimiento/${id}.md.`);
  }

  const attention = await syncAttentionConfig(admin, organization.id, parsed.config, files);
  console.log("Agente de atención:", attention);
} else {
  console.warn("Aviso: no hay agente-prompt.md; el agente de atención no tendrá configuración.");
}
