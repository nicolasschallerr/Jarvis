import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { syncAttentionConfig } from "../src/lib/client-config/attention";
import { parseClientConfig, syncAgents, syncSectorsAndUnits } from "../src/lib/client-config/load";
import { readAttentionFiles } from "../src/lib/client-config/read-dir";
import type { Database } from "../src/lib/supabase/database.types";

// Organización de demostración con datos 100% inventados ("Cooperativa Ejemplo"): conversaciones, casos en
// todos los estados, consultas al área, notas y consumo. Sirve para mostrar el producto y para revisar la
// interfaz con datos realistas. Cada vez que se corre, BORRA la demo anterior y la vuelve a crear.
//
// Uso (desde la carpeta jarvis):
//   npx tsx --env-file=.env.local scripts/sembrar-demo.mts
//
// El usuario administrador de la demo se toma de JARVIS_DEMO_EMAIL y JARVIS_DEMO_PASSWORD. Si no están, se
// generan y se agregan a .env.local (que no se sube al repo). Nunca se imprimen.

const SLUG = "demo";
const NAME = "Cooperativa Ejemplo (demo)";

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local.");

const admin = createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

let adminEmail = process.env.JARVIS_DEMO_EMAIL;
let adminPassword = process.env.JARVIS_DEMO_PASSWORD;
if (!adminEmail || !adminPassword) {
  adminEmail = "demo-admin@jarvis.test";
  adminPassword = randomBytes(18).toString("base64url");
  appendFileSync(
    ".env.local",
    `\n# Usuario de la organización de demostración (scripts/sembrar-demo.mts). Solo para desarrollo.\nJARVIS_DEMO_EMAIL=${adminEmail}\nJARVIS_DEMO_PASSWORD=${adminPassword}\n`,
  );
  console.log("Credenciales de la demo generadas y guardadas en .env.local (JARVIS_DEMO_EMAIL / JARVIS_DEMO_PASSWORD).");
}

// 1. Borrar la demo anterior: primero los usuarios (sus perfiles impiden borrar la organización).
const { data: previous } = await admin.from("organizations").select("id").eq("slug", SLUG).maybeSingle();
if (previous) {
  const { data: profiles } = await admin.from("profiles").select("id").eq("organization_id", previous.id);
  for (const profile of profiles ?? []) await admin.auth.admin.deleteUser(profile.id);
  const { error } = await admin.from("organizations").delete().eq("id", previous.id);
  if (error) fail(`No se pudo borrar la demo anterior: ${error.message}`);
  console.log("Demo anterior borrada.");
}

// 2. Organización y configuración de la plantilla.
const { data: org, error: orgError } = await admin.from("organizations").insert({ slug: SLUG, name: NAME }).select("id").single();
if (orgError || !org) fail(`No se pudo crear la organización: ${orgError?.message}`);
const orgId = org.id;

const parsed = parseClientConfig(readFileSync("clientes/_plantilla/sectores-y-reglas.yaml", "utf8"));
if (!parsed.ok) fail(parsed.errors.join("; "));
await syncSectorsAndUnits(admin, orgId, parsed.config);
await syncAgents(admin, orgId, parsed.config);
const files = readAttentionFiles("clientes/_plantilla");
if (files) await syncAttentionConfig(admin, orgId, parsed.config, files);

const { data: sectorRows } = await admin.from("sectors").select("id, slug").eq("organization_id", orgId);
const sector = (slug: string) => sectorRows?.find((row) => row.slug === slug)?.id ?? fail(`Falta el sector ${slug}`);
const { data: unitRows } = await admin.from("business_units").select("id, slug").eq("organization_id", orgId);
const unit = (slug: string) => unitRows?.find((row) => row.slug === slug)?.id ?? null;

// 3. Personas del equipo.
async function createPerson(email: string, fullName: string, role: Database["public"]["Enums"]["app_role"], password?: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: password ?? randomBytes(24).toString("base64url"),
    email_confirm: true,
  });
  if (error || !data.user) fail(`No se pudo crear ${email}: ${error?.message}`);
  const { error: profileError } = await admin.from("profiles").insert({ id: data.user.id, organization_id: orgId, full_name: fullName, role });
  if (profileError) fail(`No se pudo crear el perfil de ${email}: ${profileError.message}`);
  return data.user.id;
}

// Si quedó un usuario con el mismo email de una corrida que falló a mitad, se borra antes.
const { data: existingUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
for (const user of existingUsers?.users ?? []) {
  if (user.email && user.email.endsWith("@jarvis.test") && user.email.startsWith("demo-")) await admin.auth.admin.deleteUser(user.id);
}

const adminId = await createPerson(adminEmail, "Valeria Admin", "superadmin", adminPassword);
const laura = await createPerson("demo-laura@jarvis.test", "Laura Gómez", "operator");
const martin = await createPerson("demo-martin@jarvis.test", "Martín Ruiz", "operator");
await createPerson("demo-paula@jarvis.test", "Paula Díaz", "viewer");

await admin.from("sector_members").insert([
  { organization_id: orgId, sector_id: sector("creditos"), profile_id: laura, is_lead: true },
  { organization_id: orgId, sector_id: sector("atencion-general"), profile_id: laura, is_lead: false },
  { organization_id: orgId, sector_id: sector("viajes"), profile_id: martin, is_lead: true },
  { organization_id: orgId, sector_id: sector("atencion-general"), profile_id: adminId, is_lead: true },
]);

// 4. Canales (identificadores inventados: no reciben mensajes reales).
const { data: channels, error: channelError } = await admin
  .from("channels")
  .insert([
    { organization_id: orgId, type: "whatsapp", name: "WhatsApp demo", external_id: `demo-wa-${orgId.slice(0, 8)}` },
    { organization_id: orgId, type: "telegram", name: "Telegram demo", external_id: `demo-tg-${orgId.slice(0, 8)}` },
  ])
  .select("id, type");
if (channelError || !channels) fail(`No se pudieron crear los canales: ${channelError?.message}`);
const channel = (type: "whatsapp" | "telegram") => channels.find((row) => row.type === type)?.id ?? fail(`Falta el canal ${type}`);

// 5. Conversaciones con mensajes. Las horas son relativas a ahora.
const now = Date.now();
const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
let sequence = 0;

type Line = { from: "contact" | "agent" | "operator"; text: string; minutesAgo: number; by?: string };

async function conversation(params: {
  channel: "whatsapp" | "telegram";
  identifier: string;
  name: string;
  lines: Line[];
  contact?: { document_number?: string; locality?: string };
}) {
  let conversationId = "";
  for (const line of params.lines) {
    sequence += 1;
    if (line.from === "contact") {
      const { error } = await admin.rpc("ingest_inbound_message", {
        p_organization_id: orgId,
        p_channel_id: channel(params.channel),
        p_channel_type: params.channel,
        p_identifier: params.identifier,
        p_contact_name: params.name,
        p_external_id: `demo-${sequence}`,
        p_type: "text",
        p_body: line.text,
        p_provider_timestamp: ago(line.minutesAgo),
        p_raw: {},
      });
      if (error) fail(`No se pudo crear un mensaje: ${error.message}`);
      if (!conversationId) {
        const { data } = await admin.from("messages").select("conversation_id").eq("organization_id", orgId).eq("external_id", `demo-${sequence}`).single();
        conversationId = data?.conversation_id ?? "";
      }
    } else {
      await admin.from("messages").insert({
        organization_id: orgId,
        conversation_id: conversationId,
        direction: "outbound",
        sender: line.from,
        sender_profile_id: line.by ?? null,
        type: "text",
        body: line.text,
        status: "sent",
        external_id: `demo-out-${sequence}`,
        provider_timestamp: ago(line.minutesAgo),
      });
    }
  }

  const last = Math.min(...params.lines.map((line) => line.minutesAgo));
  await admin.from("conversations").update({ last_message_at: ago(last) }).eq("id", conversationId);

  const { data: conv } = await admin.from("conversations").select("contact_id").eq("id", conversationId).single();
  const contactId = conv?.contact_id ?? "";
  if (params.contact) await admin.from("contacts").update(params.contact).eq("id", contactId);
  return { conversationId, contactId };
}

async function openCase(ids: { conversationId: string; contactId: string }, fields: Partial<Database["public"]["Tables"]["cases"]["Insert"]>) {
  const { data, error } = await admin
    .from("cases")
    .insert({ organization_id: orgId, contact_id: ids.contactId, conversation_id: ids.conversationId, ...fields })
    .select("id")
    .single();
  if (error || !data) fail(`No se pudo crear un caso: ${error?.message}`);
  return data.id;
}

// Crédito derivado por el agente, esperando que alguien lo tome.
const ana = await conversation({
  channel: "whatsapp",
  identifier: "5490000000001",
  name: "Ana Prueba",
  contact: { document_number: "11111111", locality: "Villa Ejemplo" },
  lines: [
    { from: "contact", text: "Hola! quería saber si puedo pedir un préstamo de 500 mil", minutesAgo: 190 },
    { from: "agent", text: "¡Hola Ana! Sí, los créditos personales son para asociados con al menos 6 meses de antigüedad. Para dejar tu solicitud anotada necesito tu DNI, tu localidad y si estás activa o jubilada.", minutesAgo: 189 },
    { from: "contact", text: "11.111.111, Villa Ejemplo, jubilada", minutesAgo: 175 },
    { from: "agent", text: "Perfecto, ya tengo todo. Le pasé tu solicitud al equipo de Créditos: te van a responder por acá.", minutesAgo: 174 },
  ],
});
await openCase(ana, {
  title: "Solicitud de crédito",
  unit_id: unit("creditos"),
  sector_id: sector("creditos"),
  status: "new",
  priority: "normal",
  summary: "Ana pide un crédito personal de $500.000. Es jubilada, vive en Villa Ejemplo y tiene más de 6 meses de antigüedad.",
  collected_data: { monto: "500000", situacion_laboral: "jubilada" },
});

// Viaje con consulta pendiente al área.
const beto = await conversation({
  channel: "telegram",
  identifier: "100000002",
  name: "Beto Prueba",
  lines: [
    { from: "contact", text: "buenas, hay lugar para el viaje a las sierras en marzo? somos 2", minutesAgo: 95 },
    { from: "agent", text: "¡Hola Beto! Le consulto al equipo de Viajes por el cupo para 2 personas en marzo y te respondo por este mismo chat.", minutesAgo: 94 },
  ],
});
const betoCase = await openCase(beto, {
  title: "Viaje a las sierras en marzo",
  unit_id: unit("viajes"),
  sector_id: sector("viajes"),
  status: "waiting_area",
  collected_data: { destino: "Sierras", fecha: "marzo", personas: "2" },
});
await admin.from("area_queries").insert({
  organization_id: orgId,
  case_id: betoCase,
  conversation_id: beto.conversationId,
  sector_id: sector("viajes"),
  question: "¿Hay cupo para 2 personas en el viaje a las sierras de marzo?",
  status: "pending",
});
await admin.from("notifications").insert({
  organization_id: orgId,
  profile_id: martin,
  type: "area_query",
  case_id: betoCase,
  title: "Consulta pendiente para Viajes",
  body: "Viaje a las sierras en marzo",
});

// Reclamo en curso, tomado por una persona del equipo, con nota interna.
const carla = await conversation({
  channel: "whatsapp",
  identifier: "5490000000003",
  name: "Carla Prueba",
  lines: [
    { from: "contact", text: "Me descontaron dos veces la cuota de este mes", minutesAgo: 600 },
    { from: "agent", text: "Lamento lo que pasó, Carla. Ya le paso tu caso a una persona del equipo para que lo revise.", minutesAgo: 599 },
    { from: "operator", text: "Hola Carla, soy Laura. Ya estoy revisando los descuentos, en el día te confirmo.", minutesAgo: 420, by: laura },
    { from: "contact", text: "Gracias Laura, quedo atenta", minutesAgo: 415 },
  ],
});
const carlaCase = await openCase(carla, {
  title: "Doble descuento de cuota",
  sector_id: sector("atencion-general"),
  status: "in_progress",
  priority: "high",
  assigned_to: laura,
  summary: "La asociada reporta un descuento duplicado de la cuota del mes.",
});
await admin.from("internal_notes").insert({
  organization_id: orgId,
  conversation_id: carla.conversationId,
  case_id: carlaCase,
  author_id: laura,
  body: "Pedí a Tesorería el detalle de los débitos del mes. Si se confirma, se reintegra en el próximo recibo.",
});

// Tema sensible: urgente.
const diego = await conversation({
  channel: "telegram",
  identifier: "100000004",
  name: "Diego Prueba",
  lines: [
    { from: "contact", text: "me aparecio una transferencia que no hice!!!", minutesAgo: 35 },
    { from: "agent", text: "Entiendo la preocupación, Diego. Lo derivo ya mismo como urgente. No compartas claves ni códigos con nadie.", minutesAgo: 34 },
  ],
});
await openCase(diego, {
  title: "Transferencia no reconocida",
  sector_id: sector("atencion-general"),
  status: "new",
  priority: "urgent",
  summary: "El asociado informa una transferencia que no reconoce. Tema de seguridad: atender con prioridad.",
});

// Esperando datos del asociado.
const elena = await conversation({
  channel: "whatsapp",
  identifier: "5490000000005",
  name: "Elena Prueba",
  lines: [
    { from: "contact", text: "Hola, quiero anotarme en el viaje de egresados para mi hija", minutesAgo: 1500 },
    { from: "agent", text: "¡Qué lindo! Para avanzar necesito el nombre completo de tu hija, su DNI y la escuela.", minutesAgo: 1499 },
  ],
});
await openCase(elena, { title: "Inscripción a viaje", unit_id: unit("viajes"), sector_id: sector("viajes"), status: "waiting_contact", assigned_to: martin });

// Consulta resuelta.
const fede = await conversation({
  channel: "telegram",
  identifier: "100000006",
  name: "Fede Prueba",
  lines: [
    { from: "contact", text: "a que hora atienden?", minutesAgo: 2900 },
    { from: "agent", text: "Atendemos de lunes a viernes de 8 a 15 h. ¿Te ayudo con algo más?", minutesAgo: 2899 },
    { from: "contact", text: "no, gracias!", minutesAgo: 2890 },
  ],
});
await openCase(fede, { title: "Consulta de horario", status: "resolved", resolution: "Se informó el horario de atención." });

// Esperando respuesta del equipo, sin caso todavía.
await conversation({
  channel: "whatsapp",
  identifier: "5490000000007",
  name: "Gabi Prueba",
  lines: [{ from: "contact", text: "Hola, ¿tienen convenio con alguna óptica?", minutesAgo: 12 }],
});
await conversation({
  channel: "telegram",
  identifier: "100000008",
  name: "Hugo Prueba",
  lines: [{ from: "contact", text: "necesito el certificado de libre deuda", minutesAgo: 55 }],
});

// 6. Consumo de IA de los últimos días (para el panel de consumo).
const calls = Array.from({ length: 24 }, (_, index) => ({
  organization_id: orgId,
  agent_kind: "attention" as const,
  model: "claude-sonnet-5-5",
  input_tokens: 1800 + ((index * 337) % 900),
  output_tokens: 120 + ((index * 53) % 140),
  latency_ms: 1400 + ((index * 97) % 900),
  stop_reason: "end_turn",
  created_at: ago(index * 170),
}));
await admin.from("ai_calls").insert(calls);

// 7. Plantillas de WhatsApp de ejemplo (Fase 9). Están marcadas como aprobadas para ver el formulario, pero el canal
// demo no tiene token: nunca se envía nada real.
await admin.from("message_templates").insert([
  {
    organization_id: orgId,
    channel_id: channel("whatsapp"),
    name: "recordatorio_gestion_pendiente",
    language: "es_AR",
    category: "utility",
    body: "Hola {{1}}, soy {{2}} de {{3}}. Tu consulta quedó pendiente: ¿querés que la sigamos?",
    meta_status: "approved",
  },
  {
    organization_id: orgId,
    channel_id: channel("whatsapp"),
    name: "respuesta_del_area",
    language: "es_AR",
    category: "utility",
    body: "Hola {{1}}, ya tenemos novedades sobre tu consulta. Respondé este mensaje y te contamos.",
    meta_status: "approved",
  },
  {
    organization_id: orgId,
    channel_id: channel("whatsapp"),
    name: "promocion_viajes",
    language: "es_AR",
    category: "marketing",
    body: "¡Nuevos destinos para este verano! Escribinos para conocerlos.",
    meta_status: "submitted",
  },
]);

console.log(`Demo lista: ${NAME}. Entrá con el usuario de JARVIS_DEMO_EMAIL.`);
