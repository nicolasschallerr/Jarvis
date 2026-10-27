import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { createAnthropicClient } from "../src/lib/ai/anthropic-client";
import { parseCatalogFile } from "../src/lib/catalog/import";
import type { CatalogItem } from "../src/lib/catalog/search";
import { buildAttentionSettings, DEFAULT_ATTENTION_MODEL } from "../src/lib/client-config/attention";
import { parseClientConfig } from "../src/lib/client-config/load";
import { readAttentionFiles } from "../src/lib/client-config/read-dir";
import { DEFAULT_JUDGE_MODEL } from "../src/lib/evals/judge";
import { formatReport, runEvals } from "../src/lib/evals/run";
import { parseEvalCases } from "../src/lib/evals/schema";

// Corre los casos de evals/casos.yaml del cliente contra el agente de atención con Claude REAL y evalúa
// cada uno con un modelo juez. Cuesta dinero (varias llamadas por caso): usa la clave de .env.local.
// No escribe nada en la base.
//
// Uso (desde la carpeta jarvis):
//   npx tsx --env-file=.env.local scripts/correr-evals.mts --dir clientes/_plantilla
//   --caso <id>      corre solo un caso
//   --canal <tipo>   canal simulado: whatsapp (por defecto, el teléfono se toma del número), instagram, messenger o telegram
//   --solo-validar   solo revisa el archivo de casos, sin llamar al modelo
//
// Termina con código 1 si algún caso falla.

const { values } = parseArgs({
  options: {
    dir: { type: "string" },
    caso: { type: "string" },
    canal: { type: "string", default: "whatsapp" },
    "solo-validar": { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const directory = values.dir;
if (!directory) fail("Falta --dir (por ejemplo clientes/_plantilla). Ejecutá el script desde la carpeta jarvis.");

function read(file: string): string {
  try {
    return readFileSync(join(directory ?? "", file), "utf8");
  } catch {
    return fail(`No encuentro ${join(directory ?? "", file)}.`);
  }
}

const config = parseClientConfig(read("sectores-y-reglas.yaml"));
if (!config.ok) fail(`sectores-y-reglas.yaml tiene errores:\n  - ${config.errors.join("\n  - ")}`);

const parsedCases = parseEvalCases(read(join("evals", "casos.yaml")));
if (!parsedCases.ok) fail(`evals/casos.yaml tiene errores:\n  - ${parsedCases.errors.join("\n  - ")}`);

const known = new Set(config.config.sectores.map((sector) => sector.id));
for (const item of parsedCases.cases) {
  if (item.esperado.sector && !known.has(item.esperado.sector)) {
    fail(`El caso "${item.id}" espera el sector "${item.esperado.sector}", que no está en sectores-y-reglas.yaml.`);
  }
}

const cases = values.caso ? parsedCases.cases.filter((item) => item.id === values.caso) : parsedCases.cases;
if (cases.length === 0) fail(`No hay ningún caso con id "${values.caso}".`);

console.log(`Archivo válido: ${cases.length} caso(s).`);
if (values["solo-validar"]) process.exit(0);

const files = readAttentionFiles(directory);
if (!files) fail("No hay agente-prompt.md en la carpeta del cliente.");

if (!process.env.ANTHROPIC_API_KEY) fail("Falta ANTHROPIC_API_KEY en .env.local: los evals usan Claude real.");
const client = createAnthropicClient();

const agentModel = config.config.ia?.modelo_atencion ?? DEFAULT_ATTENTION_MODEL;
console.log(`Agente: ${agentModel} · Juez: ${DEFAULT_JUDGE_MODEL}. Corriendo...`);

// Si el cliente tiene catálogo de stock, se usa el catalogo.json de su carpeta (en memoria: no se lee la base).
let catalog: CatalogItem[] | undefined;
if (config.config.catalogo?.activo) {
  const catalogFile = join(directory ?? "", "catalogo.json");
  if (!existsSync(catalogFile)) fail(`El catálogo está activo pero no encuentro ${catalogFile}.`);
  const parsedCatalog = parseCatalogFile(readFileSync(catalogFile, "utf8"));
  if (!parsedCatalog.ok) fail(`catalogo.json tiene errores:\n  - ${parsedCatalog.errors.join("\n  - ")}`);
  catalog = parsedCatalog.items;
  console.log(`Catálogo: ${catalog.length} ítems.`);
}

const summary = await runEvals(
  {
    catalog,
    agentClient: client,
    judgeClient: client,
    agentModel,
    judgeModel: DEFAULT_JUDGE_MODEL,
    prompt: files.prompt,
    settings: buildAttentionSettings(config.config, files.knowledge),
    // Identificador inventado: solo sirve para que el teléfono "ya se conozca" como en WhatsApp.
    channel: { type: values.canal ?? "whatsapp", identifier: (values.canal ?? "whatsapp") === "whatsapp" ? "5490000000000" : "100000000" },
  },
  cases,
);

console.log(formatReport(summary));
process.exit(summary.failed === 0 ? 0 : 1);
