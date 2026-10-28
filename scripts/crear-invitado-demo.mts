import { randomBytes } from "node:crypto";
import { appendFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types";

// Crea un usuario de SOLO CONSULTA (rol viewer) en una organización de demostración, para que un prospecto entre a
// mirar la demo sin poder cambiar nada. Solo funciona con organizaciones "<slug>-demo" (scripts/sembrar-demo-cliente.mts).
//
// Uso (desde la carpeta del repo), en desarrollo:
//   npx tsx --env-file=.env.local scripts/crear-invitado-demo.mts --org-slug <slug>-demo --nombre "Nombre del invitado"
//
// La contraseña se genera y se guarda en .env.local (JARVIS_INVITADO_<SLUG>_EMAIL / _PASSWORD). Nunca se imprime.
// Si el invitado ya existe, se le genera una contraseña nueva.

// En producción: --salida .env.invitados (así la contraseña no se mezcla con las variables de desarrollo).
const { values } = parseArgs({ options: { "org-slug": { type: "string" }, nombre: { type: "string" }, salida: { type: "string" } } });

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const slug = values["org-slug"] ?? fail("Falta --org-slug (ej. mi-cliente-demo).");
if (slug !== "demo" && !slug.endsWith("-demo")) fail('Por seguridad, los invitados solo se crean en organizaciones de demostración (slug "demo" o terminado en -demo).');
const name = values.nombre?.trim() || "Invitado";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (usá --env-file=.env.local).");

const admin = createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { data: org } = await admin.from("organizations").select("id, name").eq("slug", slug).maybeSingle();
if (!org) fail(`No existe la organización "${slug}". Armala primero con scripts/sembrar-demo-cliente.mts.`);

const email = `invitado-${slug}@jarvis.test`;
const password = randomBytes(12).toString("base64url");
const envKey = `JARVIS_INVITADO_${slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
const existing = users?.users.find((user) => user.email === email);
if (existing) {
  const { error } = await admin.auth.admin.updateUserById(existing.id, { password });
  if (error) fail(`No se pudo renovar la contraseña: ${error.message}`);
} else {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error || !data.user) fail(`No se pudo crear el usuario: ${error?.message}`);
  const { error: profileError } = await admin.from("profiles").insert({ id: data.user.id, organization_id: org.id, full_name: name, role: "viewer" });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    fail(`No se pudo crear el perfil: ${profileError.message}`);
  }
}

const salida = values.salida ?? ".env.local";
appendFileSync(salida, `\n# Invitado de solo consulta en ${org.name} (scripts/crear-invitado-demo.mts).\n${envKey}_EMAIL=${email}\n${envKey}_PASSWORD=${password}\n`);
console.log(`Invitado listo en ${org.name}: ${email} (solo consulta). Contraseña en ${salida} (${envKey}_PASSWORD).`);
