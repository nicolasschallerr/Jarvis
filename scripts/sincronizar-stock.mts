import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

import { syncSource } from "../src/lib/catalog/sources";
import type { Database } from "../src/lib/supabase/database.types";

// Lee ya las fuentes de stock de una organización, sin esperar a que les toque en el trabajador (ADR-047). Sirve para
// probar una fuente recién configurada. Las fuentes se dan de alta con cargar-configuracion.mts.
//
// Uso (desde la carpeta del proyecto):
//   npx tsx --env-file=.env.local scripts/sincronizar-stock.mts --org-slug mi-cliente
//   npx tsx --env-file=.env.local scripts/sincronizar-stock.mts --org-slug mi-cliente --fuente "Tienda online"

const { values } = parseArgs({ options: { "org-slug": { type: "string" }, fuente: { type: "string" } } });

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!values["org-slug"]) fail("Falta --org-slug.");
if (!url || !serviceRoleKey) fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (usá --env-file).");

const admin = createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: organization } = await admin.from("organizations").select("id").eq("slug", values["org-slug"]).maybeSingle();
if (!organization) fail(`No existe la organización "${values["org-slug"]}".`);

let query = admin.from("catalog_sources").select("id, organization_id, kind, config, sync_every_hours, last_synced_at, name").eq("organization_id", organization.id);
if (values.fuente) query = query.eq("name", values.fuente);
const { data: sources } = await query;
if (!sources?.length) fail("La organización no tiene fuentes de stock (cargalas con cargar-configuracion.mts).");

let failed = 0;
for (const source of sources) {
  console.log(`Leyendo "${source.name}" (${source.kind})...`);
  const result = await syncSource(admin, source, { deadline: Date.now() + 240_000 });
  if (result.ok) console.log(`  ${result.message}`);
  else {
    failed++;
    console.error(`  Error: ${result.error}`);
  }
}
process.exit(failed ? 1 : 0);
