import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createScriptedClient } from "../src/lib/ai/scripted-client";
import type { ModelClient } from "../src/lib/ai/types";
import { syncAttentionConfig } from "../src/lib/client-config/attention";
import { parseClientConfig, syncSectorsAndUnits } from "../src/lib/client-config/load";
import { suggestReply } from "../src/lib/copilot/suggest";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Copiloto: borrador de respuesta para una persona del equipo. Datos inventados (clientes/_plantilla) y modelo simulado.

const parsed = parseClientConfig(readFileSync("clientes/_plantilla/sectores-y-reglas.yaml", "utf8"));
if (!parsed.ok) throw new Error(parsed.errors.join("; "));

const admin = adminClient();
const runId = randomId();
const orgIds: string[] = [];
const userIds: string[] = [];

let conversationId = "";
let operator: TestUser;
let viewer: TestUser;
let foreignOperator: TestUser;

const reply = (text: string) => createScriptedClient([{ content: [{ type: "text", text }], usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } }]);

async function seedOrg(label: string) {
  const { data: org, error } = await admin.from("organizations").insert({ slug: `zz-test-${runId}-${label}`, name: `Prueba ${label}` }).select("id").single();
  if (error || !org) throw new Error(`No se pudo crear la organización: ${error?.message}`);
  orgIds.push(org.id);
  return org.id;
}

beforeAll(async () => {
  const orgA = await seedOrg("copiloto");
  const orgB = await seedOrg("ajena");

  operator = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "op", runId });
  viewer = await createTestUser(admin, { organizationId: orgA, role: "viewer", label: "viewer", runId });
  foreignOperator = await createTestUser(admin, { organizationId: orgB, role: "operator", label: "ajeno", runId });
  userIds.push(operator.id, viewer.id, foreignOperator.id);

  const { data: channel } = await admin.from("channels").insert({ organization_id: orgA, type: "telegram", name: "Canal", external_id: `zz-test-${runId}-tg` }).select("id").single();
  await admin.rpc("ingest_inbound_message", {
    p_organization_id: orgA,
    p_channel_id: channel?.id ?? "",
    p_channel_type: "telegram",
    p_identifier: `8${Date.now().toString().slice(-8)}`,
    p_contact_name: "Ana Prueba",
    p_external_id: `${runId}:1`,
    p_type: "text",
    p_body: "hola, quiero saber las condiciones de un crédito",
    p_provider_timestamp: new Date().toISOString(),
    p_raw: {},
  });
  const { data: message } = await admin.from("messages").select("conversation_id").eq("external_id", `${runId}:1`).single();
  conversationId = message?.conversation_id ?? "";

  await syncSectorsAndUnits(admin, orgA, parsed.config);
  await syncAttentionConfig(admin, orgA, parsed.config, { prompt: "Sos {{nombre_agente}} de {{nombre_organizacion}}.", knowledge: { creditos: "Los créditos requieren 6 meses de antigüedad." } });
  await admin.from("agents").insert({ organization_id: orgA, kind: "attention", name: "Sofía", is_enabled: true });
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  for (const id of orgIds) await admin.from("organizations").delete().eq("id", id);
});

function ask(overrides: Partial<Parameters<typeof suggestReply>[0]> = {}) {
  return suggestReply({
    userClient: operator.client,
    admin,
    modelClient: reply("Hola Ana, para un crédito necesitás 6 meses de antigüedad."),
    profile: { role: "operator", organizationId: orgIds[0] ?? "" },
    conversationId,
    ...overrides,
  });
}

describe("copiloto", () => {
  it("arma un borrador con el prompt y el conocimiento del agente, sin herramientas, y no envía nada", async () => {
    const client = reply("**Hola Ana**, para un crédito necesitás 6 meses de antigüedad.");
    const result = await ask({ modelClient: client });

    // Telegram no tiene formato: se quitan los asteriscos.
    expect(result).toEqual({ ok: true, text: "Hola Ana, para un crédito necesitás 6 meses de antigüedad." });

    const request = client.requests[0];
    expect(request?.tools).toEqual([]);
    expect(request?.system).toContain("Sos Sofía");
    expect(request?.system).toContain("6 meses de antigüedad");
    expect(JSON.stringify(request?.messages.at(-1))).toContain("Instrucción interna");
    expect(JSON.stringify(request?.messages.at(-1))).toContain("condiciones de un crédito");

    // Es solo un borrador: no hay ningún mensaje saliente.
    const { data: outbound } = await admin.from("messages").select("id").eq("conversation_id", conversationId).eq("direction", "outbound");
    expect(outbound ?? []).toHaveLength(0);

    // Queda en el consumo como llamada del copiloto, sin el texto.
    const { data: calls } = await admin.from("ai_calls").select("agent_kind, input_tokens, conversation_id, message_id").eq("conversation_id", conversationId);
    expect(calls).toEqual([{ agent_kind: "copilot", input_tokens: 100, conversation_id: conversationId, message_id: null }]);
  });

  it("si el último mensaje ya fue de una persona del equipo, igual pide el próximo borrador sin romper la alternancia", async () => {
    await admin.from("messages").insert({
      organization_id: orgIds[0] ?? "",
      conversation_id: conversationId,
      direction: "outbound",
      sender: "operator",
      type: "text",
      body: "Ya te cuento.",
      status: "sent",
      provider_timestamp: new Date(Date.now() + 1000).toISOString(),
    });
    const client = reply("Te confirmo en un rato.");
    const result = await ask({ modelClient: client });
    expect(result.ok).toBe(true);
    const messages = client.requests[0]?.messages ?? [];
    expect(messages.at(-1)?.role).toBe("user");
    expect(messages.at(-2)?.role).toBe("assistant");
  });

  it("un usuario de consulta no puede pedir borradores y no se gasta el modelo", async () => {
    const client = reply("no debería llamarse");
    const result = await ask({ userClient: viewer.client, profile: { role: "viewer", organizationId: orgIds[0] ?? "" }, modelClient: client });
    expect(result).toMatchObject({ ok: false });
    expect(client.requests).toHaveLength(0);
  });

  it("una conversación de otra organización no se ve: no existe", async () => {
    const client = reply("no debería llamarse");
    const result = await ask({ userClient: foreignOperator.client, profile: { role: "operator", organizationId: orgIds[1] ?? "" }, modelClient: client });
    expect(result).toEqual({ ok: false, error: "La conversación no existe." });
    expect(client.requests).toHaveLength(0);
  });

  it("sin clave de Anthropic o con el agente apagado, explica por qué", async () => {
    expect(await ask({ modelClient: null })).toMatchObject({ ok: false, error: expect.stringContaining("clave de Anthropic") });

    await admin.from("agents").update({ is_enabled: false }).eq("organization_id", orgIds[0] ?? "").eq("kind", "attention");
    const result = await ask();
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("configurado y encendido") });
    await admin.from("agents").update({ is_enabled: true }).eq("organization_id", orgIds[0] ?? "").eq("kind", "attention");
  });

  it("si el modelo falla, devuelve un error genérico y registra solo el motivo", async () => {
    const failing: ModelClient = {
      async create() {
        throw new Error("fallo de red con sk-ant-SECRETO");
      },
    };
    const result = await ask({ modelClient: failing });
    expect(result).toEqual({ ok: false, error: "No se pudo pedir el borrador. Probá de nuevo en un rato." });
  });

  it("una respuesta vacía del modelo no se ofrece como borrador", async () => {
    const result = await ask({ modelClient: createScriptedClient([{ content: [] }]) });
    expect(result).toMatchObject({ ok: false });
  });
});
