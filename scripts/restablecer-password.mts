import { createInterface } from "node:readline";
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types";

// Restablece la contraseña de un usuario existente.
//
// Uso (desde la carpeta jarvis):
//   npx tsx --env-file=.env.local scripts/restablecer-password.mts --email persona@ejemplo.com
//
// La contraseña nueva se pide por pantalla sin mostrarla. Para uso no interactivo se puede pasar
// en la variable de entorno JARVIS_NEW_PASSWORD. Nunca va en argumentos ni en el repo.

const { values } = parseArgs({ options: { email: { type: "string" } } });

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const email = values.email?.trim().toLowerCase();
if (!email) {
  fail("Falta --email.");
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
    rl.question("Contraseña nueva (mínimo 12 caracteres, no se muestra): ", (value) => {
      resolve(value);
    });
    muted = true;
  });
  rl.close();
  console.log();
  return answer;
}

const password = process.env.JARVIS_NEW_PASSWORD ?? (await askPassword());
if (password.length < 12) {
  fail("La contraseña debe tener al menos 12 caracteres.");
}

const supabase = createClient<Database>(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (listError) {
  fail(`No se pudo listar los usuarios: ${listError.message}`);
}

const user = list.users.find((candidate) => candidate.email?.toLowerCase() === email);
if (!user) {
  fail(`No existe un usuario con el email ${email}.`);
}

const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, { password });
if (updateError) {
  fail(`No se pudo actualizar la contraseña: ${updateError.message}`);
}

console.log(`Contraseña actualizada para ${email}.`);
