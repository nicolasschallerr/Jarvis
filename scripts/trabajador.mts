import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types";

// Enciende, apaga o consulta el trabajador de mensajes (el trabajo de pg_cron que llama a la aplicación cada 10 s).
// La suite de pruebas lo pausa sola y lo reanuda al terminar; este script sirve si una corrida se cortó a la
// fuerza y quedó pausado, o para pausarlo a mano.
//
// Uso (desde la carpeta jarvis):
//   npx tsx --env-file=.env.local scripts/trabajador.mts --estado
//   npx tsx --env-file=.env.local scripts/trabajador.mts --pausar
//   npx tsx --env-file=.env.local scripts/trabajador.mts --reanudar

const { values } = parseArgs({
  options: {
    estado: { type: "boolean", default: false },
    pausar: { type: "boolean", default: false },
    reanudar: { type: "boolean", default: false },
  },
});

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const chosen = [values.estado, values.pausar, values.reanudar].filter(Boolean).length;
if (chosen !== 1) fail("Elegí una sola opción: --estado, --pausar o --reanudar.");

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.");

const admin = createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

const wanted = values.pausar ? false : values.reanudar ? true : null;
const { data: before, error } = await admin.rpc("set_worker_active", wanted === null ? undefined : { p_active: wanted });
if (error) fail(error.message);

const { data: now } = await admin.rpc("set_worker_active");
console.log(`Trabajador: ${now ? "activo" : "pausado"}${wanted === null ? "" : ` (antes: ${before ? "activo" : "pausado"})`}`);
