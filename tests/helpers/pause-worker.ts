import { createClient } from "@supabase/supabase-js";

import type { Database } from "../../src/lib/supabase/database.types";

// Arranque global de la suite: pausa el trabajador de mensajes (pg_cron → Vercel, cada 10 s) mientras corren
// las pruebas y lo deja como estaba al terminar. Sin esto, el trabajador real a veces toma un evento de prueba
// antes que la prueba y esta falla sin un error real (lecciones 19 y 31).
//
// Si una corrida se corta a la fuerza y el trabajador queda pausado: `npx tsx --env-file=.env.local
// scripts/trabajador.mts --reanudar`. Para no pausarlo: JARVIS_NO_PAUSAR_TRABAJADOR=1.

try {
  process.loadEnvFile(".env.local");
} catch {
  // sin archivo: se usan las variables del entorno
}

// Una pasada que ya estaba en curso cuando se pausó puede tardar unos segundos en terminar.
const SETTLE_MS = 5000;

export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  if (process.env.JARVIS_NO_PAUSAR_TRABAJADOR === "1") return undefined;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return undefined;

  const admin = createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: wasActive, error } = await admin.rpc("set_worker_active", { p_active: false });
  if (error) {
    console.warn(`No se pudo pausar el trabajador (las pruebas siguen): ${error.message}`);
    return undefined;
  }

  if (wasActive) await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

  return async () => {
    // Solo se reanuda si estaba activo antes: si alguien lo había pausado a propósito, queda así.
    if (wasActive) await admin.rpc("set_worker_active", { p_active: true });
  };
}
