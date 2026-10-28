import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { createClient } from "@supabase/supabase-js";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { respondToMessage } from "../src/lib/agent/attention";
import { createAnthropicClient } from "../src/lib/ai/anthropic-client";
import { parseCatalogFile, syncCatalog } from "../src/lib/catalog/import";
import { syncAttentionConfig } from "../src/lib/client-config/attention";
import { parseClientConfig, syncAgents, syncSectorsAndUnits } from "../src/lib/client-config/load";
import { readAttentionFiles } from "../src/lib/client-config/read-dir";
import type { Database } from "../src/lib/supabase/database.types";

// Arma una organización de DEMOSTRACIÓN para un cliente o prospecto, a partir de su carpeta: configuración, catálogo
// (si tiene) y un guion de conversaciones (demo/escenarios.yaml). Cada mensaje del guion lo contesta el agente REAL
// con Claude (la misma función que en producción), así la demo muestra respuestas, herramientas, derivaciones y
// costos verdaderos. Solo el último paso, el envío a Meta, se simula: los canales de la demo no son números reales.
//
// Uso (desde la carpeta del repo), SOLO en desarrollo:
//   npx tsx --env-file=.env.local scripts/sembrar-demo-cliente.mts --dir "../Orbita AI - Privado/clientes/<slug>"
//
// Crea (o BORRA y vuelve a crear) la organización "<slug>-demo". Nunca toca otra: solo borra slugs que terminan en
// "-demo". Cuesta dinero (Claude real, una llamada o más por mensaje del guion).
// El usuario administrador se toma de JARVIS_DEMO_<SLUG>_EMAIL / _PASSWORD; si no están, se generan y se agregan a
// .env.local (que no se sube al repo). Nunca se imprimen.
//
// --usuarios "correo:rol,correo:rol": cuentas que YA existen y pasan a esta demo (por ejemplo el dueño y un mentor),
// con ese rol (superadmin, operator o viewer). Si hay un superadmin entre ellas, hace de administrador del guion y no se
// crea el usuario administrador de la demo. Al volver a armar la demo esas cuentas se conservan: nunca se borran.
// Si el guion trae "finanzas", se cargan los movimientos de los últimos meses para el agente financiero (ADR-049).

const { values } = parseArgs({ options: { dir: { type: "string" }, usuarios: { type: "string" } } });

function fail(message: string): never {
  console.error(`Error: ${message}`);
  process.exit(1);
}

const dir = values.dir ?? fail('Falta --dir (la carpeta del cliente, ej. "../Orbita AI - Privado/clientes/<slug>").');
const ROLES = ["superadmin", "operator", "viewer"] as const;
const existingAccounts = (values.usuarios ?? "")
  .split(",")
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const [email = "", role = "viewer"] = entry.split(":").map((part) => part.trim());
    if (!email.includes("@")) fail(`--usuarios: "${entry}" no es un correo.`);
    if (!(ROLES as readonly string[]).includes(role)) fail(`--usuarios: el rol de ${email} tiene que ser superadmin, operator o viewer.`);
    return { email: email.toLowerCase(), role: role as (typeof ROLES)[number] };
  });
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) fail("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (usá --env-file=.env.local).");
if (!process.env.ANTHROPIC_API_KEY) fail("Falta ANTHROPIC_API_KEY: la demo usa Claude real.");

// ---------- Guion de la demo ----------
const roleSchema = z.enum(["superadmin", "operator", "viewer"]);
const statusSchema = z.enum(["new", "in_progress", "waiting_contact", "waiting_area", "resolved"]);
const channelSchema = z.enum(["whatsapp", "instagram"]);

const scriptSchema = z.object({
  nombre_organizacion: z.string().min(1),
  administrador: z.object({ nombre: z.string().min(1) }),
  equipo: z
    .array(z.object({ nombre: z.string().min(1), rol: roleSchema.default("operator"), sectores: z.array(z.string()).default([]), lider: z.boolean().default(false) }))
    .default([]),
  // Conversaciones que contesta Claude en vivo. "despues": lo que hace el equipo cuando el agente terminó.
  conversaciones: z
    .array(
      z.object({
        canal: channelSchema,
        contacto: z.string().min(1),
        identificador: z.string().min(1),
        hace_minutos: z.number().int().positive(),
        mensajes: z.array(z.string().min(1)).min(1),
        despues: z
          .object({
            asignar_a: z.string().optional(),
            estado: statusSchema.optional(),
            nota: z.string().optional(),
            respuesta_operador: z.string().optional(),
            resolucion: z.string().optional(),
          })
          .optional(),
      }),
    )
    .default([]),
  // Movimientos de los últimos meses para el agente financiero (ADR-049): categorías que se repiten cada mes con una
  // variación y partidas pendientes (por cobrar o por pagar, vencidas o no).
  finanzas: z
    .object({
      meses: z.number().int().min(1).max(12).default(6),
      categorias: z
        .array(
          z.object({
            nombre: z.string().min(1).max(80),
            tipo: z.enum(["ingreso", "egreso"]),
            // Total del mes, repartido en movimientos_por_mes. Con monto_fijo, cada movimiento es de ese monto exacto
            // (ej. préstamos de $ 2.000.000) y lo que varía es la cantidad.
            mensual: z.number().positive().optional(),
            monto_fijo: z.number().positive().optional(),
            movimientos_por_mes: z.number().int().min(1).max(40).default(4),
            contraparte: z.string().max(120).optional(),
          })
          .refine((category) => category.mensual !== undefined || category.monto_fijo !== undefined, "falta mensual o monto_fijo"),
        )
        .min(1),
      pendientes: z
        .array(
          z.object({
            descripcion: z.string().min(1).max(200),
            contraparte: z.string().max(120).optional(),
            tipo: z.enum(["ingreso", "egreso"]),
            categoria: z.string().max(80).optional(),
            monto: z.number().positive(),
            vence_en_dias: z.number().int(),
          }),
        )
        .default([]),
    })
    .optional(),
  // Historia de los últimos días, sin Claude (texto ya escrito), para que el CRM y el Agente Analítico tengan datos.
  historial: z
    .array(
      z.object({
        canal: channelSchema,
        contacto: z.string().min(1),
        identificador: z.string().min(1),
        dias_atras: z.number().positive(),
        titulo: z.string().min(1),
        sector: z.string().min(1),
        unidad: z.string().optional(),
        estado: statusSchema.default("resolved"),
        prioridad: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
        horas_para_resolver: z.number().positive().default(4),
        mensaje: z.string().min(1),
        respuesta: z.string().min(1),
        resumen: z.string().optional(),
        resolucion: z.string().optional(),
        asignar_a: z.string().optional(),
      }),
    )
    .default([]),
});

const configText = existsSync(join(dir, "sectores-y-reglas.yaml")) ? readFileSync(join(dir, "sectores-y-reglas.yaml"), "utf8") : fail(`No encuentro ${join(dir, "sectores-y-reglas.yaml")}.`);
const parsedConfig = parseClientConfig(configText);
if (!parsedConfig.ok) fail(`sectores-y-reglas.yaml tiene errores:\n  - ${parsedConfig.errors.join("\n  - ")}`);
const config = parsedConfig.config;

const scriptFile = join(dir, "demo", "escenarios.yaml");
if (!existsSync(scriptFile)) fail(`No encuentro ${scriptFile}.`);
const parsedScript = scriptSchema.safeParse(parseYaml(readFileSync(scriptFile, "utf8")));
if (!parsedScript.success) fail(`demo/escenarios.yaml tiene errores:\n  - ${parsedScript.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("\n  - ")}`);
const demo = parsedScript.data;

const files = readAttentionFiles(dir) ?? fail(`Falta ${join(dir, "agente-prompt.md")}.`);

let catalogItems = null;
if (config.catalogo?.activo) {
  const catalogFile = join(dir, "catalogo.json");
  if (!existsSync(catalogFile)) fail(`El catálogo está activo pero no encuentro ${catalogFile}.`);
  const parsedCatalog = parseCatalogFile(readFileSync(catalogFile, "utf8"));
  if (!parsedCatalog.ok) fail(`catalogo.json tiene errores:\n  - ${parsedCatalog.errors.join("\n  - ")}`);
  catalogItems = parsedCatalog.items;
}

const sectorIds = new Set(config.sectores.map((sector) => sector.id));
for (const person of demo.equipo) for (const sector of person.sectores) if (!sectorIds.has(sector)) fail(`"${person.nombre}" está en el sector "${sector}", que no existe.`);
for (const item of demo.historial) if (!sectorIds.has(item.sector)) fail(`El historial "${item.titulo}" usa el sector "${item.sector}", que no existe.`);

const slug = `${config.organizacion.slug}-demo`;
const envKey = `JARVIS_DEMO_${config.organizacion.slug.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;

// ---------- Base ----------
const admin = createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

const ownerAccount = existingAccounts.find((account) => account.role === "superadmin");
let adminEmail = process.env[`${envKey}_EMAIL`];
let adminPassword = process.env[`${envKey}_PASSWORD`];
if (!ownerAccount && (!adminEmail || !adminPassword)) {
  adminEmail = `demo-${config.organizacion.slug}-admin@jarvis.test`;
  adminPassword = randomBytes(18).toString("base64url");
  appendFileSync(
    ".env.local",
    `\n# Usuario de la demo de ${config.organizacion.nombre} (scripts/sembrar-demo-cliente.mts). Solo para desarrollo.\n${envKey}_EMAIL=${adminEmail}\n${envKey}_PASSWORD=${adminPassword}\n`,
  );
  console.log(`Credenciales de la demo generadas y guardadas en .env.local (${envKey}_EMAIL / ${envKey}_PASSWORD).`);
}

// 0. Las cuentas de --usuarios tienen que existir de antemano: este script nunca crea ni borra cuentas de personas.
const userPrefix = `demo-${config.organizacion.slug}-`;
const isDemoUser = (email: string | undefined) => !!email && email.startsWith(userPrefix) && email.endsWith("@jarvis.test");
const { data: existingUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
const accountIds = new Map<string, string>();
for (const account of existingAccounts) {
  const user = existingUsers?.users.find((candidate) => candidate.email?.toLowerCase() === account.email);
  if (!user) fail(`--usuarios: no existe ninguna cuenta con el correo ${account.email}.`);
  if (isDemoUser(user.email)) fail(`--usuarios: ${account.email} es un usuario generado por la demo.`);
  accountIds.set(account.email, user.id);
}

// 1. Borrar la demo anterior (solo slugs "-demo"). Los usuarios generados se borran (sus perfiles impiden borrar la
// organización); las cuentas de personas que estaban en la demo NO: se apartan y pasan a la demo nueva.
const { data: previous } = await admin.from("organizations").select("id, slug").eq("slug", slug).maybeSingle();
let keptProfiles: string[] = [];
if (previous) {
  if (!previous.slug.endsWith("-demo")) fail("Por seguridad, solo se borran organizaciones de demostración.");
  const { data: profiles } = await admin.from("profiles").select("id").eq("organization_id", previous.id);
  const emails = new Map((existingUsers?.users ?? []).map((user) => [user.id, user.email]));
  for (const profile of profiles ?? []) {
    const email = emails.get(profile.id);
    if (isDemoUser(email) || (!!adminEmail && email === adminEmail)) await admin.auth.admin.deleteUser(profile.id);
    else keptProfiles.push(profile.id);
  }
  // Se libera el nombre: la vieja queda aparte hasta que sus personas pasen a la nueva, y recién ahí se borra.
  const { error } = await admin.from("organizations").update({ slug: `${slug}-anterior-${Date.now()}` }).eq("id", previous.id);
  if (error) fail(`No se pudo apartar la demo anterior: ${error.message}`);
}
for (const user of existingUsers?.users ?? []) {
  if (isDemoUser(user.email)) await admin.auth.admin.deleteUser(user.id);
}

// 2. Organización, configuración, agente encendido y catálogo.
const { data: org, error: orgError } = await admin.from("organizations").insert({ slug, name: demo.nombre_organizacion }).select("id").single();
if (orgError || !org) fail(`No se pudo crear la organización: ${orgError?.message}`);
const orgId = org.id;

// Las personas que estaban en la demo anterior (y las de --usuarios) pasan a esta; recién ahí se borra la anterior.
keptProfiles = [...new Set([...keptProfiles, ...accountIds.values()])];
if (keptProfiles.length > 0) {
  const { error } = await admin.from("profiles").update({ organization_id: orgId }).in("id", keptProfiles);
  if (error) fail(`No se pudieron pasar las cuentas a la demo nueva: ${error.message}`);
}
for (const account of existingAccounts) {
  const { error } = await admin.from("profiles").update({ role: account.role }).eq("id", accountIds.get(account.email) ?? "");
  if (error) fail(`No se pudo asignar el rol de ${account.email}: ${error.message}`);
}
if (previous) {
  const { error } = await admin.from("organizations").delete().eq("id", previous.id);
  if (error) fail(`No se pudo borrar la demo anterior: ${error.message}`);
  console.log(`Demo anterior borrada${keptProfiles.length ? ` (se conservaron ${keptProfiles.length} cuentas)` : ""}.`);
}

await syncSectorsAndUnits(admin, orgId, config);
await syncAgents(admin, orgId, config);
await syncAttentionConfig(admin, orgId, config, files);
const { error: enableError } = await admin.from("agents").update({ is_enabled: true }).eq("organization_id", orgId);
if (enableError) fail(`No se pudieron encender los agentes: ${enableError.message}`);
if (catalogItems) {
  const summary = await syncCatalog(admin, orgId, catalogItems);
  console.log(`Catálogo: ${summary.upserted} ítems.`);
}

const { data: sectorRows } = await admin.from("sectors").select("id, slug").eq("organization_id", orgId);
const sectorId = (id: string) => sectorRows?.find((row) => row.slug === id)?.id ?? fail(`Falta el sector ${id}`);
const { data: unitRows } = await admin.from("business_units").select("id, slug").eq("organization_id", orgId);
const unitId = (id: string | undefined) => (id ? (unitRows?.find((row) => row.slug === id)?.id ?? null) : null);

// 3. Equipo.
async function createPerson(email: string, fullName: string, role: z.infer<typeof roleSchema>, password?: string) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: password ?? randomBytes(24).toString("base64url"), email_confirm: true });
  if (error || !data.user) fail(`No se pudo crear ${email}: ${error?.message}`);
  const { error: profileError } = await admin.from("profiles").insert({ id: data.user.id, organization_id: orgId, full_name: fullName, role });
  if (profileError) fail(`No se pudo crear el perfil de ${email}: ${profileError.message}`);
  return data.user.id;
}
const people = new Map<string, string>();
people.set(
  demo.administrador.nombre,
  ownerAccount
    ? (accountIds.get(ownerAccount.email) ?? fail("Falta la cuenta del administrador."))
    : await createPerson(adminEmail as string, demo.administrador.nombre, "superadmin", adminPassword),
);
for (const [index, person] of demo.equipo.entries()) {
  const id = await createPerson(`${userPrefix}${index + 1}@jarvis.test`, person.nombre, person.rol);
  people.set(person.nombre, id);
  if (person.sectores.length > 0) {
    await admin.from("sector_members").insert(person.sectores.map((sector) => ({ organization_id: orgId, sector_id: sectorId(sector), profile_id: id, is_lead: person.lider })));
  }
}
const personId = (name: string | undefined) => (name ? (people.get(name) ?? fail(`"${name}" no está en el equipo de la demo.`)) : null);

// 4. Canales de la demo. El token es una variable que existe solo mientras corre este script, y el envío se simula:
// nada sale a Meta.
const CHANNEL_TOKENS = { whatsapp: "WHATSAPP_ACCESS_TOKEN_DEMO", instagram: "INSTAGRAM_ACCESS_TOKEN_DEMO" } as const;
for (const name of Object.values(CHANNEL_TOKENS)) process.env[name] = "demo-sin-envio-real";
const { data: channels, error: channelError } = await admin
  .from("channels")
  .insert([
    { organization_id: orgId, type: "whatsapp", name: "WhatsApp (demo)", external_id: `demo-wa-${orgId.slice(0, 8)}`, secret_ref: CHANNEL_TOKENS.whatsapp },
    { organization_id: orgId, type: "instagram", name: "Instagram (demo)", external_id: `demo-ig-${orgId.slice(0, 8)}`, secret_ref: CHANNEL_TOKENS.instagram },
  ])
  .select("id, type");
if (channelError || !channels) fail(`No se pudieron crear los canales: ${channelError?.message}`);
const channelId = (type: "whatsapp" | "instagram") => channels.find((row) => row.type === type)?.id ?? fail(`Falta el canal ${type}`);

let sent = 0;
// Responde como Meta a un envío (WhatsApp devuelve messages[0].id; Instagram, message_id).
async function fakeMeta(): Promise<Response> {
  sent += 1;
  const id = `demo-out-${orgId.slice(0, 8)}-${sent}`;
  return new Response(JSON.stringify({ messages: [{ id }], message_id: id, recipient_id: "demo" }), { status: 200, headers: { "content-type": "application/json" } });
}

// 5. Mensajes.
const nowMs = Date.now();
const minutesAgo = (minutes: number) => new Date(nowMs - minutes * 60_000);
let sequence = 0;

async function inbound(params: { channel: "whatsapp" | "instagram"; identifier: string; name: string; text: string; at: Date }) {
  sequence += 1;
  const externalId = `demo-in-${orgId.slice(0, 8)}-${sequence}`;
  const { error } = await admin.rpc("ingest_inbound_message", {
    p_organization_id: orgId,
    p_channel_id: channelId(params.channel),
    p_channel_type: params.channel,
    p_identifier: params.identifier,
    p_contact_name: params.name,
    p_external_id: externalId,
    p_type: "text",
    p_body: params.text,
    p_provider_timestamp: params.at.toISOString(),
    p_raw: {},
  });
  if (error) fail(`No se pudo crear un mensaje: ${error.message}`);
  const { data } = await admin.from("messages").select("id, conversation_id").eq("organization_id", orgId).eq("external_id", externalId).single();
  if (!data) fail("No se encontró el mensaje recién creado.");
  return { messageId: data.id, conversationId: data.conversation_id };
}

const client = createAnthropicClient();

console.log(`Conversaciones en vivo con Claude: ${demo.conversaciones.length}.`);
for (const conversation of demo.conversaciones) {
  let conversationId = "";
  let at = conversation.hace_minutos;
  for (const text of conversation.mensajes) {
    const created = await inbound({ channel: conversation.canal, identifier: conversation.identificador, name: conversation.contacto, text, at: minutesAgo(at) });
    conversationId = created.conversationId;
    const result = await respondToMessage(admin, client, { conversationId, messageId: created.messageId, now: minutesAgo(at - 1), fetchImpl: fakeMeta });
    console.log(`  ${conversation.contacto}: ${result.status}${result.status === "replied" ? "" : ` (${result.reason})`}`);
    at -= 3;
  }

  const after = conversation.despues;
  if (!after) continue;
  const { data: openCase } = await admin.from("cases").select("id, contact_id").eq("conversation_id", conversationId).order("opened_at", { ascending: false }).limit(1).maybeSingle();
  if (after.respuesta_operador) {
    const by = personId(after.asignar_a);
    await admin.from("conversations").update({ ai_enabled: false }).eq("id", conversationId);
    await admin.from("messages").insert({
      organization_id: orgId,
      conversation_id: conversationId,
      direction: "outbound",
      sender: "operator",
      sender_profile_id: by,
      type: "text",
      body: after.respuesta_operador,
      status: "sent",
      external_id: `demo-op-${orgId.slice(0, 8)}-${sequence}`,
      provider_timestamp: minutesAgo(Math.max(at - 5, 1)).toISOString(),
    });
  }
  if (openCase) {
    const update: Database["public"]["Tables"]["cases"]["Update"] = {};
    if (after.asignar_a) update.assigned_to = personId(after.asignar_a);
    if (after.estado) update.status = after.estado;
    if (after.resolucion) update.resolution = after.resolucion;
    if (after.estado === "resolved") update.resolved_at = minutesAgo(Math.max(at - 10, 1)).toISOString();
    if (Object.keys(update).length > 0) await admin.from("cases").update(update).eq("id", openCase.id);
    if (after.nota) {
      await admin.from("internal_notes").insert({ organization_id: orgId, conversation_id: conversationId, case_id: openCase.id, author_id: personId(after.asignar_a) ?? people.get(demo.administrador.nombre) ?? null, body: after.nota });
    }
  }
}

// 6. Historial (sin Claude).
for (const item of demo.historial) {
  const openedAt = new Date(nowMs - item.dias_atras * 86_400_000);
  const created = await inbound({ channel: item.canal, identifier: item.identificador, name: item.contacto, text: item.mensaje, at: openedAt });
  sequence += 1;
  await admin.from("messages").insert({
    organization_id: orgId,
    conversation_id: created.conversationId,
    direction: "outbound",
    sender: "agent",
    type: "text",
    body: item.respuesta,
    status: "sent",
    external_id: `demo-hist-${orgId.slice(0, 8)}-${sequence}`,
    provider_timestamp: new Date(openedAt.getTime() + 60_000).toISOString(),
  });
  await admin.from("conversations").update({ last_message_at: new Date(openedAt.getTime() + 60_000).toISOString() }).eq("id", created.conversationId);
  const { data: conv } = await admin.from("conversations").select("contact_id").eq("id", created.conversationId).single();
  const resolved = item.estado === "resolved";
  const { error } = await admin.from("cases").insert({
    organization_id: orgId,
    contact_id: conv?.contact_id ?? fail("Falta el contacto"),
    conversation_id: created.conversationId,
    title: item.titulo,
    sector_id: sectorId(item.sector),
    unit_id: unitId(item.unidad),
    status: item.estado,
    priority: item.prioridad,
    summary: item.resumen ?? null,
    resolution: item.resolucion ?? null,
    assigned_to: personId(item.asignar_a),
    opened_at: openedAt.toISOString(),
    resolved_at: resolved ? new Date(openedAt.getTime() + item.horas_para_resolver * 3_600_000).toISOString() : null,
  });
  if (error) fail(`No se pudo crear el caso "${item.titulo}": ${error.message}`);
}
console.log(`Historial: ${demo.historial.length} casos de los últimos días.`);

// 7. Finanzas (sin Claude): movimientos cobrados y pagados de cada mes y las partidas pendientes.
if (demo.finanzas) {
  const finance = demo.finanzas;
  // Variación fija por posición (sin azar): la demo da lo mismo cada vez que se arma.
  const wobble = (seed: number) => {
    const x = Math.sin(seed * 12.9898) * 43758.5453;
    return x - Math.floor(x);
  };
  const isoDay = (date: Date) => date.toISOString().slice(0, 10);
  const today = new Date(nowMs);
  const rows: Database["public"]["Tables"]["finance_movements"]["Insert"][] = [];
  finance.categorias.forEach((category, categoryIndex) => {
    for (let offset = finance.meses - 1; offset >= 0; offset -= 1) {
      const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - offset, 1));
      const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
      // El mes en curso va hasta hoy: solo lleva la parte proporcional.
      const lastDay = offset === 0 ? today.getUTCDate() : daysInMonth;
      const share = lastDay / daysInMonth;
      const variation = 0.85 + wobble(categoryIndex * 31 + offset) * 0.3;
      const count = Math.max(1, Math.round(category.movimientos_por_mes * share * (category.monto_fijo ? variation : 1)));
      const amount = category.monto_fijo ?? Math.round(((category.mensual ?? 0) * share * variation) / count);
      for (let index = 0; index < count; index += 1) {
        const day = 1 + Math.floor(wobble(categoryIndex * 97 + offset * 13 + index) * lastDay);
        rows.push({
          organization_id: orgId,
          kind: category.tipo === "ingreso" ? "income" : "expense",
          category: category.nombre,
          // Número de operación propio de cada movimiento ("1/2" se confundía con cuotas de una misma operación).
          description: `${category.nombre} · N.º ${String(1000 + categoryIndex * 400 + (finance.meses - 1 - offset) * 40 + index + 1)}`,
          counterparty: category.contraparte ?? null,
          amount,
          occurred_on: isoDay(new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), Math.min(day, lastDay)))),
          status: "paid",
        });
      }
    }
  });
  for (const item of finance.pendientes) {
    const due = new Date(nowMs + item.vence_en_dias * 86_400_000);
    rows.push({
      organization_id: orgId,
      kind: item.tipo === "ingreso" ? "income" : "expense",
      category: item.categoria ?? (item.tipo === "ingreso" ? "Cuentas por cobrar" : "Cuentas por pagar"),
      description: item.descripcion,
      counterparty: item.contraparte ?? null,
      amount: item.monto,
      occurred_on: isoDay(new Date(due.getTime() - 30 * 86_400_000)),
      due_on: isoDay(due),
      status: "pending",
    });
  }
  const { error } = await admin.from("finance_movements").insert(rows);
  if (error) fail(`No se pudieron cargar las finanzas: ${error.message}`);
  console.log(`Finanzas: ${rows.length} movimientos.`);
}

const { data: calls } = await admin.from("ai_calls").select("input_tokens, output_tokens").eq("organization_id", orgId);
const tokens = (calls ?? []).reduce((sum, call) => ({ input: sum.input + (call.input_tokens ?? 0), output: sum.output + (call.output_tokens ?? 0) }), { input: 0, output: 0 });
console.log(`Demo lista: ${demo.nombre_organizacion} (${slug}). Claude: ${calls?.length ?? 0} llamadas, ${tokens.input} tokens de entrada y ${tokens.output} de salida.`);
console.log(ownerAccount ? `Entrá con tu cuenta (${ownerAccount.email}).` : `Entrá con el usuario de ${envKey}_EMAIL.`);
