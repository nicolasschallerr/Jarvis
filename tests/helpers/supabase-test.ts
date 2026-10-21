import { randomBytes } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "../../src/lib/supabase/database.types";

export type TestClient = SupabaseClient<Database>;

// Carga .env.local si existe (en un CI las variables ya vienen del entorno).
try {
  process.loadEnvFile(".env.local");
} catch {
  // sin archivo: se usan las variables del entorno
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`);
  }
  return value;
}

export const supabaseUrl = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const publishableKey = requiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");

const noSession = { persistSession: false, autoRefreshToken: false } as const;

// Cliente con la clave de servicio: saltea RLS. Solo para preparar y limpiar datos de prueba.
export function adminClient(): TestClient {
  return createClient<Database>(supabaseUrl, serviceRoleKey, { auth: noSession });
}

// Cliente anónimo, sin sesión.
export function anonClient(): TestClient {
  return createClient<Database>(supabaseUrl, publishableKey, { auth: noSession });
}

export function randomId(): string {
  return randomBytes(4).toString("hex");
}

export type TestUser = {
  id: string;
  email: string;
  client: TestClient;
};

// Crea un usuario con perfil y devuelve un cliente que actúa como él (RLS aplicada).
export async function createTestUser(
  admin: TestClient,
  params: {
    organizationId: string;
    role: Database["public"]["Enums"]["app_role"];
    label: string;
    runId: string;
  },
): Promise<TestUser> {
  const email = `zz-test-${params.runId}-${params.label}@example.test`;
  const password = randomBytes(18).toString("base64url");

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error || !data.user) {
    throw new Error(`No se pudo crear el usuario ${email}: ${error?.message}`);
  }

  const { error: profileError } = await admin.from("profiles").insert({
    id: data.user.id,
    organization_id: params.organizationId,
    full_name: `Prueba ${params.label}`,
    role: params.role,
  });
  if (profileError) {
    throw new Error(`No se pudo crear el perfil de ${email}: ${profileError.message}`);
  }

  const client = createClient<Database>(supabaseUrl, publishableKey, { auth: noSession });
  const { error: signInError } = await client.auth.signInWithPassword({ email, password });
  if (signInError) {
    throw new Error(`No se pudo iniciar sesión como ${email}: ${signInError.message}`);
  }

  return { id: data.user.id, email, client };
}
