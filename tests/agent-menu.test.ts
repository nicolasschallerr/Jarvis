import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { respondToMessage } from "../src/lib/agent/attention";
import { handoffText, isMenuCommand, sinceLastMenu, type HistoryRow } from "../src/lib/agent/context";
import { createScriptedClient } from "../src/lib/ai/scripted-client";
import { buildAttentionSettings, syncAttentionConfig } from "../src/lib/client-config/attention";
import { parseClientConfig, syncSectorsAndUnits } from "../src/lib/client-config/load";
import { adminClient, randomId } from "./helpers/supabase-test";

// Comando MENÚ y mensaje oficial de derivación. Datos inventados (clientes/_plantilla).

const parsed = parseClientConfig(readFileSync("clientes/_plantilla/sectores-y-reglas.yaml", "utf8"));
if (!parsed.ok) throw new Error(parsed.errors.join("; "));

const MENU = "Menú principal:\n1 · Créditos\n2 · Viajes\n3 · Hablar con un asesor";
const config = {
  ...parsed.config,
  textos_editables: { ...parsed.config.textos_editables, menu_principal: MENU },
  unidades: parsed.config.unidades.map((unit) => (unit.id === "viajes" ? { ...unit, mensaje_derivacion: "Tu consulta de viajes pasó a {{sector}}." } : unit)),
};

describe("comando MENÚ", () => {
  it("lo reconoce con o sin tilde, en cualquier caja y con puntuación", () => {
    for (const text of ["MENÚ", "menu", " Menú ", "MENU!", "¡menú!", "Menú."]) expect(isMenuCommand(text)).toBe(true);
  });

  it("no lo confunde con una frase", () => {
    for (const text of ["el menu por favor", "menú principal", "quiero ver el menú", "", null, undefined]) expect(isMenuCommand(text)).toBe(false);
  });

  const row = (direction: "inbound" | "outbound", body: string): HistoryRow => ({ direction, type: "text", body, transcription: null });

  it("el historial empieza en el último MENÚ y lo conserva junto con el menú", () => {
    const rows = [row("inbound", "hola"), row("outbound", "¿En qué te ayudo?"), row("inbound", "MENÚ"), row("outbound", "Menú..."), row("inbound", "3")];
    expect(sinceLastMenu(rows).map((item) => item.body)).toEqual(["MENÚ", "Menú...", "3"]);
  });

  it("sin MENÚ deja el historial como está, y solo cuenta los mensajes del asociado", () => {
    const rows = [row("inbound", "hola"), row("outbound", "menú")];
    expect(sinceLastMenu(rows)).toEqual(rows);
  });
});

describe("mensaje oficial de derivación", () => {
  const settings = buildAttentionSettings(config, {});

  it("usa el de la unidad si lo tiene, con el nombre del sector", () => {
    expect(handoffText(settings, "viajes", "viajes")).toBe("Tu consulta de viajes pasó a Viajes.");
  });

  it("si la unidad no tiene, usa el general", () => {
    expect(handoffText(settings, "creditos", "creditos")).toBe("Listo, ya le pasé tu consulta al equipo de Créditos. Te van a responder por acá.");
    expect(handoffText(settings, "atencion-general", null)).toContain("Atención general");
  });

  it("es null si el cliente no configuró ninguno", () => {
    expect(handoffText({ ...settings, handoffMessage: null }, "creditos", "creditos")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Integración contra jarvis-dev
// ---------------------------------------------------------------------------

const admin = adminClient();
const runId = randomId();
const tokenVar = `ZZ_TEST_TOKEN_${runId}`;
let organizationId = "";
let channelId = "";
let counter = 1200;
let seed = 0;
const monday = new Date("2026-10-26T15:00:00Z");

// Reloj compartido: cada mensaje, entrante o saliente, lleva una hora posterior a la anterior, así el
// orden de la conversación es el de las llamadas.
let clock = Date.now() - 10 * 60 * 1000;
function tick(): Date {
  clock += 2000;
  return new Date(clock);
}

function fakeTelegram() {
  return async () => {
    counter += 1;
    return new Response(JSON.stringify({ ok: true, result: { message_id: counter, date: Math.floor(tick().getTime() / 1000) } }), { status: 200 });
  };
}

async function ingest(identifier: string, body: string) {
  seed += 1;
  const externalId = `${identifier}:${seed}`;
  await admin.rpc("ingest_inbound_message", {
    p_organization_id: organizationId,
    p_channel_id: channelId,
    p_channel_type: "telegram",
    p_identifier: identifier,
    p_contact_name: "Ana Prueba",
    p_external_id: externalId,
    p_type: "text",
    p_body: body,
    p_provider_timestamp: tick().toISOString(),
    p_raw: {},
  });
  const { data } = await admin.from("messages").select("id, conversation_id").eq("external_id", externalId).single();
  return { messageId: data?.id ?? "", conversationId: data?.conversation_id ?? "" };
}

beforeAll(async () => {
  process.env[tokenVar] = "123456:token-de-prueba";

  const { data: org, error } = await admin
    .from("organizations")
    .insert({ slug: `zz-test-${runId}-menu`, name: "Prueba Menú" })
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

  await syncSectorsAndUnits(admin, organizationId, config);
  await syncAttentionConfig(admin, organizationId, config, { prompt: "Sos {{nombre_agente}}.", knowledge: {} });
  await admin.from("agents").insert({ organization_id: organizationId, kind: "attention", name: "Sofía", is_enabled: true });
});

afterAll(async () => {
  delete process.env[tokenVar];
  await admin.from("organizations").delete().eq("id", organizationId);
});

describe("MENÚ en una conversación", () => {
  it("el sistema contesta el menú sin llamar al modelo y reinicia los intentos fallidos", async () => {
    const identifier = `4${Date.now().toString().slice(-8)}`;
    const first = await ingest(identifier, "hola");
    await admin.rpc("agent_record_field_attempt", { p_conversation_id: first.conversationId, p_field: "dni", p_ok: false });
    await admin.rpc("agent_record_field_attempt", { p_conversation_id: first.conversationId, p_field: "dni", p_ok: false });

    const menu = await ingest(identifier, "MENÚ");
    const client = createScriptedClient([]);
    const result = await respondToMessage(admin, client, { conversationId: menu.conversationId, messageId: menu.messageId, now: monday, fetchImpl: fakeTelegram() });

    expect(result).toEqual({ status: "replied", text: MENU });
    expect(client.requests).toHaveLength(0);

    const { data: sent } = await admin.from("messages").select("sender, body").eq("conversation_id", menu.conversationId).eq("direction", "outbound");
    expect(sent).toEqual([{ sender: "agent", body: MENU }]);

    // El contador volvió a cero: el próximo fallo cuenta como el primero.
    const next = await admin.rpc("agent_record_field_attempt", { p_conversation_id: menu.conversationId, p_field: "dni", p_ok: false });
    expect(next.data).toBe(1);
  });

  it("lo que viene después ve el historial desde el MENÚ, no lo anterior", async () => {
    const identifier = `5${Date.now().toString().slice(-8)}`;
    await ingest(identifier, "quiero un prestamo de 500 mil");
    const menu = await ingest(identifier, "menu");
    await respondToMessage(admin, createScriptedClient([]), { conversationId: menu.conversationId, messageId: menu.messageId, now: monday, fetchImpl: fakeTelegram() });

    const answer = await ingest(identifier, "2");
    const client = createScriptedClient([{ content: [{ type: "text", text: "Viajes, perfecto. ¿A dónde querés ir?" }] }]);
    const result = await respondToMessage(admin, client, { conversationId: answer.conversationId, messageId: answer.messageId, now: monday, fetchImpl: fakeTelegram() });
    expect(result.status).toBe("replied");

    const history = client.requests[0]?.messages ?? [];
    expect(history.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(JSON.stringify(history)).not.toContain("prestamo");
    expect(JSON.stringify(history[1])).toContain("Menú principal");
    expect(history[2]).toMatchObject({ content: "2" });
  });
});

describe("derivación con mensaje oficial", () => {
  it("el sistema suma el mensaje oficial de la unidad al del modelo, en un solo mensaje", async () => {
    const identifier = `6${Date.now().toString().slice(-8)}`;
    const { messageId, conversationId } = await ingest(identifier, "quiero viajar a las sierras");
    const client = createScriptedClient([
      {
        content: [
          { type: "tool_use", id: "a", name: "guardar_datos_del_caso", input: { unidad: "viajes", datos: { nombre: "Ana Prueba", dni: "12345678", localidad: "Villa Ejemplo", telefono: "3420000000" } } },
          { type: "tool_use", id: "b", name: "derivar_a_sector", input: { sector: "viajes", resumen: "Consulta de viaje a las sierras" } },
        ],
        stopReason: "tool_use",
      },
      { content: [{ type: "text", text: "Ya registré tu consulta." }] },
    ]);

    const result = await respondToMessage(admin, client, { conversationId, messageId, now: monday, fetchImpl: fakeTelegram() });
    expect(result).toEqual({ status: "replied", text: "Ya registré tu consulta.\n\nTu consulta de viajes pasó a Viajes." });

    const { data: sent } = await admin.from("messages").select("body").eq("conversation_id", conversationId).eq("direction", "outbound").order("created_at");
    // Un solo mensaje, no dos seguidos.
    expect(sent?.map((message) => message.body)).toEqual(["Ya registré tu consulta.\n\nTu consulta de viajes pasó a Viajes."]);
  });

  it("si el modelo no escribe nada pero derivó, igual sale el mensaje oficial", async () => {
    const identifier = `7${Date.now().toString().slice(-8)}`;
    const { messageId, conversationId } = await ingest(identifier, "me aparecio una transferencia que no hice");
    const client = createScriptedClient([
      { content: [{ type: "tool_use", id: "a", name: "derivar_a_sector", input: { sector: "atencion-general", resumen: "Transferencia no reconocida", datos_incompletos_ok: true } }], stopReason: "tool_use" },
      { content: [] },
    ]);

    const result = await respondToMessage(admin, client, { conversationId, messageId, now: monday, fetchImpl: fakeTelegram() });
    expect(result).toMatchObject({ status: "replied" });
    const { data: sent } = await admin.from("messages").select("body").eq("conversation_id", conversationId).eq("direction", "outbound");
    expect(sent).toEqual([{ body: "Listo, ya le pasé tu consulta al equipo de Atención general. Te van a responder por acá." }]);
  });

  it("si la derivación falla por faltar datos, no se manda el mensaje oficial", async () => {
    const identifier = `8${Date.now().toString().slice(-8)}`;
    const { messageId, conversationId } = await ingest(identifier, "necesito un prestamo");
    const client = createScriptedClient([
      { content: [{ type: "tool_use", id: "a", name: "derivar_a_sector", input: { sector: "creditos", resumen: "Pide un préstamo" } }], stopReason: "tool_use" },
      { content: [{ type: "text", text: "¿Me decís tu nombre y apellido?" }] },
    ]);

    await respondToMessage(admin, client, { conversationId, messageId, now: monday, fetchImpl: fakeTelegram() });
    const { data: sent } = await admin.from("messages").select("body").eq("conversation_id", conversationId).eq("direction", "outbound");
    expect(sent).toEqual([{ body: "¿Me decís tu nombre y apellido?" }]);

    const { data: caso } = await admin.from("cases").select("sector_id").eq("conversation_id", conversationId).maybeSingle();
    expect(caso?.sector_id ?? null).toBeNull();
  });
});
