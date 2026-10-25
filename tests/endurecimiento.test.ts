import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { redactToolInput } from "../src/lib/agent/record";
import { setConversationAi } from "../src/lib/crm/ai-switch";
import { checkSendable } from "../src/lib/outbound/send";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Controles del endurecimiento (ADR-027) y del interruptor "Tomar el chat" (ADR-028), contra el proyecto de
// desarrollo. Crea sus propias organizaciones y usuarios con el prefijo "zz-test-".

const admin = adminClient();
const runId = randomId();
const tokenVar = `CHANNEL_TOKEN_ZZTEST_${runId.toUpperCase()}`;
const orgIds: string[] = [];
const userIds: string[] = [];

let superadmin: TestUser;
let operator: TestUser;
let viewer: TestUser;
let foreignOperator: TestUser;
let telegramChannel = "";
let telegramConversation = "";
let whatsappConversation = "";
let contactId = "";

async function seedConversation(orgId: string, type: "telegram" | "whatsapp", lastInbound: string) {
  const { data: channel, error } = await admin
    .from("channels")
    .insert({ organization_id: orgId, type, name: `Canal ${type}`, external_id: `zz-test-${runId}-${type}`, secret_ref: tokenVar })
    .select("id")
    .single();
  if (error || !channel) throw new Error(`No se pudo crear el canal: ${error?.message}`);

  const { error: ingestError } = await admin.rpc("ingest_inbound_message", {
    p_organization_id: orgId,
    p_channel_id: channel.id,
    p_channel_type: type,
    p_identifier: `${type === "telegram" ? "7" : "549"}${Date.now().toString().slice(-8)}`,
    p_contact_name: "Ana Prueba",
    p_external_id: `${runId}-${type}:1`,
    p_type: "text",
    p_body: "hola",
    p_provider_timestamp: lastInbound,
    p_raw: {},
  });
  if (ingestError) throw new Error(`No se pudo sembrar el mensaje: ${ingestError.message}`);

  const { data: conversation } = await admin.from("conversations").select("id, contact_id").eq("channel_id", channel.id).single();
  if (!conversation) throw new Error("No se creó la conversación");
  return { channelId: channel.id, conversationId: conversation.id, contactId: conversation.contact_id };
}

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const { data, error } = await admin
      .from("organizations")
      .insert({ slug: `zz-test-${runId}-endu-${label}`, name: `Prueba Endurecimiento ${label}` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  const [orgA = "", orgB = ""] = orgIds;

  superadmin = await createTestUser(admin, { organizationId: orgA, role: "superadmin", label: "endu-admin", runId });
  operator = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "endu-op", runId });
  viewer = await createTestUser(admin, { organizationId: orgA, role: "viewer", label: "endu-viewer", runId });
  foreignOperator = await createTestUser(admin, { organizationId: orgB, role: "operator", label: "endu-ajeno", runId });
  userIds.push(superadmin.id, operator.id, viewer.id, foreignOperator.id);

  const telegram = await seedConversation(orgA, "telegram", new Date(Date.now() - 3600 * 1000).toISOString());
  telegramChannel = telegram.channelId;
  telegramConversation = telegram.conversationId;
  contactId = telegram.contactId;
  whatsappConversation = (await seedConversation(orgA, "whatsapp", new Date(Date.now() - 72 * 3600 * 1000).toISOString())).conversationId;
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

describe("token de los canales", () => {
  it("un superadmin no puede apuntar su canal a otra variable de entorno", async () => {
    const { error } = await superadmin.client.from("channels").update({ secret_ref: "SUPABASE_SERVICE_ROLE_KEY" }).eq("id", telegramChannel);
    expect(error).not.toBeNull();
    const { error: sameFormat } = await superadmin.client.from("channels").update({ secret_ref: "CHANNEL_TOKEN_OTRO" }).eq("id", telegramChannel);
    expect(sameFormat?.message).toContain("Solo el servidor");
  });

  it("ni el servidor puede guardar un nombre que no sea de token de canal", async () => {
    const { error } = await admin.from("channels").update({ secret_ref: "SUPABASE_SERVICE_ROLE_KEY" }).eq("id", telegramChannel);
    expect(error).not.toBeNull();
    const { data } = await admin.from("channels").select("secret_ref").eq("id", telegramChannel).single();
    expect(data?.secret_ref).toBe(tokenVar);
  });
});

describe("columnas protegidas", () => {
  it("una persona no puede correr la ventana de 24 h ni las marcas de tiempo de una conversación", async () => {
    const { error } = await operator.client
      .from("conversations")
      .update({ last_inbound_at: new Date().toISOString() })
      .eq("id", whatsappConversation);
    expect(error?.message).toContain("solo el sistema");
  });

  it("una persona no puede marcar el consentimiento ni unir fichas a mano", async () => {
    const { error } = await operator.client.from("contacts").update({ opted_in_at: new Date().toISOString() }).eq("id", contactId);
    expect(error?.message).toContain("solo el sistema");
  });

  it("sí puede cambiar lo que la pantalla cambia: el nombre de la ficha", async () => {
    const { error } = await operator.client.from("contacts").update({ locality: "Villa Ejemplo" }).eq("id", contactId);
    expect(error).toBeNull();
  });
});

describe("tomar el chat y devolverlo a Jarvis", () => {
  it("el rol de consulta no puede tomar el chat", async () => {
    const result = await setConversationAi({ userClient: viewer.client, profile: { id: viewer.id, role: "viewer" }, conversationId: telegramConversation, enabled: false });
    expect(result.ok).toBe(false);
  });

  it("un operador de otra organización no encuentra la conversación", async () => {
    const result = await setConversationAi({
      userClient: foreignOperator.client,
      profile: { id: foreignOperator.id, role: "operator" },
      conversationId: telegramConversation,
      enabled: false,
    });
    expect(result.ok).toBe(false);
    const { data } = await admin.from("conversations").select("ai_enabled").eq("id", telegramConversation).single();
    expect(data?.ai_enabled).toBe(true);
  });

  it("al tomarlo, Jarvis se pausa y la conversación queda asignada a quien la tomó", async () => {
    const result = await setConversationAi({ userClient: operator.client, profile: { id: operator.id, role: "operator" }, conversationId: telegramConversation, enabled: false });
    expect(result).toEqual({ ok: true });
    const { data } = await admin.from("conversations").select("ai_enabled, assigned_to").eq("id", telegramConversation).single();
    expect(data).toEqual({ ai_enabled: false, assigned_to: operator.id });
  });

  it("al devolverlo, Jarvis vuelve a atender y la asignación se mantiene", async () => {
    const result = await setConversationAi({ userClient: superadmin.client, profile: { id: superadmin.id, role: "superadmin" }, conversationId: telegramConversation, enabled: true });
    expect(result).toEqual({ ok: true });
    const { data } = await admin.from("conversations").select("ai_enabled, assigned_to").eq("id", telegramConversation).single();
    expect(data).toEqual({ ai_enabled: true, assigned_to: operator.id });
  });
});

describe("segunda ronda (ADR-029)", () => {
  let caseId = "";

  beforeAll(async () => {
    const [orgA = ""] = orgIds;
    const { data, error } = await admin
      .from("cases")
      .insert({ organization_id: orgA, contact_id: contactId, conversation_id: telegramConversation, title: "Caso de prueba" })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear el caso: ${error?.message}`);
    caseId = data.id;
  });

  it("una persona (aun superadmin) cambia el estado de un caso pero no lo que juntó el agente ni de quién es", async () => {
    const { data: changed, error: statusError } = await superadmin.client.from("cases").update({ status: "in_progress" }).eq("id", caseId).select("id");
    expect(statusError).toBeNull();
    expect(changed).toHaveLength(1);
    const { error } = await superadmin.client.from("cases").update({ collected_data: { dni: "11111111" } }).eq("id", caseId);
    expect(error?.message).toContain("solo el sistema");
  });

  it("las identidades de contacto no las escribe una persona (los mensajes irían a otro)", async () => {
    const [orgA = ""] = orgIds;
    const { error } = await operator.client
      .from("contact_identities")
      .insert({ organization_id: orgA, contact_id: contactId, channel_type: "telegram", identifier: "999" });
    expect(error).not.toBeNull();
  });

  it("solo se asigna a alguien activo del equipo de la misma organización", async () => {
    const { error: foreign } = await superadmin.client.from("cases").update({ assigned_to: foreignOperator.id }).eq("id", caseId);
    expect(foreign?.message).toContain("Solo se puede asignar");
    const { error: asViewer } = await superadmin.client.from("cases").update({ assigned_to: viewer.id }).eq("id", caseId);
    expect(asViewer?.message).toContain("Solo se puede asignar");
    const { error: ok } = await superadmin.client.from("cases").update({ assigned_to: operator.id }).eq("id", caseId);
    expect(ok).toBeNull();
  });

  it("el turno del agente se renueva mientras lo tiene y no se puede renovar uno que no tomó", async () => {
    await admin.rpc("claim_agent_turn", { p_conversation_id: telegramConversation, p_seconds: 5 });
    await admin.rpc("extend_agent_turn", { p_conversation_id: telegramConversation, p_seconds: 600 });
    const { data } = await admin.from("conversations").select("agent_lock_until").eq("id", telegramConversation).single();
    expect(new Date(data?.agent_lock_until ?? 0).getTime()).toBeGreaterThan(Date.now() + 500_000);
    await admin.rpc("release_agent_turn", { p_conversation_id: telegramConversation });

    await admin.rpc("extend_agent_turn", { p_conversation_id: telegramConversation, p_seconds: 600 });
    const { data: released } = await admin.from("conversations").select("agent_lock_until").eq("id", telegramConversation).single();
    expect(released?.agent_lock_until).toBeNull();
  });
});

describe("turno del agente por conversación", () => {
  it("una sola ejecución a la vez; al soltarlo se puede volver a tomar", async () => {
    const first = await admin.rpc("claim_agent_turn", { p_conversation_id: telegramConversation });
    const second = await admin.rpc("claim_agent_turn", { p_conversation_id: telegramConversation });
    expect(first.data).toBe(true);
    expect(second.data).toBe(false);

    await admin.rpc("release_agent_turn", { p_conversation_id: telegramConversation });
    const third = await admin.rpc("claim_agent_turn", { p_conversation_id: telegramConversation });
    expect(third.data).toBe(true);
    await admin.rpc("release_agent_turn", { p_conversation_id: telegramConversation });
  });

  it("las personas no pueden tomar el turno del agente", async () => {
    const { error } = await operator.client.rpc("claim_agent_turn", { p_conversation_id: telegramConversation });
    expect(error).not.toBeNull();
  });
});

describe("se puede escribir antes de llamar al modelo", () => {
  it("Telegram dentro de la conversación: sí", async () => {
    expect(await checkSendable(admin, telegramConversation, new Date())).toEqual({ ok: true });
  });

  it("WhatsApp todavía no tiene envío: no se gasta el modelo", async () => {
    expect(await checkSendable(admin, whatsappConversation, new Date())).toEqual({ ok: false, reason: "canal_sin_envio" });
  });

  it("una conversación que no existe: no", async () => {
    expect(await checkSendable(admin, "00000000-0000-0000-0000-000000000000", new Date())).toEqual({ ok: false, reason: "sin_conversacion" });
  });
});

describe("registro de las herramientas sin datos personales", () => {
  it("de los datos guardados solo quedan los nombres, no los valores", () => {
    expect(redactToolInput("guardar_datos_del_caso", { unidad: "creditos", datos: { dni: "12345678", monto: "500000" } })).toEqual({
      unidad: "creditos",
      titulo: null,
      datos: ["dni", "monto"],
    });
  });

  it("de una derivación queda el sector y la prioridad, no el resumen", () => {
    expect(redactToolInput("derivar_a_sector", { sector: "creditos", prioridad: "normal", resumen: "Ana Prueba, DNI 12345678" })).toEqual({
      sector: "creditos",
      prioridad: "normal",
      datos_incompletos_ok: null,
    });
  });

  it("de una consulta al área queda solo el sector", () => {
    expect(redactToolInput("consultar_al_area", { sector: "creditos", pregunta: "¿Ana Prueba puede...?" })).toEqual({ sector: "creditos" });
  });
});
