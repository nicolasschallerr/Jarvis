import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { appendNotice, areaAnswerNotice, deliverAreaAnswers } from "../src/lib/agent/area-replies";
import { createScriptedClient } from "../src/lib/ai/scripted-client";
import { syncAttentionConfig } from "../src/lib/client-config/attention";
import { parseClientConfig, syncSectorsAndUnits } from "../src/lib/client-config/load";
import { adminClient, randomId } from "./helpers/supabase-test";

// Envío al asociado de las respuestas del área. Datos inventados (clientes/_plantilla) y modelo
// simulado: no se llama a Anthropic ni a Telegram.

const parsed = parseClientConfig(readFileSync("clientes/_plantilla/sectores-y-reglas.yaml", "utf8"));
if (!parsed.ok) throw new Error(parsed.errors.join("; "));

describe("aviso interno al agente", () => {
  it("dice que no lo escribió el asociado e incluye consulta y respuesta", () => {
    const notice = areaAnswerNotice("Viajes", "¿Hay cupo en marzo?", "Sí, 4 lugares.");
    expect(notice).toContain("no lo escribió el asociado");
    expect(notice).toContain("¿Hay cupo en marzo?");
    expect(notice).toContain("Sí, 4 lugares.");
  });

  it("se suma al último turno del asociado para no romper la alternancia", () => {
    const merged = appendNotice([{ role: "user", content: "hola" }], "AVISO");
    expect(merged).toEqual([{ role: "user", content: "hola\n\nAVISO" }]);

    const appended = appendNotice(
      [
        { role: "user", content: "hola" },
        { role: "assistant", content: [{ type: "text", text: "Le pregunto al área." }] },
      ],
      "AVISO",
    );
    expect(appended).toHaveLength(3);
    expect(appended[2]).toEqual({ role: "user", content: "AVISO" });
  });
});

const admin = adminClient();
const runId = randomId();
const tokenVar = `ZZ_TEST_TOKEN_${runId}`;
let organizationId = "";
let channelId = "";
let counter = 900;

function fakeTelegram() {
  return async () => {
    counter += 1;
    return new Response(JSON.stringify({ ok: true, result: { message_id: counter, date: Math.floor(Date.now() / 1000) } }), { status: 200 });
  };
}

// Una conversación donde el agente ya le preguntó al área, y el área respondió.
async function seedAnsweredQuery(answer = "Sí, quedan 4 lugares.") {
  counter += 1;
  const identifier = `6${Date.now().toString().slice(-7)}${counter}`;
  await admin.rpc("ingest_inbound_message", {
    p_organization_id: organizationId,
    p_channel_id: channelId,
    p_channel_type: "telegram",
    p_identifier: identifier,
    p_contact_name: "Ana Prueba",
    p_external_id: `${identifier}:1`,
    p_type: "text",
    p_body: "cuanto sale el viaje a las sierras en marzo",
    p_provider_timestamp: new Date().toISOString(),
    p_raw: {},
  });
  const { data: message } = await admin.from("messages").select("conversation_id").eq("external_id", `${identifier}:1`).single();
  const conversationId = message?.conversation_id ?? "";

  const { data: queryId, error } = await admin.rpc("agent_ask_area", {
    p_conversation_id: conversationId,
    p_sector_slug: "viajes",
    p_question: "¿Hay cupo para 2 en marzo?",
  });
  if (error || !queryId) throw new Error(`No se pudo crear la consulta: ${error?.message}`);

  await admin.from("area_queries").update({ status: "answered", answer, answered_at: new Date().toISOString() }).eq("id", queryId);
  return { conversationId, queryId };
}

beforeAll(async () => {
  process.env[tokenVar] = "123456:token-de-prueba";

  const { data: org, error } = await admin
    .from("organizations")
    .insert({ slug: `zz-test-${runId}-area`, name: "Prueba Respuestas" })
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

describe("envío de la respuesta del área", () => {
  it("el agente la redacta sin herramientas, la manda por el chat y la marca como enviada", async () => {
    const { conversationId, queryId } = await seedAnsweredQuery();
    const client = createScriptedClient([{ content: [{ type: "text", text: "¡Buenas noticias! Quedan 4 lugares para marzo." }] }]);

    const result = await deliverAreaAnswers(admin, client, { fetchImpl: fakeTelegram(), limit: 50 });
    expect(result.delivered).toBeGreaterThanOrEqual(1);

    // El modelo recibió el aviso interno con la respuesta y ninguna herramienta.
    const request = client.requests[0];
    expect(request?.tools).toEqual([]);
    expect(JSON.stringify(request?.messages.at(-1))).toContain("Sí, quedan 4 lugares.");

    const { data: query } = await admin.from("area_queries").select("reply_sent_at").eq("id", queryId).single();
    expect(query?.reply_sent_at).not.toBeNull();

    const { data: sent } = await admin
      .from("messages")
      .select("sender, status, body")
      .eq("conversation_id", conversationId)
      .eq("direction", "outbound")
      .single();
    expect(sent).toEqual({ sender: "agent", status: "sent", body: "¡Buenas noticias! Quedan 4 lugares para marzo." });

    // Queda en la trazabilidad, sin mensaje disparador.
    const { data: calls } = await admin.from("ai_calls").select("message_id").eq("conversation_id", conversationId);
    expect(calls).toEqual([{ message_id: null }]);

    // Una segunda pasada no la vuelve a mandar.
    const again = createScriptedClient([]);
    await deliverAreaAnswers(admin, again, { fetchImpl: fakeTelegram(), limit: 50 });
    expect(again.requests).toHaveLength(0);
  });

  it("si el modelo falla, libera la respuesta para reintentar", async () => {
    const { queryId } = await seedAnsweredQuery();
    // Sin respuestas armadas: la llamada al modelo falla.
    const result = await deliverAreaAnswers(admin, createScriptedClient([]), { fetchImpl: fakeTelegram(), limit: 50 });
    expect(result.failed).toBeGreaterThanOrEqual(1);

    const { data } = await admin.from("area_queries").select("reply_sent_at").eq("id", queryId).single();
    expect(data?.reply_sent_at).toBeNull();

    // Al reintentar, sale.
    const retry = createScriptedClient([{ content: [{ type: "text", text: "Quedan lugares." }] }]);
    await deliverAreaAnswers(admin, retry, { fetchImpl: fakeTelegram(), limit: 50 });
    const { data: after } = await admin.from("area_queries").select("reply_sent_at").eq("id", queryId).single();
    expect(after?.reply_sent_at).not.toBeNull();
  });

  it("si un operador tomó el chat, no la manda: la transmite él", async () => {
    const { conversationId, queryId } = await seedAnsweredQuery();
    await admin.from("conversations").update({ ai_enabled: false }).eq("id", conversationId);

    const client = createScriptedClient([]);
    await deliverAreaAnswers(admin, client, { fetchImpl: fakeTelegram(), limit: 50 });
    expect(client.requests).toHaveLength(0);

    const { data } = await admin.from("area_queries").select("reply_sent_at").eq("id", queryId).single();
    expect(data?.reply_sent_at).toBeNull();
  });

  it("si el agente está apagado, no la manda", async () => {
    const { queryId } = await seedAnsweredQuery();
    await admin.from("agents").update({ is_enabled: false }).eq("organization_id", organizationId);

    const client = createScriptedClient([]);
    await deliverAreaAnswers(admin, client, { fetchImpl: fakeTelegram(), limit: 50 });
    expect(client.requests).toHaveLength(0);

    const { data } = await admin.from("area_queries").select("reply_sent_at").eq("id", queryId).single();
    expect(data?.reply_sent_at).toBeNull();
    await admin.from("agents").update({ is_enabled: true }).eq("organization_id", organizationId);
  });
});
