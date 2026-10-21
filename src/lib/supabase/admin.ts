import "server-only";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "./database.types";

// Cliente con la clave de servicio: SALTEA RLS. Solo para código de servidor que actúa por
// el sistema (webhooks, trabajador, scripts), nunca en nombre de un usuario. Quien lo use tiene
// que filtrar por organization_id a mano.
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en las variables de entorno.",
    );
  }

  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
