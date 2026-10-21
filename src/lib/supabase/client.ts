import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "./database.types";

// Cliente para componentes que corren en el navegador. Usa la clave pública: la seguridad la
// pone RLS en la base, no el secreto de esta clave.
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
}
