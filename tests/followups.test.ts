import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildAttentionSettings, syncAttentionConfig } from "../src/lib/client-config/attention";
import { parseClientConfig, syncSectorsAndUnits } from "../src/lib/client-config/load";
import { DEFAULT_FOLLOWUP_TEXT, followupText, runFollowups } from "../src/lib/followups/run";
import { adminClient, randomId } from "./helpers/supabase-test";

// Seguimientos contra el proyecto de desarrollo, con un "Telegram" falso y un reloj controlado. Datos
// inventados (clientes/_plantilla): horas [24, 48, 72], horario lunes a viernes de 8 a 15 (Buenos Aires).

const parsed = parseClientConfig(readFileSync("clientes/_plantilla/sectores-y-reglas.yaml", "utf8"));
if (!parsed.ok) throw new Error(parsed.errors.join("; "));

describe("texto del seguimiento", () => {
  it("completa las variables y usa un texto por defecto", () => {
    const settings = buildAttentionSettings(parsed.config, {});
    expect(settings.followups).toMatchObject({ active: true, hours: [24, 48, 72] });
    expect(followupText(settings)).toContain("Sofía de Cooperativa Ejemplo");

    const withoutText = { ...settings, followups: { ...settings.followups, text: null } };
    expect(followupText(withoutText)).toBe(
      DEFAULT_FOLLOWUP_TEXT.replace("{{nombre_agente}}", "Sofía").replace("{{nombre_organizacion}}", "Cooperativa Ejemplo"),
    );
  });
});

const admin = adminClient();
const runId = randomId();
const tokenVar = `ZZ_TEST_TOKEN_${runId}`;
let organizationId = "";
let channelId = "";
let counter = 700;
let seed = 0;

// Lunes 2026-10-26 12:00 en Buenos Aires = 15:00 UTC.
const start = new Date("2026-10-26T15:00:00Z");
const hoursLater = (hours: number) => new Date(start.getTime() + hours * 3_600_000);

function fakeTelegram(sent: string[] = []) {
  return async (_url: string, init: RequestInit) => {
    counter += 1;
    sent.push(String(init.body));
    return new Response(JSON.stringify({ ok: true, result: { message_id: counter, date: Math.floor(Date.now() / 1000) } }), { status: 200 });
  };
}

// Un caso que espera al asociado desde `start`. Se crea con el cliente de servicio y se mueve el
// historial a esa hora para controlar el reloj.
async function seedWaitingCase() {
  seed += 1;
  const identifier = `8${Date.now().toString().slice(-7)}${seed}`;
  await admin.rpc("ingest_inbound_message", {
    p_organization_id: organizationId,
    p_channel_id: channelId,
    p_channel_type: "telegram",
    p_identifier: identifier,
    p_contact_name: "Ana Prueba",
    p_external_id: `${identifier}:1`,
    p_type: "text",
    p_body: "necesito un prestamo",
    p_provider_timestamp: start.toISOString(),
    p_raw: {},
  });
  const { data: message } = await admin.from("messages").select("conversation_id").eq("external_id", `${identifier}:1`).single();
  const conversationId = message?.conversation_id ?? "";
  // El último mensaje del asociado fue a la hora de inicio.
  await admin.from("conversations").update({ last_inbound_at: start.toISOString() }).eq("id", conversationId);

  const { data: conversation } = await admin.from("conversations").select("contact_id").eq("id", conversationId).single();
  const { data: caso, error } = await admin
    .from("cases")
    .insert({ organization_id: organizationId, contact_id: conversation?.contact_id ?? "", conversation_id: conversationId, title: `Caso ${seed}`, status: "waiting_contact" })
    .select("id")
    .single();
  if (error || !caso) throw new Error(`No se pudo crear el caso: ${error?.message}`);

  // El historial dice que quedó esperando a la hora de inicio.
  await admin.from("case_events").update({ created_at: start.toISOString() }).eq("case_id", caso.id);
  await admin.from("case_events").insert({
    organization_id: organizationId,
    case_id: caso.id,
    actor_type: "agent",
    event_type: "status_changed",
    data: { from: "new", to: "waiting_contact" },
    created_at: start.toISOString(),
  });

  return { caseId: caso.id, conversationId };
}

// Mensajes que el agente le mandó a una conversación. Mirar solo la propia: otros casos de la misma
// organización pueden tener seguimientos vencidos y salir en la misma pasada.
async function outboundCount(conversationId: string) {
  const { count } = await admin.from("messages").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId).eq("direction", "outbound");
  return count ?? 0;
}

async function followupsOf(caseId: string) {
  const { data } = await admin.from("followups").select("step_hours, status, due_at, message_id").eq("case_id", caseId).order("step_hours");
  return data ?? [];
}

// Los casos de otras pruebas no deben influir: se corre el trabajador y se mira solo el caso propio.
async function run(now: Date, sent: string[] = []) {
  return runFollowups(admin, { now, fetchImpl: fakeTelegram(sent) });
}

beforeAll(async () => {
  process.env[tokenVar] = "123456:token-de-prueba";

  const { data: org, error } = await admin
    .from("organizations")
    .insert({ slug: `zz-test-${runId}-seg`, name: "Prueba Seguimientos" })
    .select("id")
    .single();
  if (error || !org) throw new Error(`No se pudo crear la organización: ${error?.message}`);
  organizationId = org.id;

  const { data: channel } = await admin
    .from("channels")
    .insert({ organization_id: organizationId, type: "telegram", name: "Canal de prueba", external_id: `zz-test-${runId}-tg`, secret_ref: tokenVar })
    .select("id")
    .single();
  channelId = channel?.id ?? "";

  await syncSectorsAndUnits(admin, organizationId, parsed.config);
  await syncAttentionConfig(admin, organizationId, parsed.config, { prompt: "Sos {{nombre_agente}}.", knowledge: {} });
  await admin.from("agents").insert({ organization_id: organizationId, kind: "attention", name: "Sofía", is_enabled: true });
});

afterAll(async () => {
  delete process.env[tokenVar];
  await admin.from("organizations").delete().eq("id", organizationId);
});

describe("seguimientos", () => {
  it("programa un recordatorio por cada hora, contada desde que el caso quedó esperando", async () => {
    const { caseId } = await seedWaitingCase();
    await run(hoursLater(1));

    const followups = await followupsOf(caseId);
    expect(followups.map((item) => item.step_hours)).toEqual([24, 48, 72]);
    expect(followups.map((item) => new Date(item.due_at).toISOString())).toEqual([hoursLater(24), hoursLater(48), hoursLater(72)].map((date) => date.toISOString()));
    expect(followups.every((item) => item.status === "pending")).toBe(true);

    // Una segunda pasada no duplica.
    await run(hoursLater(2));
    expect(await followupsOf(caseId)).toHaveLength(3);
  });

  it("envía el recordatorio vencido por el chat y lo marca como enviado", async () => {
    const { caseId, conversationId } = await seedWaitingCase();
    await run(hoursLater(1));

    const sent: string[] = [];
    // A las 24 h (lunes 12:00 + 1 día = martes 12:00 en Buenos Aires: dentro del horario).
    // El asociado escribió hace 24 h: Telegram no tiene ventana, así que sale igual.
    await run(hoursLater(24.5), sent);
    expect(await outboundCount(conversationId)).toBe(1);

    const followups = await followupsOf(caseId);
    expect(followups.find((item) => item.step_hours === 24)).toMatchObject({ status: "sent" });
    expect(followups.find((item) => item.step_hours === 24)?.message_id).not.toBeNull();
    expect(followups.find((item) => item.step_hours === 48)?.status).toBe("pending");

    const { data: message } = await admin.from("messages").select("sender, body, status").eq("conversation_id", conversationId).eq("direction", "outbound").single();
    expect(message).toMatchObject({ sender: "agent", status: "sent" });
    expect(message?.body).toContain("Sofía de Cooperativa Ejemplo");
    expect(sent.some((body) => body.includes("Sofía de Cooperativa Ejemplo"))).toBe(true);
  });

  it("no escribe fuera del horario de atención: queda pendiente hasta que se abra", async () => {
    const { caseId } = await seedWaitingCase();
    await run(hoursLater(1));

    // 24 h + 6 h = martes 18:00 en Buenos Aires: cerrado.
    await run(hoursLater(30));
    expect((await followupsOf(caseId)).find((item) => item.step_hours === 24)?.status).toBe("pending");

    // Miércoles 09:00 en Buenos Aires: abierto, sale.
    await run(hoursLater(45));
    expect((await followupsOf(caseId)).find((item) => item.step_hours === 24)?.status).toBe("sent");
  });

  it("cancela los recordatorios si el asociado escribe", async () => {
    const { caseId, conversationId } = await seedWaitingCase();
    await run(hoursLater(1));

    await admin.from("conversations").update({ last_inbound_at: hoursLater(10).toISOString() }).eq("id", conversationId);
    const result = await run(hoursLater(11));
    expect(result.cancelled).toBeGreaterThanOrEqual(3);

    expect((await followupsOf(caseId)).every((item) => item.status === "cancelled")).toBe(true);
    // Y aunque pase el tiempo, no sale nada.
    await run(hoursLater(25));
    expect(await outboundCount(conversationId)).toBe(0);
  });

  it("cancela los recordatorios si el caso deja de esperar al asociado", async () => {
    const { caseId } = await seedWaitingCase();
    await run(hoursLater(1));

    await admin.from("cases").update({ status: "in_progress" }).eq("id", caseId);
    await run(hoursLater(2));
    expect((await followupsOf(caseId)).every((item) => item.status === "cancelled")).toBe(true);
  });

  it("no hace nada si el agente está apagado o los seguimientos están desactivados", async () => {
    const { caseId } = await seedWaitingCase();
    await admin.from("agents").update({ is_enabled: false }).eq("organization_id", organizationId).eq("kind", "attention");
    await run(hoursLater(1));
    expect(await followupsOf(caseId)).toHaveLength(0);
    await admin.from("agents").update({ is_enabled: true }).eq("organization_id", organizationId).eq("kind", "attention");
  });

  it("si un operador tomó el chat, el recordatorio no sale", async () => {
    const { caseId, conversationId } = await seedWaitingCase();
    await run(hoursLater(1));
    await admin.from("conversations").update({ ai_enabled: false }).eq("id", conversationId);

    await run(hoursLater(24.5));
    expect(await outboundCount(conversationId)).toBe(0);
    expect((await followupsOf(caseId)).find((item) => item.step_hours === 24)?.status).toBe("pending");
  });

  it("al volver a esperar, los recordatorios se reinician", async () => {
    const { caseId } = await seedWaitingCase();
    await run(hoursLater(1));
    await admin.from("cases").update({ status: "in_progress" }).eq("id", caseId);
    await run(hoursLater(2));

    // Vuelve a esperar a las 100 h (martes 4 días después, 16:00 en Buenos Aires).
    await admin.from("cases").update({ status: "waiting_contact" }).eq("id", caseId);
    await admin.from("case_events").update({ created_at: hoursLater(100).toISOString() }).eq("case_id", caseId).eq("event_type", "status_changed").gt("created_at", new Date(Date.now() - 60_000).toISOString());
    await run(hoursLater(101));

    const followups = await followupsOf(caseId);
    expect(followups.every((item) => item.status === "pending")).toBe(true);
    expect(new Date(followups.find((item) => item.step_hours === 24)?.due_at ?? 0).toISOString()).toBe(hoursLater(124).toISOString());
  });
});
