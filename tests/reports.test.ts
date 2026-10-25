import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { durationLabel, getReport, parseReport, reportDaysFrom } from "../src/lib/reports/summary";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Reportes de gestión (ADR-037) con una línea de tiempo armada a mano. Datos inventados; organizaciones y usuarios
// propios "zz-test-".

describe("formato y lectura", () => {
  it("elige el período de la dirección, con 30 días por defecto", () => {
    expect(reportDaysFrom("7")).toBe(7);
    expect(reportDaysFrom("90")).toBe(90);
    expect(reportDaysFrom("5")).toBe(30);
    expect(reportDaysFrom(undefined)).toBe(30);
    expect(reportDaysFrom(["7", "30"])).toBe(7);
  });

  it("muestra los tiempos sin decimales raros", () => {
    expect(durationLabel(null)).toBe("—");
    expect(durationLabel(0.4)).toBe("1 s");
    expect(durationLabel(45)).toBe("45 s");
    expect(durationLabel(12 * 60)).toBe("12 min");
    expect(durationLabel(3 * 3600 + 20 * 60)).toBe("3 h 20 min");
    expect(durationLabel(3 * 3600)).toBe("3 h");
    expect(durationLabel(3 * 86400)).toBe("3 d");
  });

  it("tolera una respuesta vacía o con campos que faltan", () => {
    expect(parseReport(null)).toBeNull();
    expect(parseReport([])).toBeNull();
    const empty = parseReport({});
    expect(empty).toMatchObject({ messagesIn: 0, responseMedianSeconds: null, openBySector: [], daily: [] });
  });
});

const admin = adminClient();
const runId = randomId();
const orgIds: string[] = [];
const userIds: string[] = [];
let boss: TestUser;
let foreign: TestUser;

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const { data, error } = await admin.from("organizations").insert({ slug: `zz-test-${runId}-rep-${label}`, name: `Prueba Reportes ${label}` }).select("id").single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  const [orgA = "", orgB = ""] = orgIds;
  boss = await createTestUser(admin, { organizationId: orgA, role: "superadmin", label: "rep-boss", runId });
  foreign = await createTestUser(admin, { organizationId: orgB, role: "superadmin", label: "rep-ajeno", runId });
  userIds.push(boss.id, foreign.id);

  const { data: channel } = await admin
    .from("channels")
    .insert({ organization_id: orgA, type: "telegram", name: "Canal reportes", external_id: `zz-test-${runId}-rep` })
    .select("id")
    .single();
  const { data: contact } = await admin.from("contacts").insert({ organization_id: orgA, display_name: "Ana Prueba" }).select("id").single();
  const { data: conversation, error: conversationError } = await admin
    .from("conversations")
    .insert({ organization_id: orgA, channel_id: channel?.id ?? "", contact_id: contact?.id ?? "" })
    .select("id")
    .single();
  if (conversationError || !conversation) throw new Error(`No se pudo crear la conversación: ${conversationError?.message}`);

  // Línea de tiempo (hace 5 horas): el contacto escribe y el agente responde al minuto; el contacto escribe dos
  // veces seguidas y una persona responde a los 20 minutos del primero; después escribe y nadie contesta.
  const base = Date.now() - 5 * 3_600_000;
  const at = (seconds: number) => new Date(base + seconds * 1000).toISOString();
  const timeline: Array<{ direction: "inbound" | "outbound"; sender: "contact" | "agent" | "operator"; seconds: number }> = [
    { direction: "inbound", sender: "contact", seconds: 0 },
    { direction: "outbound", sender: "agent", seconds: 60 },
    { direction: "inbound", sender: "contact", seconds: 600 },
    { direction: "inbound", sender: "contact", seconds: 660 },
    { direction: "outbound", sender: "operator", seconds: 1800 },
    { direction: "inbound", sender: "contact", seconds: 7200 },
  ];
  const { error: messagesError } = await admin.from("messages").insert(
    timeline.map((message) => ({
      organization_id: orgA,
      conversation_id: conversation.id,
      direction: message.direction,
      sender: message.sender,
      type: "text" as const,
      body: "mensaje de prueba",
      status: message.direction === "outbound" ? ("sent" as const) : ("delivered" as const),
      provider_timestamp: at(message.seconds),
    })),
  );
  if (messagesError) throw new Error(`No se pudieron crear los mensajes: ${messagesError.message}`);

  // Un caso resuelto en 2 horas y uno abierto sin sector ni responsable (las dos filas con las mismas claves: lección 42).
  const { error: caseError } = await admin.from("cases").insert([
    { organization_id: orgA, contact_id: contact?.id ?? "", conversation_id: conversation.id, title: "Resuelto", status: "resolved", opened_at: at(-3 * 3600 + 5 * 3600 - 1), resolved_at: at(-3 * 3600 + 5 * 3600 + 7199) },
    { organization_id: orgA, contact_id: contact?.id ?? "", conversation_id: conversation.id, title: "Abierto", status: "new", opened_at: new Date().toISOString(), resolved_at: null },
  ]);
  if (caseError) throw new Error(`No se pudieron crear los casos: ${caseError.message}`);
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

describe("reporte de gestión", () => {
  it("cuenta los mensajes y los turnos de la línea de tiempo", async () => {
    const { report, failed } = await getReport({ userClient: boss.client, days: 7 });
    expect(failed).toBe(false);
    expect(report).toMatchObject({
      conversationsNew: 1,
      messagesIn: 4,
      messagesOutAgent: 1,
      messagesOutOperator: 1,
      // Tres turnos (el segundo mensaje seguido del contacto no abre otro): dos respondidos y uno esperando.
      turnsTotal: 3,
      turnsAnswered: 2,
      answeredByAgent: 1,
      answeredByOperator: 1,
    });
  });

  it("mide la primera respuesta del agente y la de la persona por separado", async () => {
    const { report } = await getReport({ userClient: boss.client, days: 7 });
    expect(report?.responseMedianSecondsAgent).toBeCloseTo(60, 0);
    // Del primer mensaje del turno (a los 10 min) hasta la respuesta (a los 30 min): 20 minutos.
    expect(report?.responseMedianSecondsOperator).toBeCloseTo(1200, 0);
    expect(report?.responseMedianSeconds).toBeCloseTo(630, 0);
  });

  it("resume los casos: abiertos, resueltos y tiempo de resolución", async () => {
    const { report } = await getReport({ userClient: boss.client, days: 7 });
    expect(report?.casesCreated).toBe(2);
    expect(report?.casesResolved).toBe(1);
    expect(report?.resolutionMedianHours).toBeCloseTo(2, 1);
    expect(report?.openByStatus).toEqual({ new: 1 });
    expect(report?.openBySector).toEqual([{ name: "Sin sector", count: 1 }]);
    expect(report?.openByAssignee).toEqual([{ name: "Sin asignar", count: 1 }]);
  });

  it("devuelve un punto por día, con hoy incluido", async () => {
    const { report } = await getReport({ userClient: boss.client, days: 7 });
    expect(report?.daily).toHaveLength(7);
    expect(report?.daily.reduce((sum, day) => sum + day.inbound, 0)).toBe(4);
    expect(report?.daily.reduce((sum, day) => sum + day.outbound, 0)).toBe(2);
  });

  it("otra organización no ve nada de esto", async () => {
    const { report } = await getReport({ userClient: foreign.client, days: 7 });
    expect(report).toMatchObject({ messagesIn: 0, turnsTotal: 0, casesCreated: 0, openBySector: [], openByAssignee: [] });
    expect(report?.responseMedianSeconds).toBeNull();
  });
});
