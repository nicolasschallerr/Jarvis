import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { audienceCount, cancelBroadcast, createBroadcast, runBroadcasts, scheduleBroadcast } from "../src/lib/broadcasts/service";
import { cleanLocality, localToUtc, missingVariables, segmentOf, valuesForContact } from "../src/lib/broadcasts/rules";
import { consentStatus, handleOptOutKeyword, isOptOutKeyword, setConsent } from "../src/lib/consent";
import { adminClient, randomId } from "./helpers/supabase-test";

// Envíos masivos con consentimiento (ADR-038). Meta y Telegram son falsos: no se manda nada real. Datos inventados;
// organizaciones propias "zz-test-".

describe("reglas de los envíos", () => {
  it("la variable {{1}} o {{nombre}} es el nombre; las demás hay que completarlas", () => {
    const body = "Hola {{1}}, novedades de {{2}} en {{ciudad}}";
    expect(missingVariables(body, {})).toEqual(["2", "ciudad"]);
    expect(missingVariables(body, { "2": "la Cooperativa", ciudad: "Villa Ejemplo" })).toEqual([]);
    expect(missingVariables("Hola {{nombre}}", {})).toEqual([]);
  });

  it("completa el nombre de cada contacto con su primer nombre; sin nombre no se envía", () => {
    expect(valuesForContact("Hola {{1}}, de {{2}}", { "2": "la Cooperativa" }, "Ana María Prueba")).toEqual({ "1": "Ana", "2": "la Cooperativa" });
    expect(valuesForContact("Hola {{1}}", {}, null)).toBeNull();
    expect(valuesForContact("Hola {{1}}", {}, "   ")).toBeNull();
    expect(valuesForContact("Sin variables", {}, null)).toEqual({});
  });

  it("la localidad no puede llevar comodines de la base", () => {
    expect(cleanLocality("100%_Villa\\Ejemplo")).toBe("100 Villa Ejemplo");
    expect(segmentOf({ locality: "  Villa  " })).toEqual({ locality: "Villa" });
    expect(segmentOf({ locality: "" })).toEqual({});
    expect(segmentOf(null)).toEqual({});
  });
});

describe("fecha programada", () => {
  it("la hora escrita es la de la organización, no la del servidor", () => {
    expect(localToUtc("2026-10-30T09:00", "America/Argentina/Buenos_Aires")?.toISOString()).toBe("2026-10-30T12:00:00.000Z");
    // Con horario de verano: verano (UTC-4) e invierno (UTC-5).
    expect(localToUtc("2026-07-01T09:00", "America/New_York")?.toISOString()).toBe("2026-07-01T13:00:00.000Z");
    expect(localToUtc("2026-12-01T09:00", "America/New_York")?.toISOString()).toBe("2026-12-01T14:00:00.000Z");
  });

  it("rechaza lo que no es una fecha y hora", () => {
    expect(localToUtc("", "America/Argentina/Buenos_Aires")).toBeNull();
    expect(localToUtc("mañana a la tarde", "America/Argentina/Buenos_Aires")).toBeNull();
    expect(localToUtc("2026-10-30", "America/Argentina/Buenos_Aires")).toBeNull();
  });
});

describe("consentimiento: reglas", () => {
  it("el estado sale de las dos fechas", () => {
    expect(consentStatus({ opted_in_at: null, opted_out_at: null })).toBe("none");
    expect(consentStatus({ opted_in_at: "2026-10-01T00:00:00Z", opted_out_at: null })).toBe("accepted");
    expect(consentStatus({ opted_in_at: "2026-10-01T00:00:00Z", opted_out_at: "2026-10-02T00:00:00Z" })).toBe("withdrawn");
    // Se dio de baja y después volvió a aceptar.
    expect(consentStatus({ opted_in_at: "2026-10-03T00:00:00Z", opted_out_at: "2026-10-02T00:00:00Z" })).toBe("accepted");
    expect(consentStatus({ opted_in_at: null, opted_out_at: "2026-10-02T00:00:00Z" })).toBe("withdrawn");
  });

  it("reconoce frases inequívocas de baja de novedades, y no confunde 'baja' de un servicio", () => {
    for (const phrase of ["STOP", "stop.", "Stop!", "No recibir más", "no quiero recibir más mensajes", "  DEJAR DE RECIBIR  "]) expect(isOptOutKeyword(phrase)).toBe(true);
    for (const phrase of ["baja", "quiero la baja", "quiero darme de baja del gimnasio", "no paren de mandarme info", "stop por favor no se qué hacer", "", null]) expect(isOptOutKeyword(phrase)).toBe(false);
  });
});

const admin = adminClient();
const runId = randomId();
const tokenVar = `WHATSAPP_ACCESS_TOKEN_ZZTEST_${runId.toUpperCase()}`;
const telegramVar = `CHANNEL_TOKEN_ZZTEST_${runId.toUpperCase()}`;
const orgIds: string[] = [];
const userIds: string[] = [];
let orgA = "";
let orgB = "";
let boss = "";
let whatsappChannel = "";
let templateId = "";
let unapprovedTemplateId = "";
const contacts: Record<string, string> = {};

const metaCalls: Array<{ to: string; text: string; name: string; params: string[] }> = [];
// Contador aparte de la lista (que se vacía entre pruebas): los ids de mensaje de Meta no se pueden repetir.
let metaIds = 0;
function fakeMeta(failFor: string[] = [], failStatus = 500) {
  return async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { to: string; template: { name: string; components?: Array<{ parameters: Array<{ text: string }> }> } };
    const params = body.template.components?.[0]?.parameters.map((parameter) => parameter.text) ?? [];
    if (failFor.some((fragment) => body.to.endsWith(fragment))) return new Response(JSON.stringify({ error: { message: "Meta caído", code: 1 } }), { status: failStatus });
    metaCalls.push({ to: body.to, text: params.join("|"), name: body.template.name, params });
    return new Response(JSON.stringify({ messages: [{ id: `wamid.${runId}.${(metaIds += 1)}` }] }), { status: 200 });
  };
}

async function newContact(org: string, key: string, options: { name: string | null; locality?: string; consent?: "accepted" | "withdrawn" | "none"; whatsapp?: boolean; identifier?: string }) {
  const { data, error } = await admin
    .from("contacts")
    .insert({
      organization_id: org,
      display_name: options.name,
      locality: options.locality ?? null,
      opted_in_at: options.consent === "accepted" || options.consent === "withdrawn" ? new Date(Date.now() - 2 * 86_400_000).toISOString() : null,
      opted_out_at: options.consent === "withdrawn" ? new Date(Date.now() - 86_400_000).toISOString() : null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`No se pudo crear el contacto ${key}: ${error?.message}`);
  contacts[key] = data.id;
  const { error: identityError } = await admin.from("contact_identities").insert({
    organization_id: org,
    contact_id: data.id,
    channel_type: options.whatsapp === false ? "telegram" : "whatsapp",
    identifier: options.identifier ?? `54934${Math.floor(Math.random() * 1e8).toString().padStart(8, "0")}`,
  });
  if (identityError) throw new Error(`No se pudo crear la identidad de ${key}: ${identityError.message}`);
}

beforeAll(async () => {
  process.env[tokenVar] = "token-de-prueba";
  process.env[telegramVar] = "123456:token-de-prueba";

  for (const label of ["a", "b"]) {
    const { data, error } = await admin.from("organizations").insert({ slug: `zz-test-${runId}-env-${label}`, name: `Prueba Envíos ${label}` }).select("id").single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  [orgA = "", orgB = ""] = orgIds;

  const { data: user, error: userError } = await admin.auth.admin.createUser({ email: `zz-test-${runId}-env@example.test`, password: `clave-${runId}-larga-123`, email_confirm: true });
  if (userError || !user.user) throw new Error(`No se pudo crear el usuario: ${userError?.message}`);
  boss = user.user.id;
  userIds.push(boss);
  await admin.from("profiles").insert({ id: boss, organization_id: orgA, full_name: "Jefa Prueba", role: "superadmin" });

  const { data: channel } = await admin
    .from("channels")
    .insert({ organization_id: orgA, type: "whatsapp", name: "WhatsApp envíos", external_id: `99${Date.now()}`, secret_ref: tokenVar })
    .select("id")
    .single();
  whatsappChannel = channel?.id ?? "";

  const { data: templates, error: templateError } = await admin
    .from("message_templates")
    .insert([
      { organization_id: orgA, channel_id: whatsappChannel, name: "novedades", language: "es_AR", body: "Hola {{1}}, tenemos novedades de {{2}}.", meta_status: "approved" as const },
      { organization_id: orgA, channel_id: whatsappChannel, name: "borrador_meta", language: "es_AR", body: "Hola {{1}}", meta_status: "submitted" as const },
    ])
    .select("id, name");
  if (templateError || !templates) throw new Error(`No se pudieron crear las plantillas: ${templateError?.message}`);
  templateId = templates.find((row) => row.name === "novedades")?.id ?? "";
  unapprovedTemplateId = templates.find((row) => row.name === "borrador_meta")?.id ?? "";

  await newContact(orgA, "ana", { name: "Ana Prueba", locality: "Villa Ejemplo", consent: "accepted", identifier: "5493420000001" });
  await newContact(orgA, "beto", { name: "Beto Prueba", locality: "Villa Ejemplo", consent: "accepted", identifier: "5493420000002" });
  await newContact(orgA, "carla", { name: "Carla Prueba", locality: "Otra Ciudad", consent: "accepted", identifier: "5493420000003" });
  await newContact(orgA, "diego", { name: "Diego Prueba", consent: "none", identifier: "5493420000004" });
  await newContact(orgA, "elena", { name: "Elena Prueba", consent: "withdrawn", identifier: "5493420000005" });
  await newContact(orgA, "sin-whatsapp", { name: "Fede Prueba", consent: "accepted", whatsapp: false });
  await newContact(orgA, "sin-nombre", { name: null, consent: "accepted", identifier: "5493420000007" });
  await newContact(orgA, "unido", { name: "Gabi Prueba", consent: "accepted", identifier: "5493420000008" });
  await admin.from("contacts").update({ merged_into: contacts.ana, merged_at: new Date().toISOString() }).eq("id", contacts.unido ?? "");
  await newContact(orgB, "ajeno", { name: "Otro Prueba", consent: "accepted", identifier: "5493420000009" });
});

afterAll(async () => {
  delete process.env[tokenVar];
  delete process.env[telegramVar];
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

describe("audiencia", () => {
  it("solo contactos con consentimiento vigente, con WhatsApp, sin unidos y de la propia organización", async () => {
    // ana, beto, carla y sin-nombre (el nombre se revisa al enviar).
    expect(await audienceCount(admin, orgA, {})).toBe(4);
    expect(await audienceCount(admin, orgA, { locality: "villa" })).toBe(2);
    expect(await audienceCount(admin, orgA, { locality: "no existe" })).toBe(0);
    expect(await audienceCount(admin, orgB, {})).toBe(1);
  });
});

describe("crear y programar", () => {
  it("valida nombre, plantilla aprobada, variables y audiencia", async () => {
    const base = { organizationId: orgA, actorId: boss, name: "Novedades de octubre", templateId, variables: { "2": "la Cooperativa" }, locality: "" };
    expect((await createBroadcast(admin, { ...base, name: "ab" })).ok).toBe(false);
    expect(await createBroadcast(admin, { ...base, templateId: unapprovedTemplateId })).toEqual({ ok: false, error: "Solo se pueden enviar plantillas aprobadas por Meta." });
    expect(await createBroadcast(admin, { ...base, variables: {} })).toEqual({ ok: false, error: "Completá {{2}}." });
    expect((await createBroadcast(admin, { ...base, locality: "no existe" })).ok).toBe(false);
    // Una plantilla de otra organización no existe para esta.
    expect(await createBroadcast(admin, { ...base, organizationId: orgB })).toEqual({ ok: false, error: "La plantilla no existe." });
  });

  it("crea el borrador con su audiencia y deja registro; programar no se puede dos veces", async () => {
    const created = await createBroadcast(admin, { organizationId: orgA, actorId: boss, name: "Para programar", templateId, variables: { "2": "la Cooperativa" }, locality: "Villa" });
    expect(created).toMatchObject({ ok: true, audience: 2 });
    const id = created.ok ? created.id : "";

    const { data: log } = await admin.from("audit_log").select("action").eq("entity_id", id);
    expect(log?.map((row) => row.action)).toContain("broadcast.created");

    // Una fecha lejana de más no se acepta; una pasada se toma como "ahora".
    const far = new Date(Date.now() + 90 * 86_400_000);
    expect((await scheduleBroadcast(admin, { organizationId: orgA, actorId: boss, broadcastId: id, at: far })).ok).toBe(false);
    expect(await scheduleBroadcast(admin, { organizationId: orgA, actorId: boss, broadcastId: id, at: new Date(Date.now() - 3_600_000) })).toEqual({ ok: true, audience: 2 });
    expect((await scheduleBroadcast(admin, { organizationId: orgA, actorId: boss, broadcastId: id, at: null })).ok).toBe(false);
    // Otra organización no lo ve.
    expect((await cancelBroadcast(admin, { organizationId: orgB, actorId: boss, broadcastId: id })).ok).toBe(false);

    // Dejar este envío cancelado para que no lo tome el trabajador en las pruebas siguientes.
    expect((await cancelBroadcast(admin, { organizationId: orgA, actorId: boss, broadcastId: id })).ok).toBe(true);
  });
});

async function newScheduled(name: string, locality = "") {
  const created = await createBroadcast(admin, { organizationId: orgA, actorId: boss, name, templateId, variables: { "2": "la Cooperativa" }, locality });
  if (!created.ok) throw new Error(created.error);
  const scheduled = await scheduleBroadcast(admin, { organizationId: orgA, actorId: boss, broadcastId: created.id, at: null });
  if (!scheduled.ok) throw new Error(scheduled.error);
  return created.id;
}

const stateOf = async (id: string) => {
  const { data: broadcast } = await admin.from("broadcasts").select("status").eq("id", id).single();
  const { data: recipients } = await admin.from("broadcast_recipients").select("contact_id, status, error, message_id").eq("broadcast_id", id);
  return { status: broadcast?.status, recipients: recipients ?? [] };
};

describe("envío", () => {
  it("envía a quienes corresponde, con su nombre y la variable fija, y termina", async () => {
    metaCalls.length = 0;
    const id = await newScheduled("Envío completo");

    // Lotes de 2: no todos salen en una pasada.
    const first = await runBroadcasts(admin, { fetchImpl: fakeMeta(), batch: 2 });
    expect(first.started).toBeGreaterThanOrEqual(1);
    expect((await stateOf(id)).status).toBe("sending");
    for (let pass = 0; pass < 4; pass += 1) await runBroadcasts(admin, { fetchImpl: fakeMeta(), batch: 2 });

    const state = await stateOf(id);
    expect(state.status).toBe("done");
    expect(state.recipients).toHaveLength(4);
    expect(state.recipients.filter((row) => row.status === "sent")).toHaveLength(3);
    const failed = state.recipients.filter((row) => row.status === "failed");
    expect(failed).toHaveLength(1);
    expect(failed[0]?.error).toContain("no tiene nombre");

    const texts = metaCalls.map((call) => call.text).sort();
    expect(texts).toEqual(["Ana|la Cooperativa", "Beto|la Cooperativa", "Carla|la Cooperativa"]);
    expect(metaCalls.every((call) => call.name === "novedades")).toBe(true);

    // El mensaje quedó en la conversación de cada uno, como mensaje del sistema, con la plantilla usada.
    const { data: messages } = await admin.from("messages").select("sender, status, template_id, body").eq("template_id", templateId).eq("sender", "system");
    expect(messages?.length).toBeGreaterThanOrEqual(3);
    expect(messages?.some((message) => message.body === "Hola Ana, tenemos novedades de la Cooperativa.")).toBe(true);
  });

  it("no les escribe a quienes no aceptaron, se dieron de baja, no tienen WhatsApp o están unidos", async () => {
    const { data } = await admin.from("conversations").select("contact_id").eq("channel_id", whatsappChannel);
    const touched = new Set((data ?? []).map((row) => row.contact_id));
    for (const key of ["diego", "elena", "sin-whatsapp", "unido", "sin-nombre"]) expect(touched.has(contacts[key] ?? "")).toBe(false);
  });

  it("si se da de baja entre que se armó la lista y el envío, ya no recibe", async () => {
    metaCalls.length = 0;
    const id = await newScheduled("Con baja a mitad", "Villa");
    await runBroadcasts(admin, { fetchImpl: fakeMeta(), batch: 1 });
    const pending = (await stateOf(id)).recipients.filter((row) => row.status === "queued");
    expect(pending).toHaveLength(1);
    const lastContact = pending[0]?.contact_id ?? "";
    await setConsent(admin, { organizationId: orgA, contactId: lastContact, actorId: null, action: "withdraw", source: "pidió no recibir más" });

    await runBroadcasts(admin, { fetchImpl: fakeMeta(), batch: 5 });
    const state = await stateOf(id);
    expect(state.status).toBe("done");
    const skipped = state.recipients.find((row) => row.contact_id === lastContact);
    expect(skipped).toMatchObject({ status: "failed" });
    expect(skipped?.error).toContain("consentimiento");
    expect(metaCalls).toHaveLength(1);
  });

  it("una falla pasajera de Meta se reintenta; si sigue, se da por fallida con el motivo", async () => {
    metaCalls.length = 0;
    const id = await newScheduled("Con fallas", "Otra");
    // Carla (…0003) falla siempre con un error de Meta.
    for (let pass = 0; pass < 4; pass += 1) await runBroadcasts(admin, { fetchImpl: fakeMeta(["0003"]), batch: 5 });
    const state = await stateOf(id);
    expect(state.status).toBe("done");
    const carla = state.recipients.find((row) => row.contact_id === contacts.carla);
    expect(carla).toMatchObject({ status: "failed" });
    expect(carla?.error).toContain("Meta");
    const { data: attempts } = await admin.from("broadcast_recipients").select("attempts").eq("broadcast_id", id).eq("contact_id", contacts.carla ?? "").single();
    expect(attempts?.attempts).toBe(2);
  });

  it("dos pasadas a la vez no mandan mensajes dobles", async () => {
    // Se renueva el consentimiento de quien se dio de baja en la prueba anterior.
    await admin.from("contacts").update({ opted_out_at: null }).in("id", [contacts.ana ?? "", contacts.beto ?? "", contacts.carla ?? ""]);
    metaCalls.length = 0;
    const id = await newScheduled("En paralelo");
    await Promise.all([runBroadcasts(admin, { fetchImpl: fakeMeta(), batch: 10 }), runBroadcasts(admin, { fetchImpl: fakeMeta(), batch: 10 })]);
    await runBroadcasts(admin, { fetchImpl: fakeMeta(), batch: 10 });

    const sentTo = metaCalls.map((call) => call.to);
    expect(new Set(sentTo).size).toBe(sentTo.length);
    expect((await stateOf(id)).recipients.filter((row) => row.status === "sent")).toHaveLength(3);
  });

  it("cancelar a mitad deja sin enviar lo que faltaba", async () => {
    metaCalls.length = 0;
    // Solo contactos con nombre (localidad "Villa"): el orden de los destinatarios es el de sus ids, no un orden fijo.
    const id = await newScheduled("Se cancela", "Villa");
    await runBroadcasts(admin, { fetchImpl: fakeMeta(), batch: 1 });
    expect((await cancelBroadcast(admin, { organizationId: orgA, actorId: boss, broadcastId: id })).ok).toBe(true);
    await runBroadcasts(admin, { fetchImpl: fakeMeta(), batch: 10 });

    const state = await stateOf(id);
    expect(state.status).toBe("cancelled");
    expect(state.recipients.filter((row) => row.status === "sent")).toHaveLength(1);
    expect(state.recipients.filter((row) => row.error === "Omitido: envío cancelado")).toHaveLength(1);
    expect(metaCalls).toHaveLength(1);
  });
});

describe("registrar consentimiento y baja por palabra clave", () => {
  it("aceptar pide anotar cómo, y deja registro con quién lo anotó", async () => {
    expect((await setConsent(admin, { organizationId: orgA, contactId: contacts.diego ?? "", actorId: boss, action: "give", source: " " })).ok).toBe(false);
    expect((await setConsent(admin, { organizationId: orgB, contactId: contacts.diego ?? "", actorId: boss, action: "give", source: "lo pidió por teléfono" })).ok).toBe(false);
    expect(await setConsent(admin, { organizationId: orgA, contactId: contacts.diego ?? "", actorId: boss, action: "give", source: "lo pidió por teléfono" })).toEqual({ ok: true });

    const { data } = await admin.from("audit_log").select("actor_profile_id, data").eq("action", "contact.consent_given").eq("entity_id", contacts.diego ?? "");
    expect(data).toEqual([{ actor_profile_id: boss, data: { source: "lo pidió por teléfono" } }]);
    expect(await audienceCount(admin, orgA, {})).toBeGreaterThanOrEqual(4);
  });

  it("un mensaje 'STOP' registra la baja, confirma por el mismo chat y no confunde otras frases", async () => {
    const { data: telegram } = await admin
      .from("channels")
      .insert({ organization_id: orgA, type: "telegram", name: "Telegram baja", external_id: `zz-test-${runId}-baja`, secret_ref: telegramVar })
      .select("id")
      .single();
    await newContact(orgA, "tg", { name: "Hugo Prueba", consent: "accepted", whatsapp: false, identifier: `7${Date.now().toString().slice(-8)}` });
    const { error: ingestError } = await admin.rpc("ingest_inbound_message", {
      p_organization_id: orgA,
      p_channel_id: telegram?.id ?? "",
      p_channel_type: "telegram",
      p_identifier: `8${Date.now().toString().slice(-8)}`,
      p_contact_name: "Hugo Prueba",
      p_external_id: `${runId}-baja:1`,
      p_type: "text",
      p_body: "STOP",
      p_provider_timestamp: new Date().toISOString(),
      p_raw: {},
    });
    expect(ingestError).toBeNull();
    const { data: message } = await admin.from("messages").select("id, conversation_id").eq("external_id", `${runId}-baja:1`).single();
    const { data: conversation } = await admin.from("conversations").select("contact_id").eq("id", message?.conversation_id ?? "").single();

    const sent: string[] = [];
    const fakeTelegram = async (_url: string, init: RequestInit) => {
      sent.push(String((JSON.parse(String(init.body)) as { text: string }).text));
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1, date: Math.floor(Date.now() / 1000) } }), { status: 200 });
    };

    expect(await handleOptOutKeyword(admin, { messageId: message?.id ?? "", fetchImpl: fakeTelegram })).toBe(true);
    const { data: contact } = await admin.from("contacts").select("opted_out_at, opted_in_at").eq("id", conversation?.contact_id ?? "").single();
    expect(consentStatus(contact ?? { opted_in_at: null, opted_out_at: null })).toBe("withdrawn");
    expect(sent).toHaveLength(1);
    expect(sent[0]).toContain("no vas a recibir más novedades");

    // Otro mensaje cualquiera no se trata como baja.
    await admin.from("messages").update({ body: "quiero la baja del gimnasio" }).eq("id", message?.id ?? "");
    expect(await handleOptOutKeyword(admin, { messageId: message?.id ?? "", fetchImpl: fakeTelegram })).toBe(false);
    expect(sent).toHaveLength(1);
  });
});
