import { spawnSync } from "node:child_process";

// Aplica las migraciones pendientes en la base de PRODUCCIÓN (orbita-ai-prod, São Paulo). Primero se aplican y se prueban
// en desarrollo (`npx supabase db push`); recién después, acá.
//
// Uso (desde la carpeta del proyecto):
//   npx tsx --env-file=.env.produccion scripts/migrar-produccion.mts            muestra qué aplicaría, sin tocar nada
//   npx tsx --env-file=.env.produccion scripts/migrar-produccion.mts --aplicar  las aplica
//
// La contraseña se lee de .env.produccion (SUPABASE_PROD_DB_PASSWORD) y nunca se imprime.

const PROJECT_REF = "gldnruxgdmzjmyongkuy";
const POOLER_HOST = "aws-1-sa-east-1.pooler.supabase.com";

const password = process.env.SUPABASE_PROD_DB_PASSWORD;
if (!password) {
  console.error("Error: falta SUPABASE_PROD_DB_PASSWORD (usá --env-file=.env.produccion).");
  process.exit(1);
}
if (!process.env.NEXT_PUBLIC_SUPABASE_URL?.includes(PROJECT_REF)) {
  console.error("Error: el archivo de entorno no es el de producción (la URL no coincide).");
  process.exit(1);
}

const apply = process.argv.includes("--aplicar");
const dbUrl = `postgresql://postgres.${PROJECT_REF}:${encodeURIComponent(password)}@${POOLER_HOST}:5432/postgres`;
const args = ["supabase", "db", "push", "--db-url", dbUrl, ...(apply ? ["--yes"] : ["--dry-run"])];

const result = spawnSync("npx", args, { encoding: "utf8", shell: process.platform === "win32" });
// La salida puede repetir la dirección de conexión: se quita antes de mostrarla.
const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.split(dbUrl).join("postgresql://***");
console.log(output.trim());
console.log(apply ? "\nListo: migraciones aplicadas en producción." : "\nSolo se revisó. Para aplicarlas: agregá --aplicar.");
process.exit(result.status ?? 1);
