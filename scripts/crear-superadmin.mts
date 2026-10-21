import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types";

// Crea una organización (si no existe) y su primer usuario superadministrador.
//
// Uso (desde la carpeta jarvis):
//   npx tsx --env-file=.env.local scripts/crear-superadmin.mts \
//     --org-slug mi-cliente --org-name "Mi Cliente" \
//     --email persona@ejemplo.com --name "Nombre Apellido"
//
// La contraseña se pide por pantalla sin mostrarla. Para uso no interactivo se puede pasar en
// la variable de entorno JARVIS_ADMIN_PASSWORD. Nunca va en argumentos ni en el repo.

const { values } = parseArgs({
  options: {
    "org-slug": { type: "string" },
    "org-name": { type: "string" },
    email: { type: "string" },
    name: { type: "string" },
  },
});

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const orgSlug = values["org-slug"];
const orgName = values["org-name"];
const email = values.email;
const fullName = values.name;

if (!orgSlug || !orgName || !email || !fullName) {
  fail("Faltan argumentos. Se necesitan --org-slug, --org-name, --email y --name.");
}

if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(orgSlug)) {
  fail("--org-slug debe tener minúsculas, números y guiones (ej. mi-cliente).");
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (usá --env-file=.env.local).");
}

async function askPassword(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let muted = false;
  const original = (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput;
  (rl as unknown as { _writeToOutput: (text: string) => void })._writeToOutput = (text) => {
    if (!muted) original.call(rl, text);
  };

  const answer = await new Promise<string>((resolve) => {
    rl.question("Contraseña (mínimo 12 caracteres, no se muestra): ", (value) => {
      resolve(value);
    });
    muted = true;
  });
  rl.close();
  console.log();
  return answer;
}

const password = process.env.JARVIS_ADMIN_PASSWORD ?? (await askPassword());

if (password.length < 12) {
  fail("La contraseña debe tener al menos 12 caracteres.");
}

const supabase = createClient<Database>(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 1. Organización: se reutiliza si el slug ya existe.
const { data: existingOrg, error: findError } = await supabase
  .from("organizations")
  .select("id, name")
  .eq("slug", orgSlug)
  .maybeSingle();

if (findError) {
  fail(`No se pudo consultar la organización: ${findError.message}`);
}

let organizationId = existingOrg?.id;

if (!organizationId) {
  const { data: createdOrg, error: orgError } = await supabase
    .from("organizations")
    .insert({ slug: orgSlug, name: orgName })
    .select("id")
    .single();

  if (orgError || !createdOrg) {
    fail(`No se pudo crear la organización: ${orgError?.message ?? "sin datos"}`);
  }
  organizationId = createdOrg.id;
  console.log(`Organización creada: ${orgName} (${orgSlug})`);
} else {
  console.log(`Organización existente: ${existingOrg?.name} (${orgSlug})`);
}

// 2. Usuario en Supabase Auth (email confirmado: lo crea un administrador).
const { data: createdUser, error: userError } = await supabase.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
});

if (userError || !createdUser.user) {
  fail(`No se pudo crear el usuario: ${userError?.message ?? "sin datos"}`);
}

// 3. Perfil con rol superadmin. Si falla, se deshace el usuario para no dejar uno huérfano.
const { error: profileError } = await supabase.from("profiles").insert({
  id: createdUser.user.id,
  organization_id: organizationId,
  full_name: fullName,
  role: "superadmin",
});

if (profileError) {
  await supabase.auth.admin.deleteUser(createdUser.user.id);
  fail(`No se pudo crear el perfil (se deshizo el usuario): ${profileError.message}`);
}

console.log(`Superadministrador creado: ${email}`);
