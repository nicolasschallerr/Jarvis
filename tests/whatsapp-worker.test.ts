import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { processPendingMessages } from "../src/lib/inbound/process";
import { adminClient, randomId } from "./helpers/supabase-test";

// Prueba de integración del procesamiento de mensajes entrantes contra el proyecto de desarrollo.
// Crea su propia organización y canal con el prefijo "zz-test-" y los borra al terminar.

const admin = adminClient();
const runId = randomId();
const phoneNumberId = `zz-test-${runId}`;
const waId = `zz${runId}0001`;

let organizationId = "";
let channelId = "";

function eventPayload(messageId: string, timestamp: number, text = "hola", name = "Ana Prueba") {
  return {
    metadata: { display_phone_number: "15550000000", phone_number_id: phoneNumberId },
    contact: { profile: { name }, wa_id: waId },
    message: { from: waId, id: messageId, timestamp: String(timestamp), type: "text", text: { body: text } },
  };
}

async function enqueue(messageId: string, timestamp: number, text?: string, name?: string) {
  const { error } = await admin.from("webhook_events").insert({
    organization_id: organizationId,
    channel_type: "whatsapp",
    dedupe_key: `msg:${messageId}`,
    payload: eventPayload(messageId, timestamp, text, name),
  });
  if (error) throw new Error(`No se pudo encolar: ${error.message}`);
}

// Procesa todo lo pendiente de esta organización (el lote puede traer eventos de otras pruebas).
// OJO: el trabajador real (pg_cron → Vercel, cada 10 s) también toma eventos de esta base, así que
// una parte puede procesarla él. Por eso se espera a que no quede nada pendiente de esta organización
// y las pruebas comprueban el ESTADO en la base, no cuántos eventos procesó esta llamada.
async function drain() {
  const result = await processPendingMessages(admin, 50);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { data: pending } = await admin
      .from("webhook_events")
      .select("id")
      .eq("organization_id", organizationId)
      .is("processed_at", null)
      .is("error", null);
    if (!pending?.length) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return result;
}

beforeAll(async () => {
  const { data: org, error } = await admin
    .from("organizations")
    .insert({ slug: `zz-test-${runId}`, name: "Prueba Worker" })
    .select("id")
    .single();
  if (error || !org) throw new Error(`No se pudo crear la organización: ${error?.message}`);
  organizationId = org.id;

  const { data: channel, error: channelError } = await admin
    .from("channels")
    .insert({ organization_id: organizationId, type: "whatsapp", name: "Canal de prueba", external_id: phoneNumberId })
    .select("id")
    .single();
  if (channelError || !channel) throw new Error(`No se pudo crear el canal: ${channelError?.message}`);
  channelId = channel.id;
});

afterAll(async () => {
  await admin.from("webhook_events").delete().eq("organization_id", organizationId);
  await admin.from("organizations").delete().eq("id", organizationId);
});

describe("procesamiento de mensajes entrantes", () => {
  const base = 1_800_000_000; // segundos; cualquier hora fija sirve

  it("crea contacto, conversación, mensaje y ventana de crédito", async () => {
    await enqueue(`wamid.zz-${runId}-1`, base, "quiero un préstamo");
    await drain();

    const { data: identity } = await admin
      .from("contact_identities")
      .select("contact_id")
      .eq("organization_id", organizationId)
      .eq("identifier", waId)
      .single();
    expect(identity?.contact_id).toBeTruthy();

    const { data: contact } = await admin.from("contacts").select("display_name").eq("id", identity?.contact_id ?? "").single();
    expect(contact?.display_name).toBe("Ana Prueba");

    const { data: messages } = await admin
      .from("messages")
      .select("body, direction, sender, type, provider_timestamp")
      .eq("organization_id", organizationId);
    expect(messages).toHaveLength(1);
    expect(messages?.[0]).toMatchObject({ body: "quiero un préstamo", direction: "inbound", sender: "contact", type: "text" });

    const { data: windows } = await admin.from("conversation_windows").select("credits, initiated_by").eq("organization_id", organizationId);
    expect(windows).toHaveLength(1);
    expect(windows?.[0]).toMatchObject({ credits: 1, initiated_by: "contact" });

    const { data: event } = await admin.from("webhook_events").select("processed_at, error").eq("dedupe_key", `msg:wamid.zz-${runId}-1`).single();
    expect(event?.processed_at).not.toBeNull();
    expect(event?.error).toBeNull();
  });

  it("no cobra otro crédito por más mensajes dentro de las 24 horas", async () => {
    await enqueue(`wamid.zz-${runId}-2`, base + 3600, "segundo mensaje");
    await enqueue(`wamid.zz-${runId}-3`, base + 7200, "tercer mensaje");
    await drain();

    const { data: windows } = await admin.from("conversation_windows").select("id").eq("organization_id", organizationId);
    expect(windows).toHaveLength(1);

    const { data: messages } = await admin.from("messages").select("id").eq("organization_id", organizationId);
    expect(messages).toHaveLength(3);
  });

  it("abre una ventana nueva pasadas las 24 horas", async () => {
    await enqueue(`wamid.zz-${runId}-4`, base + 25 * 3600, "al día siguiente");
    await drain();

    const { data: windows } = await admin.from("conversation_windows").select("id").eq("organization_id", organizationId);
    expect(windows).toHaveLength(2);
  });

  it("un mensaje viejo que llega tarde no retrocede el reloj de la conversación", async () => {
    await enqueue(`wamid.zz-${runId}-5`, base + 10, "mensaje viejo");
    await drain();

    const { data: conversation } = await admin
      .from("conversations")
      .select("last_inbound_at")
      .eq("organization_id", organizationId)
      .single();
    expect(new Date(conversation?.last_inbound_at ?? 0).getTime()).toBe((base + 25 * 3600) * 1000);

    // Y tampoco cobra otra ventana: ese momento ya estaba cubierto.
    const { data: windows } = await admin.from("conversation_windows").select("id").eq("organization_id", organizationId);
    expect(windows).toHaveLength(2);
  });

  it("reprocesar el mismo mensaje no duplica nada", async () => {
    const { data: before } = await admin.from("messages").select("id").eq("organization_id", organizationId);

    // Un reproceso real: el mismo mensaje llega con otra clave de evento.
    await admin.from("webhook_events").insert({
      organization_id: organizationId,
      channel_type: "whatsapp",
      dedupe_key: `msg:wamid.zz-${runId}-1:reproceso`,
      payload: eventPayload(`wamid.zz-${runId}-1`, base, "quiero un préstamo"),
    });
    await drain();

    const { data: reprocessed } = await admin
      .from("webhook_events")
      .select("processed_at, error")
      .eq("dedupe_key", `msg:wamid.zz-${runId}-1:reproceso`)
      .single();
    expect(reprocessed?.processed_at).not.toBeNull();
    expect(reprocessed?.error).toBeNull();

    const { data: after } = await admin.from("messages").select("id").eq("organization_id", organizationId);
    expect(after).toHaveLength(before?.length ?? -1);

    const { data: contacts } = await admin.from("contacts").select("id").eq("organization_id", organizationId);
    expect(contacts).toHaveLength(1);
  });

  it("un evento inválido queda con su error, sin frenar a los demás", async () => {
    await admin.from("webhook_events").insert({
      organization_id: organizationId,
      channel_type: "whatsapp",
      dedupe_key: `msg:wamid.zz-${runId}-malo`,
      payload: { metadata: { phone_number_id: phoneNumberId }, message: { id: `wamid.zz-${runId}-malo` } },
    });
    await enqueue(`wamid.zz-${runId}-6`, base + 26 * 3600, "este sí es válido");

    const result = await drain();
    expect(result.failed).toBe(1);
    expect(result.processed).toBeGreaterThanOrEqual(1);

    const { data: bad } = await admin
      .from("webhook_events")
      .select("processed_at, error, attempts")
      .eq("dedupe_key", `msg:wamid.zz-${runId}-malo`)
      .single();
    expect(bad?.processed_at).toBeNull();
    expect(bad?.error).toContain("Faltan");
    expect(bad?.attempts).toBe(1);

    const { data: good } = await admin.from("messages").select("id").eq("external_id", `wamid.zz-${runId}-6`);
    expect(good).toHaveLength(1);
  });

  it("descarta un evento tras 5 intentos fallidos", async () => {
    const key = `msg:wamid.zz-${runId}-malo`;
    // Simula que pasaron más de 5 minutos entre intentos.
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      await admin
        .from("webhook_events")
        .update({ claimed_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() })
        .eq("dedupe_key", key);
      await drain();
    }

    const { data: bad } = await admin.from("webhook_events").select("attempts, processed_at, error").eq("dedupe_key", key).single();
    expect(bad?.attempts).toBe(5);

    // El sexto intento ya no lo procesa: lo descarta con el motivo.
    await admin
      .from("webhook_events")
      .update({ claimed_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() })
      .eq("dedupe_key", key);
    await drain();

    const { data: dead } = await admin.from("webhook_events").select("processed_at, error").eq("dedupe_key", key).single();
    expect(dead?.processed_at).not.toBeNull();
    expect(dead?.error).toContain("máximo de intentos");
  });

  it("el canal queda asociado a la conversación", async () => {
    const { data } = await admin.from("conversations").select("channel_id").eq("organization_id", organizationId).single();
    expect(data?.channel_id).toBe(channelId);
  });
});
