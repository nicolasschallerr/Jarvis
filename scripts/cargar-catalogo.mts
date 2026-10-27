import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

import { parseCatalogFile, syncCatalog } from "../src/lib/catalog/import";
import type { Database } from "../src/lib/supabase/database.types";

// Sube el catálogo de stock de un cliente a la base (ADR-043): alta y actualización de cada ítem del archivo, y baja
// lógica de los que ya no están. El archivo lo arma el lector propio del cliente (en su carpeta privada) con el
// formato común de src/lib/catalog/import.ts. Se puede repetir sin efectos de más.
//
// Uso (desde la carpeta del repo), primero en desarrollo:
//   npx tsx --env-file=.env.local scripts/cargar-catalogo.mts --org-slug <slug> --archivo "../Orbita AI - Privado/clientes/<slug>/catalogo.json"
//   --validar-solo   revisa el archivo sin tocar la base

const { values } = parseArgs({
  options: {
    "org-slug": { type: "string" },
    archivo: { type: "string" },
    "validar-solo": { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const file = values.archivo ?? fail("Falta --archivo (la ruta al catalogo.json del cliente).");
let text: string;
try {
  text = readFileSync(file, "utf8");
} catch {
  fail(`No encuentro ${file}.`);
}

const parsed = parseCatalogFile(text);
if (!parsed.ok) fail(`El catálogo tiene errores:\n  - ${parsed.errors.join("\n  - ")}`);
console.log(`Archivo válido: ${parsed.items.length} ítems.`);
if (values["validar-solo"]) process.exit(0);

const slug = values["org-slug"] ?? fail("Falta --org-slug.");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (usá --env-file).");

const admin = createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: org } = await admin.from("organizations").select("id, name").eq("slug", slug).maybeSingle();
if (!org) fail(`No existe la organización "${slug}".`);

const summary = await syncCatalog(admin, org.id, parsed.items);
console.log(`Catálogo de ${org.name}: ${summary.upserted} ítems cargados o actualizados, ${summary.deactivated} dados de baja.`);
