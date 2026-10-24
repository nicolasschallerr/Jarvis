import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createScriptedClient } from "../src/lib/ai/scripted-client";
import { answerBusinessQuestion, askAnalyst, buildAnalystHistory, buildAnalystPrompt, MAX_HISTORY_TURNS } from "../src/lib/analytics/ask";
import { createAnalystTools, zonedMidnight } from "../src/lib/analytics/tools";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Agente analítico: herramientas de solo lectura, motor y servicio. Datos inventados; modelo simulado.

describe("fechas en la zona horaria de la organización", () => {
  it("la medianoche de Buenos Aires es las 03:00 UTC", () => {
    expect(zonedMidnight("2026-10-26", "America/Argentina/Buenos_Aires").toISOString()).toBe("2026-10-26T03:00:00.000Z");
    expect(zonedMidnight("2026-10-26", "UTC").toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });
});

describe("instrucciones e historial", () => {
  it("las instrucciones fijan la fecha de hoy y las reglas de solo lectura y sin datos personales", () => {
    const prompt = buildAnalystPrompt({ agentName: "Analista", organizationName: "Cooperativa Ejemplo", today: "2026-10-26", timeZone: "America/Argentina/Buenos_Aires" });
    expect(prompt).toContain("Sos Analista, el agente analítico de Cooperativa Ejemplo");
    expect(prompt).toContain("Hoy es 2026-10-26");
    expect(prompt).toContain("Nunca inventes");
    expect(prompt).toContain("Solo leés");
    expect(prompt).toContain("Nunca des datos personales");
  });

  it("alterna los turnos, descarta lo anterior al primer mensaje del usuario y limita la charla", () => {
    const history = buildAnalystHistory(
      [
        { role: "assistant", text: "suelto" },
        { role: "user", text: "uno" },
        { role: "assistant", text: "respuesta" },
      ],
      "dos",
    );
    expect(history.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(history[2]).toEqual({ role: "user", content: "dos" });

    const long = Array.from({ length: 40 }, (_, index) => ({ role: (index % 2 === 0 ? "user" : "assistant") as "user" | "assistant", text: `t${index}` }));
    expect(buildAnalystHistory(long, "última").length).toBeLessThanOrEqual(MAX_HISTORY_TURNS + 1);
  });

  it("junta mensajes seguidos del mismo lado y salta los vacíos", () => {
    const history = buildAnalystHistory([{ role: "user", text: "a" }, { role: "user", text: "   " }], "b");
    expect(history).toEqual([{ role: "user", content: "a\nb" }]);
  });
});

// ---------------------------------------------------------------------------
// Integración contra jarvis-dev
// ---------------------------------------------------------------------------

const admin = adminClient();
const runId = randomId();
const orgIds: string[] = [];
const userIds: string[] = [];

let orgA = "";
let superadmin: TestUser;
let operator: TestUser;
let viewer: TestUser;
let foreigner: TestUser;
let seed = 0;
let clock = Date.now() - 60 * 60 * 1000;

const TIME_ZONE = "America/Argentina/Buenos_Aires";
const TODAY = "2026-10-26";

function tick(): string {
  clock += 1000;
  return new Date(clock).toISOString();
}

function tools(user: TestUser) {
  const list = createAnalystTools({ userClient: user.client, timeZone: TIME_ZONE, today: TODAY });
  return (name: string, input: unknown) => {
    const tool = list.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`No existe ${name}`);
    return tool.run(input);
  };
}

async function parsed(result: Promise<{ output: string; isError?: boolean }>) {
  const value = await result;
  expect(value.isError).toBeUndefined();
  return JSON.parse(value.output) as Record<string, unknown> & { grupos?: Array<{ grupo: string; total: number }>; por_sector?: Array<Record<string, unknown>> };
}

async function seedContact(label: string) {
  seed += 1;
  const { data, error } = await admin.from("contacts").insert({ organization_id: orgA, display_name: `Ana Prueba ${label} ${seed}` }).select("id").single();
  if (error || !data) throw new Error(`No se pudo crear el contacto: ${error?.message}`);
  return data.id;
}

async function seedCase(fields: { sector: string | null; status: "new" | "in_progress" | "waiting_contact" | "resolved"; priority?: "low" | "normal" | "high" | "urgent"; openedAt: string; resolvedAt?: string; assignedTo?: string }) {
  const { data, error } = await admin
    .from("cases")
    .insert({
      organization_id: orgA,
      contact_id: await seedContact("caso"),
      title: "Caso de prueba",
      sector_id: fields.sector,
      status: fields.status,
      priority: fields.priority ?? "normal",
      opened_at: fields.openedAt,
      resolved_at: fields.resolvedAt ?? null,
      assigned_to: fields.assignedTo ?? null,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`No se pudo crear el caso: ${error?.message}`);
  return data.id;
}

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const { data, error } = await admin
      .from("organizations")
      .insert({ slug: `zz-test-${runId}-an-${label}`, name: `Prueba Analítico ${label}` })
      .select("id")
      .single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  orgA = orgIds[0] ?? "";
  const orgB = orgIds[1] ?? "";

  superadmin = await createTestUser(admin, { organizationId: orgA, role: "superadmin", label: "an-super", runId });
  operator = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "an-op", runId });
  viewer = await createTestUser(admin, { organizationId: orgA, role: "viewer", label: "an-viewer", runId });
  foreigner = await createTestUser(admin, { organizationId: orgB, role: "superadmin", label: "an-ajeno", runId });
  userIds.push(superadmin.id, operator.id, viewer.id, foreigner.id);

  const { data: sectors } = await admin
    .from("sectors")
    .insert([
      { organization_id: orgA, slug: "viajes", name: "Viajes" },
      { organization_id: orgA, slug: "creditos", name: "Créditos" },
    ])
    .select("id, slug");
  const viajes = sectors?.find((sector) => sector.slug === "viajes")?.id ?? "";
  const creditos = sectors?.find((sector) => sector.slug === "creditos")?.id ?? "";

  const c1 = await seedCase({ sector: viajes, status: "new", openedAt: "2026-10-20T15:00:00Z" });
  // 02:30 UTC del 25 = 23:30 del 24 en Buenos Aires.
  const c2 = await seedCase({ sector: viajes, status: "in_progress", priority: "high", openedAt: "2026-10-25T02:30:00Z", assignedTo: operator.id });
  const c3 = await seedCase({ sector: creditos, status: "resolved", openedAt: "2026-10-22T12:00:00Z", resolvedAt: "2026-10-22T18:00:00Z", assignedTo: operator.id });
  await seedCase({ sector: creditos, status: "resolved", openedAt: "2026-10-23T12:00:00Z", resolvedAt: "2026-10-24T12:00:00Z" });
  // De septiembre y de otra organización: no entran a los números de octubre.
  await seedCase({ sector: null, status: "waiting_contact", openedAt: "2026-09-15T15:00:00Z" });
  const { data: foreignContact } = await admin.from("contacts").insert({ organization_id: orgB, display_name: "Ajena Prueba" }).select("id").single();
  await admin.from("cases").insert({ organization_id: orgB, contact_id: foreignContact?.id ?? "", title: "Ajeno", opened_at: "2026-10-21T15:00:00Z" });

  // Todas las filas con las mismas claves: si no, a las que les falta una se les manda nula.
  const { error: queriesError } = await admin.from("area_queries").insert([
    { organization_id: orgA, case_id: c1, sector_id: viajes, question: "¿Hay cupo?", status: "pending", answer: null, created_at: "2026-10-21T12:00:00Z", answered_at: null },
    { organization_id: orgA, case_id: c2, sector_id: viajes, question: "¿Y el precio?", status: "answered", answer: "Consultar", created_at: "2026-10-25T12:00:00Z", answered_at: "2026-10-25T16:00:00Z" },
    { organization_id: orgA, case_id: c3, sector_id: creditos, question: "¿Tasa?", status: "answered", answer: "Consultar", created_at: "2026-10-22T12:00:00Z", answered_at: "2026-10-22T14:00:00Z" },
  ]);
  if (queriesError) throw new Error(`No se pudieron crear las consultas: ${queriesError.message}`);

  // Conversaciones: una por canal, las dos con el último mensaje del asociado.
  const { data: channels } = await admin
    .from("channels")
    .insert([
      { organization_id: orgA, type: "telegram", name: "Bot", external_id: `zz-test-${runId}-tg` },
      { organization_id: orgA, type: "whatsapp", name: "Línea", external_id: `zz-test-${runId}-wa` },
    ])
    .select("id, type");
  for (const channel of channels ?? []) {
    seed += 1;
    await admin.rpc("ingest_inbound_message", {
      p_organization_id: orgA,
      p_channel_id: channel.id,
      p_channel_type: channel.type,
      p_identifier: `5${Date.now().toString().slice(-8)}${seed}`,
      p_contact_name: "Beto Prueba",
      p_external_id: `zz-an-${runId}-${seed}`,
      p_type: "text",
      p_body: "texto privado del asociado",
      p_provider_timestamp: tick(),
      p_raw: {},
    });
  }

  // Consumo del 26 de octubre.
  const consumer = await seedContact("consumo");
  await admin.from("conversation_windows").insert({
    organization_id: orgA,
    contact_id: consumer,
    initiated_by: "contact",
    opened_at: "2026-10-26T15:00:00Z",
    expires_at: "2026-10-27T15:00:00Z",
  });
  await admin.from("ai_calls").insert({ organization_id: orgA, agent_kind: "attention", model: "modelo-de-prueba", input_tokens: 1000, output_tokens: 200, cost_usd: 0.5, created_at: "2026-10-26T15:10:00Z" });
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

describe("contar_casos", () => {
  it("agrupa por estado en el mes en curso y deja afuera otros meses y otras organizaciones", async () => {
    const result = await parsed(tools(superadmin)("contar_casos", { agrupar_por: "estado" }));
    expect(result).toMatchObject({ desde: "2026-10-01", hasta: TODAY, total: 4 });
    expect(Object.fromEntries((result.grupos ?? []).map((item) => [item.grupo, item.total]))).toEqual({ resolved: 2, new: 1, in_progress: 1 });
  });

  it("agrupa por sector con sus nombres y cuenta los que no tienen", async () => {
    const result = await parsed(tools(superadmin)("contar_casos", { agrupar_por: "sector", desde: "2026-09-01", hasta: TODAY }));
    expect(Object.fromEntries((result.grupos ?? []).map((item) => [item.grupo, item.total]))).toEqual({ Viajes: 2, Créditos: 2, "Sin sector": 1 });
  });

  it("solo abiertos deja afuera los resueltos", async () => {
    const result = await parsed(tools(superadmin)("contar_casos", { agrupar_por: "estado", solo_abiertos: true }));
    expect(result.total).toBe(2);
  });

  it("agrupa por persona asignada y por sin asignar", async () => {
    const result = await parsed(tools(superadmin)("contar_casos", { agrupar_por: "asignado" }));
    const groups = Object.fromEntries((result.grupos ?? []).map((item) => [item.grupo, item.total]));
    expect(groups["Sin asignar"]).toBe(2);
    expect(Object.values(groups).reduce((sum, value) => sum + value, 0)).toBe(4);
  });

  it("agrupa por día en la zona horaria de la organización", async () => {
    const result = await parsed(tools(superadmin)("contar_casos", { agrupar_por: "dia_de_apertura" }));
    const groups = Object.fromEntries((result.grupos ?? []).map((item) => [item.grupo, item.total]));
    // Abierto a las 23:30 del 24 en Buenos Aires: cuenta para el 24, no para el 25.
    expect(groups).toEqual({ "2026-10-20": 1, "2026-10-22": 1, "2026-10-23": 1, "2026-10-24": 1 });
  });

  it("respeta el rango de fechas, y una fecha inválida se informa como error", async () => {
    const result = await parsed(tools(superadmin)("contar_casos", { agrupar_por: "estado", desde: "2026-10-22", hasta: "2026-10-23" }));
    expect(result.total).toBe(2);

    const bad = await tools(superadmin)("contar_casos", { agrupar_por: "estado", desde: "ayer" });
    expect(bad.isError).toBe(true);
    expect(bad.output).toContain("AAAA-MM-DD");

    expect((await tools(superadmin)("contar_casos", { agrupar_por: "inventado" })).isError).toBe(true);
  });

  it("otra organización ve solo lo suyo", async () => {
    const result = await parsed(tools(foreigner)("contar_casos", { agrupar_por: "estado" }));
    expect(result.total).toBe(1);
  });
});

describe("otras herramientas", () => {
  it("tiempos_de_resolucion calcula promedio, mediana y por sector", async () => {
    const result = await parsed(tools(superadmin)("tiempos_de_resolucion", {}));
    expect(result).toMatchObject({ resueltos: 2, promedio_horas: 15, mediana_horas: 15 });
    expect(result.por_sector).toEqual([{ sector: "Créditos", resueltos: 2, promedio_horas: 15 }]);
  });

  it("tiempos_de_resolucion sin casos resueltos devuelve vacío, no inventa", async () => {
    const result = await parsed(tools(superadmin)("tiempos_de_resolucion", { desde: "2026-10-01", hasta: "2026-10-05" }));
    expect(result).toMatchObject({ resueltos: 0, promedio_horas: null, mediana_horas: null, por_sector: [] });
  });

  it("consultas_al_area cuenta pendientes y tiempos de respuesta por sector", async () => {
    const result = await parsed(tools(superadmin)("consultas_al_area", {}));
    expect(result.total).toBe(3);
    expect(result.por_sector).toEqual([
      { sector: "Viajes", consultas: 2, pendientes: 1, respondidas: 1, promedio_horas_hasta_responder: 4 },
      { sector: "Créditos", consultas: 1, pendientes: 0, respondidas: 1, promedio_horas_hasta_responder: 2 },
    ]);
  });

  it("contar_conversaciones da la foto de hoy por canal", async () => {
    const result = await parsed(tools(superadmin)("contar_conversaciones", {}));
    expect(result).toMatchObject({ total: 2, esperando_respuesta_del_equipo: 2 });
    expect(Object.fromEntries((result.por_canal as Array<{ grupo: string; total: number }>).map((item) => [item.grupo, item.total]))).toEqual({ telegram: 1, whatsapp: 1 });
  });

  it("resumen_de_consumo suma créditos y uso de IA, y rechaza períodos demasiado largos", async () => {
    const result = await parsed(tools(superadmin)("resumen_de_consumo", { desde: "2026-10-26", hasta: "2026-10-26" }));
    expect(result).toMatchObject({ dias: 1, creditos: 1, llamadas_a_ia: 1, tokens_de_entrada: 1000, tokens_de_salida: 200, costo_estimado_usd: 0.5 });

    const tooLong = await tools(superadmin)("resumen_de_consumo", { desde: "2026-01-01", hasta: TODAY });
    expect(tooLong.isError).toBe(true);
    expect(tooLong.output).toContain("93 días");
  });

  it("un operador ve los casos y los créditos pero no el gasto en IA", async () => {
    expect((await parsed(tools(operator)("contar_casos", { agrupar_por: "estado" }))).total).toBe(4);
    const result = await parsed(tools(operator)("resumen_de_consumo", { desde: "2026-10-26", hasta: "2026-10-26" }));
    expect(result).toMatchObject({ creditos: 1, llamadas_a_ia: 0, costo_estimado_usd: 0 });
  });

  it("ninguna herramienta devuelve datos personales de asociados", async () => {
    const outputs: string[] = [];
    for (const [name, input] of [
      ["contar_casos", { agrupar_por: "asignado" }],
      ["contar_conversaciones", {}],
      ["consultas_al_area", {}],
      ["tiempos_de_resolucion", {}],
    ] as const) {
      outputs.push((await tools(superadmin)(name, input)).output);
    }
    const joined = outputs.join("\n");
    // Los nombres de las personas del equipo (para "asignado") están bien; los de asociados y sus mensajes, no.
    expect(joined).not.toContain("Ana Prueba");
    expect(joined).not.toContain("Beto Prueba");
    expect(joined).not.toContain("Ajena Prueba");
    expect(joined).not.toContain("texto privado");
    expect(joined).not.toContain("Cupo");
  });
});

describe("motor del analista", () => {
  it("el modelo pide una herramienta, recibe sus datos y arma la respuesta", async () => {
    const client = createScriptedClient([
      { content: [{ type: "tool_use", id: "t1", name: "contar_casos", input: { agrupar_por: "sector" } }], stopReason: "tool_use" },
      { content: [{ type: "text", text: "Hay 2 casos en Viajes y 2 en Créditos este mes." }] },
    ]);

    const result = await askAnalyst({
      client,
      model: "modelo-de-prueba",
      userClient: superadmin.client,
      question: "¿cuántos casos hay por sector?",
      agentName: "Analista",
      organizationName: "Prueba",
      timeZone: TIME_ZONE,
      now: new Date("2026-10-26T15:00:00Z"),
    });

    expect(result.answer).toBe("Hay 2 casos en Viajes y 2 en Créditos este mes.");
    expect(result.toolsUsed).toEqual(["contar_casos"]);
    // Recibió los datos reales de la herramienta.
    const toolResult = JSON.stringify(client.requests[1]?.messages.at(-1));
    expect(toolResult).toContain("Viajes");
    // Y vio la fecha de hoy y todas las herramientas.
    expect(client.requests[0]?.system).toContain("Hoy es 2026-10-26");
    expect(client.requests[0]?.tools.map((tool) => tool.name).sort()).toEqual(
      ["consultas_al_area", "contar_casos", "contar_conversaciones", "resumen_de_consumo", "tiempos_de_resolucion"].sort(),
    );
  });

  it("si el modelo no escribe nada, devuelve un aviso en vez de una respuesta vacía", async () => {
    const result = await askAnalyst({
      client: createScriptedClient([{ content: [] }]),
      model: "m",
      userClient: superadmin.client,
      question: "hola",
      agentName: "Analista",
      organizationName: "Prueba",
      timeZone: TIME_ZONE,
    });
    expect(result.answer).toContain("No pude armar una respuesta");
  });
});

describe("servicio", () => {
  const profileOf = (role: "superadmin" | "operator" | "viewer") => ({ role, organizationId: orgA, organizationName: "Prueba" });
  const base = () => ({ userClient: superadmin.client, admin, now: new Date("2026-10-26T15:00:00Z") });
  const happy = () => createScriptedClient([{ content: [{ type: "text", text: "Listo." }] }]);

  it("un operador no puede preguntar", async () => {
    const result = await answerBusinessQuestion({ ...base(), userClient: operator.client, modelClient: happy(), profile: profileOf("operator"), question: "hola" });
    expect(result).toEqual({ ok: false, error: "Solo el superadministrador y los usuarios de consulta y reportes pueden usar el agente analítico." });
  });

  it("valida la pregunta y avisa si falta la clave", async () => {
    expect((await answerBusinessQuestion({ ...base(), modelClient: happy(), profile: profileOf("superadmin"), question: "   " })).ok).toBe(false);
    expect((await answerBusinessQuestion({ ...base(), modelClient: happy(), profile: profileOf("superadmin"), question: "x".repeat(1001) })).ok).toBe(false);

    const noKey = await answerBusinessQuestion({ ...base(), modelClient: null, profile: profileOf("superadmin"), question: "hola" });
    expect(noKey).toEqual({ ok: false, error: "El agente analítico todavía no está conectado: falta la clave de Anthropic." });
  });

  it("sin agente analítico configurado o apagado, no responde", async () => {
    const missing = await answerBusinessQuestion({ ...base(), modelClient: happy(), profile: profileOf("superadmin"), question: "hola" });
    expect(missing).toEqual({ ok: false, error: "Todavía no hay un agente analítico configurado para esta organización." });

    await admin.from("agents").insert({ organization_id: orgA, kind: "analytic", name: "Analista", is_enabled: false });
    const off = await answerBusinessQuestion({ ...base(), modelClient: happy(), profile: profileOf("superadmin"), question: "hola" });
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.error).toContain("está apagado");
  });

  it("encendido, responde con las herramientas y registra el gasto como del agente analítico", async () => {
    await admin.from("agents").update({ is_enabled: true }).eq("organization_id", orgA).eq("kind", "analytic");
    const client = createScriptedClient([
      {
        content: [{ type: "tool_use", id: "t1", name: "contar_casos", input: { agrupar_por: "estado" } }],
        stopReason: "tool_use",
        usage: { inputTokens: 300, outputTokens: 40, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
      { content: [{ type: "text", text: "Hay 4 casos este mes." }], usage: { inputTokens: 350, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 } },
    ]);

    const result = await answerBusinessQuestion({ ...base(), modelClient: client, profile: profileOf("viewer"), question: "¿cuántos casos hay?", model: "modelo-de-prueba" });
    expect(result).toEqual({ ok: true, answer: "Hay 4 casos este mes.", toolsUsed: ["contar_casos"] });

    const { data: calls } = await admin.from("ai_calls").select("agent_kind, conversation_id, model, input_tokens").eq("organization_id", orgA).eq("agent_kind", "analytic").order("created_at");
    expect(calls).toEqual([
      { agent_kind: "analytic", conversation_id: null, model: "modelo-de-prueba", input_tokens: 300 },
      { agent_kind: "analytic", conversation_id: null, model: "modelo-de-prueba", input_tokens: 350 },
    ]);
  });

  it("si el modelo falla, devuelve un mensaje amable y registra solo el motivo", async () => {
    // Sin respuestas armadas el cliente simulado falla.
    const result = await answerBusinessQuestion({ ...base(), modelClient: createScriptedClient([]), profile: profileOf("superadmin"), question: "mi pregunta secreta", model: "modelo-de-prueba" });
    expect(result).toEqual({ ok: false, error: "No se pudo responder la pregunta. Probá de nuevo en un rato." });

    const { data } = await admin.from("ai_calls").select("error").eq("organization_id", orgA).eq("agent_kind", "analytic").not("error", "is", null);
    expect(data?.length).toBe(1);
    expect(JSON.stringify(data)).toContain("se quedó sin respuestas");
    expect(JSON.stringify(data)).not.toContain("secreta");
  });
});
