import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { respondToMessage } from "../src/lib/agent/attention";
import {
  buildHistory,
  buildSystemPrompt,
  isWithinBusinessHours,
  type AttentionSettings,
} from "../src/lib/agent/context";
import { runAgentLoop, type AgentTool } from "../src/lib/agent/loop";
import { computeCostUsd } from "../src/lib/agent/record";
import { createScriptedClient } from "../src/lib/ai/scripted-client";
import { buildAttentionSettings, syncAttentionConfig } from "../src/lib/client-config/attention";
import { parseClientConfig } from "../src/lib/client-config/load";
import { adminClient, randomId } from "./helpers/supabase-test";

// Todos los datos son inventados (clientes/_plantilla). El modelo es simulado: no se llama a Anthropic.

const templateYaml = readFileSync("clientes/_plantilla/sectores-y-reglas.yaml", "utf8");
const parsed = parseClientConfig(templateYaml);
if (!parsed.ok) throw new Error(parsed.errors.join("; "));
const settings: AttentionSettings = buildAttentionSettings(parsed.config, {
  creditos: "Los créditos exigen 6 meses de antigüedad.",
  viajes: "Los viajes salen en marzo.",
});

// El 2026-10-26 es lunes; 15:00 UTC = 12:00 en Buenos Aires (dentro de 08:00-15:00).
const monday = new Date("2026-10-26T15:00:00Z");

describe("horario de atención", () => {
  it("usa la zona horaria del cliente", () => {
    expect(isWithinBusinessHours(monday, settings)).toBe(true);
    // 19:00 UTC = 16:00 en Buenos Aires: ya cerró.
    expect(isWithinBusinessHours(new Date("2026-10-26T19:00:00Z"), settings)).toBe(false);
    // Sábado.
    expect(isWithinBusinessHours(new Date("2026-10-31T15:00:00Z"), settings)).toBe(false);
  });

  it("respeta los feriados", () => {
    const withHoliday: AttentionSettings = {
      ...settings,
      businessHours: settings.businessHours ? { ...settings.businessHours, holidays: ["2026-10-26"] } : null,
    };
    expect(isWithinBusinessHours(monday, withHoliday)).toBe(false);
  });
});

describe("instrucciones del agente", () => {
  it("completa las variables e incluye unidades, conocimiento y horario", () => {
    const text = buildSystemPrompt("Sos {{nombre_agente}} de {{nombre_organizacion}}.", settings, monday);
    expect(text).toContain("Sos Sofía de Cooperativa Ejemplo.");
    expect(text).toContain("Unidad `creditos`");
    expect(text).toContain("6 meses de antigüedad");
    expect(text).toContain("Accesos no reconocidos");
    expect(text).toContain("dentro del horario");
    expect(buildSystemPrompt("x", settings, new Date("2026-10-31T15:00:00Z"))).toContain("FUERA del horario");
  });
});

describe("historial", () => {
  it("alterna turnos, junta los seguidos y arranca por el asociado", () => {
    const history = buildHistory([
      { direction: "outbound", type: "text", body: "Hola", transcription: null },
      { direction: "inbound", type: "text", body: "quiero un prestamo", transcription: null },
      { direction: "inbound", type: "audio", body: null, transcription: null },
      { direction: "outbound", type: "text", body: "¿Cuánto necesitás?", transcription: null },
    ]);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ role: "user" });
    expect(history[0]?.content).toContain("quiero un prestamo");
    expect(history[0]?.content).toContain("audio");
    expect(history[1]).toMatchObject({ role: "assistant" });
  });
});

describe("costo", () => {
  it("no inventa precios: sin configuración queda vacío", () => {
    expect(computeCostUsd(null, { inputTokens: 1000, outputTokens: 1000 })).toBeNull();
    expect(computeCostUsd({ inputPerMTok: 2, outputPerMTok: 10 }, { inputTokens: 1_000_000, outputTokens: 500_000 })).toBe(7);
  });
});

describe("bucle del agente", () => {
  const echoTool: AgentTool = {
    name: "eco",
    description: "repite",
    inputSchema: { type: "object", properties: {} },
    async run(input) {
      return { output: `recibido ${JSON.stringify(input)}` };
    },
  };

  it("ejecuta la herramienta pedida y termina con el texto del modelo", async () => {
    const client = createScriptedClient([
      { content: [{ type: "tool_use", id: "t1", name: "eco", input: { a: 1 } }], stopReason: "tool_use" },
      { content: [{ type: "text", text: "Listo, ya lo anoté." }] },
    ]);
    const result = await runAgentLoop({ client, model: "m", system: "s", history: [{ role: "user", content: "hola" }], tools: [echoTool] });

    expect(result.text).toBe("Listo, ya lo anoté.");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]?.toolCalls[0]).toMatchObject({ name: "eco", output: 'recibido {"a":1}', isError: false });
    // El segundo pedido incluye el resultado de la herramienta.
    expect(client.requests[1]?.messages.at(-1)).toMatchObject({ role: "user" });
  });

  it("devuelve el error de una herramienta al modelo en vez de cortar el turno", async () => {
    const boom: AgentTool = { ...echoTool, name: "boom", async run() { throw new Error("se rompió"); } };
    const client = createScriptedClient([
      { content: [{ type: "tool_use", id: "t1", name: "boom", input: {} }], stopReason: "tool_use" },
      { content: [{ type: "text", text: "Tuve un problema." }] },
    ]);
    const result = await runAgentLoop({ client, model: "m", system: "s", history: [], tools: [boom] });
    expect(result.steps[0]?.toolCalls[0]).toMatchObject({ isError: true });
    expect(result.text).toBe("Tuve un problema.");
  });

  it("se corta al llegar al máximo de pasos", async () => {
    const loop = { content: [{ type: "tool_use" as const, id: "t", name: "eco", input: {} }], stopReason: "tool_use" };
    const client = createScriptedClient([loop, loop, loop]);
    const result = await runAgentLoop({ client, model: "m", system: "s", history: [], tools: [echoTool], maxSteps: 3 });
    expect(result.truncated).toBe(true);
    expect(result.steps).toHaveLength(3);
  });
});

// ---------------------------------------------------------------------------
// Integración contra jarvis-dev
// ---------------------------------------------------------------------------

const admin = adminClient();
const runId = randomId();
const tokenVar = `ZZ_TEST_TOKEN_${runId}`;
let organizationId = "";
let conversationId = "";
let messageId = "";
let counter = 500;

function fakeTelegram() {
  return async () => {
    counter += 1;
    return new Response(JSON.stringify({ ok: true, result: { message_id: counter, date: Math.floor(Date.now() / 1000) } }), { status: 200 });
  };
}

async function ingest(identifier: string, externalId: string, body: string) {
  const { data: channel } = await admin.from("channels").select("id").eq("organization_id", organizationId).maybeSingle();
  await admin.rpc("ingest_inbound_message", {
    p_organization_id: organizationId,
    p_channel_id: channel?.id ?? "",
    p_channel_type: "telegram",
    p_identifier: identifier,
    p_contact_name: "Ana Prueba",
    p_external_id: externalId,
    p_type: "text",
    p_body: body,
    p_provider_timestamp: new Date().toISOString(),
    p_raw: {},
  });
  const { data } = await admin.from("messages").select("id").eq("organization_id", organizationId).eq("external_id", externalId).single();
  return data?.id ?? "";
}

beforeAll(async () => {
  process.env[tokenVar] = "123456:token-de-prueba";

  const { data: org, error } = await admin
    .from("organizations")
    .insert({ slug: `zz-test-${runId}-agente`, name: "Prueba Agente" })
    .select("id")
    .single();
  if (error || !org) throw new Error(`No se pudo crear la organización: ${error?.message}`);
  organizationId = org.id;

  await admin.from("channels").insert({
    organization_id: organizationId,
    type: "telegram",
    name: "Canal de prueba",
    external_id: `zz-test-${runId}-tg`,
    secret_ref: tokenVar,
  });

  // Sectores y unidades del ejemplo, cargados como los carga el script.
  const { syncSectorsAndUnits } = await import("../src/lib/client-config/load");
  await syncSectorsAndUnits(admin, organizationId, parsed.config);
  await admin.from("agents").insert({ organization_id: organizationId, kind: "attention", name: "Sofía", is_enabled: true });

  const identifier = `3${Date.now().toString().slice(-8)}`;
  messageId = await ingest(identifier, `${identifier}:1`, "necesito un prestamo de 500 mil");
  const { data: conversation } = await admin.from("conversations").select("id").eq("organization_id", organizationId).single();
  conversationId = conversation?.id ?? "";
});

afterAll(async () => {
  delete process.env[tokenVar];
  await admin.from("organizations").delete().eq("id", organizationId);
});

describe("configuración del agente", () => {
  it("crea una versión, no repite si nada cambió y versiona cuando cambia", async () => {
    const files = { prompt: "Sos {{nombre_agente}}.", knowledge: { creditos: "uno" } };
    expect(await syncAttentionConfig(admin, organizationId, parsed.config, files)).toEqual({ status: "created", version: 1 });
    expect(await syncAttentionConfig(admin, organizationId, parsed.config, files)).toEqual({ status: "unchanged", version: 1 });
    expect(await syncAttentionConfig(admin, organizationId, parsed.config, { ...files, prompt: "Sos otra." })).toEqual({ status: "created", version: 2 });

    const { data: versions } = await admin.from("agent_configs").select("version, is_active").eq("organization_id", organizationId).order("version");
    expect(versions).toEqual([
      { version: 1, is_active: false },
      { version: 2, is_active: true },
    ]);
  });
});

describe("agente de atención", () => {
  it("junta datos, deriva con actor 'agente', responde por el canal y registra las llamadas", async () => {
    await syncAttentionConfig(admin, organizationId, parsed.config, {
      prompt: "Sos {{nombre_agente}} de {{nombre_organizacion}}.",
      knowledge: { creditos: "Los créditos exigen 6 meses de antigüedad." },
    });

    const client = createScriptedClient([
      {
        content: [
          { type: "tool_use", id: "a", name: "guardar_datos_del_caso", input: { unidad: "creditos", titulo: "Solicitud de crédito", datos: { monto: 500000 } } },
          { type: "tool_use", id: "b", name: "derivar_a_sector", input: { sector: "creditos", resumen: "Ana Prueba pide un crédito de $500.000." } },
        ],
        stopReason: "tool_use",
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
      { content: [{ type: "text", text: "Listo, le pasé tu consulta al equipo de Créditos." }] },
    ]);

    const result = await respondToMessage(admin, client, { conversationId, messageId, now: monday, fetchImpl: fakeTelegram() });
    expect(result).toEqual({ status: "replied", text: "Listo, le pasé tu consulta al equipo de Créditos." });

    // El caso quedó armado y derivado.
    const { data: caso } = await admin.from("cases").select("id, title, summary, collected_data, status, sectors(slug), business_units(slug)").eq("conversation_id", conversationId).single();
    expect(caso).toMatchObject({
      title: "Solicitud de crédito",
      collected_data: { monto: 500000 },
      status: "new",
      sectors: { slug: "creditos" },
      business_units: { slug: "creditos" },
    });

    // El historial distingue al agente del sistema.
    const { data: events } = await admin.from("case_events").select("event_type, actor_type").eq("case_id", caso?.id ?? "");
    expect(events?.length).toBeGreaterThan(0);
    expect(events?.every((event) => event.actor_type === "agent")).toBe(true);

    // La respuesta se guardó como del agente.
    const { data: reply } = await admin.from("messages").select("sender, status").eq("conversation_id", conversationId).eq("direction", "outbound").single();
    expect(reply).toMatchObject({ sender: "agent", status: "sent" });

    // Trazabilidad: dos llamadas al modelo y dos herramientas.
    const { data: calls } = await admin.from("ai_calls").select("id, input_tokens, cost_usd, decision").eq("organization_id", organizationId);
    expect(calls).toHaveLength(2);
    const { data: toolCalls } = await admin.from("ai_tool_calls").select("tool_name, is_error").eq("organization_id", organizationId);
    expect(toolCalls?.map((tool) => tool.tool_name).sort()).toEqual(["derivar_a_sector", "guardar_datos_del_caso"]);

    // El estado en vivo del agente vuelve a reposo.
    const { data: agent } = await admin.from("agents").select("status").eq("organization_id", organizationId).eq("kind", "attention").single();
    expect(agent?.status).toBe("paused");
  });

  it("no responde dos veces al mismo mensaje", async () => {
    const client = createScriptedClient([{ content: [{ type: "text", text: "otra respuesta" }] }]);
    const result = await respondToMessage(admin, client, { conversationId, messageId, now: monday, fetchImpl: fakeTelegram() });
    expect(result).toEqual({ status: "skipped", reason: "ya_respondido" });
    expect(client.requests).toHaveLength(0);
  });

  it("respeta el interruptor de IA de la conversación", async () => {
    await admin.from("conversations").update({ ai_enabled: false }).eq("id", conversationId);
    const client = createScriptedClient([]);
    const result = await respondToMessage(admin, client, { conversationId, messageId, now: monday });
    expect(result).toEqual({ status: "skipped", reason: "ia_apagada_en_la_conversacion" });
    await admin.from("conversations").update({ ai_enabled: true }).eq("id", conversationId);
  });

  it("rechaza un sector que no existe y se lo explica al modelo", async () => {
    const identifier = `4${Date.now().toString().slice(-8)}`;
    const newMessage = await ingest(identifier, `${identifier}:1`, "hola");
    const { data: conversation } = await admin.from("messages").select("conversation_id").eq("id", newMessage).single();
    const client = createScriptedClient([
      { content: [{ type: "tool_use", id: "a", name: "derivar_a_sector", input: { sector: "inventado", resumen: "x" } }], stopReason: "tool_use" },
      { content: [{ type: "text", text: "Dame un momento." }] },
    ]);
    const result = await respondToMessage(admin, client, { conversationId: conversation?.conversation_id ?? "", messageId: newMessage, now: monday, fetchImpl: fakeTelegram() });
    expect(result.status).toBe("replied");

    const { data: tool } = await admin.from("ai_tool_calls").select("is_error, output").eq("organization_id", organizationId).eq("tool_name", "derivar_a_sector").order("created_at", { ascending: false }).limit(1).single();
    expect(tool?.is_error).toBe(true);
  });

  it("no hace nada si el agente está apagado", async () => {
    await admin.from("agents").update({ is_enabled: false }).eq("organization_id", organizationId).eq("kind", "attention");
    const identifier = `5${Date.now().toString().slice(-8)}`;
    const newMessage = await ingest(identifier, `${identifier}:1`, "hola");
    const { data: conversation } = await admin.from("messages").select("conversation_id").eq("id", newMessage).single();
    const client = createScriptedClient([]);
    const result = await respondToMessage(admin, client, { conversationId: conversation?.conversation_id ?? "", messageId: newMessage, now: monday });
    expect(result).toEqual({ status: "skipped", reason: "agente_apagado" });
  });
});
