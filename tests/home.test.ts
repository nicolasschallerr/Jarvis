import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { syncAgents, parseClientConfig } from "../src/lib/client-config/load";
import { greetingFor, longDate } from "../src/lib/crm/greeting";
import { getHomeSummary } from "../src/lib/crm/home";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

describe("saludo y fecha según la hora de la organización", () => {
  // Argentina es UTC-3 todo el año: 12:00 UTC son las 09:00 allá.
  const at = (utc: string) => new Date(`2026-10-23T${utc}:00.000Z`);

  it("elige buen día, buenas tardes o buenas noches por la hora de Argentina", () => {
    expect(greetingFor(at("09:00"))).toBe("Buen día"); // 06:00
    expect(greetingFor(at("14:59"))).toBe("Buen día"); // 11:59
    expect(greetingFor(at("15:00"))).toBe("Buenas tardes"); // 12:00
    expect(greetingFor(at("22:59"))).toBe("Buenas tardes"); // 19:59
    expect(greetingFor(at("23:00"))).toBe("Buenas noches"); // 20:00
    expect(greetingFor(at("03:00"))).toBe("Buenas noches"); // 00:00 del día siguiente
    expect(greetingFor(at("08:59"))).toBe("Buenas noches"); // 05:59
  });

  it("escribe la fecha en español", () => {
    expect(longDate(at("15:00"))).toBe("viernes, 23 de octubre");
  });
});

describe("Inicio: datos reales y agentes", () => {
  const admin = adminClient();
  const runId = randomId();
  const orgIds: string[] = [];
  const userIds: string[] = [];

  let orgA = "";
  let operator: TestUser;
  let other: TestUser;
  let foreigner: TestUser;
  let conversationOne = "";

  async function seedConversation(orgId: string, label: string) {
    const { data: channel } = await admin
      .from("channels")
      .insert({ organization_id: orgId, type: "telegram", name: "Bot", external_id: `zz-test-${runId}-home-${label}` })
      .select("id")
      .single();
    if (!channel) throw new Error("No se creó el canal");

    await admin.rpc("ingest_inbound_message", {
      p_organization_id: orgId,
      p_channel_id: channel.id,
      p_channel_type: "telegram",
      p_identifier: `${label}${Date.now().toString().slice(-8)}`,
      p_contact_name: `Contacto ${label}`,
      p_external_id: `${runId}-home-${label}:1`,
      p_type: "text",
      p_body: "hola",
      p_provider_timestamp: new Date().toISOString(),
      p_raw: {},
    });
    const { data } = await admin.from("conversations").select("id, contact_id").eq("channel_id", channel.id).single();
    return { conversationId: data?.id ?? "", contactId: data?.contact_id ?? "" };
  }

  let contactOne = "";

  beforeAll(async () => {
    for (const label of ["a", "b"]) {
      const { data, error } = await admin
        .from("organizations")
        .insert({ slug: `zz-test-${runId}-home-${label}`, name: `Prueba Inicio ${label}` })
        .select("id")
        .single();
      if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
      orgIds.push(data.id);
    }
    orgA = orgIds[0] ?? "";

    operator = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "home-op", runId });
    other = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "home-op2", runId });
    foreigner = await createTestUser(admin, { organizationId: orgIds[1] ?? "", role: "operator", label: "home-aj", runId });
    userIds.push(operator.id, other.id, foreigner.id);

    const one = await seedConversation(orgA, "1");
    conversationOne = one.conversationId;
    contactOne = one.contactId;
    await seedConversation(orgA, "2");
    await seedConversation(orgIds[1] ?? "", "3");
  });

  afterAll(async () => {
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
    await admin.from("organizations").delete().in("id", orgIds);
  });

  const summary = (user: TestUser) => getHomeSummary({ userClient: user.client, userId: user.id });

  it("cuenta las conversaciones que esperan respuesta, solo de la propia organización", async () => {
    const result = await summary(operator);
    expect(result.failed).toBe(false);
    expect(result.counts.awaitingReply).toBe(2);
    expect(result.awaitingList.map((item) => item.contact_name).sort()).toEqual(["Contacto 1", "Contacto 2"]);

    const foreign = await summary(foreigner);
    expect(foreign.counts.awaitingReply).toBe(1);
  });

  it("una conversación contestada deja de esperar respuesta", async () => {
    await admin.from("messages").insert({
      organization_id: orgA,
      conversation_id: conversationOne,
      direction: "outbound",
      sender: "operator",
      body: "respuesta",
      status: "sent",
    });
    expect((await summary(operator)).counts.awaitingReply).toBe(1);
  });

  it("cuenta casos propios, sin asignar y urgentes, y no cuenta los resueltos", async () => {
    // Cada fila lleva todas las columnas con valor: en un insert múltiple, supabase-js manda NULL en las que faltan.
    const inserted = await admin.from("cases").insert([
      { organization_id: orgA, contact_id: contactOne, title: "Mío", assigned_to: operator.id, status: "new", priority: "high" },
      { organization_id: orgA, contact_id: contactOne, title: "Sin dueño urgente", status: "new", priority: "urgent" },
      { organization_id: orgA, contact_id: contactOne, title: "De otro", assigned_to: other.id, status: "new", priority: "normal" },
      { organization_id: orgA, contact_id: contactOne, title: "Resuelto mío", assigned_to: operator.id, status: "resolved", priority: "normal" },
    ]);
    expect(inserted.error).toBeNull();

    const result = await summary(operator);
    expect(result.counts).toMatchObject({ myOpenCases: 1, unassignedCases: 1, urgentCases: 1 });
    expect(result.myCases.map((item) => item.title)).toEqual(["Mío"]);

    const theirs = await summary(other);
    expect(theirs.counts.myOpenCases).toBe(1);
  });

  it("los agentes de la configuración se cargan sin pisar su estado y todos los ven", async () => {
    const parsed = parseClientConfig(
      [
        "organizacion:",
        "  slug: x",
        "  nombre: X",
        "unidades:",
        "  - { id: u, nombre: U, sector: s }",
        "sectores:",
        "  - { id: s, nombre: S }",
        "agentes:",
        "  - { tipo: atencion, nombre: Jarvis de Prueba, frase: Hola }",
        "  - { tipo: analitico, nombre: Sinapsis de Prueba }",
      ].join("\n"),
    );
    if (!parsed.ok) throw new Error(parsed.errors.join("; "));

    expect(await syncAgents(admin, orgA, parsed.config)).toEqual({ synced: 2 });

    // El servidor (más adelante, el motor) enciende un agente y cambia su estado.
    await admin.from("agents").update({ status: "working", is_enabled: true }).eq("organization_id", orgA).eq("kind", "attention");

    // Recargar la configuración cambia el nombre pero no el estado.
    const renamed = parseClientConfig(
      [
        "organizacion:",
        "  slug: x",
        "  nombre: X",
        "unidades:",
        "  - { id: u, nombre: U, sector: s }",
        "sectores:",
        "  - { id: s, nombre: S }",
        "agentes:",
        "  - { tipo: atencion, nombre: Jarvis Renombrado }",
      ].join("\n"),
    );
    if (!renamed.ok) throw new Error(renamed.errors.join("; "));
    await syncAgents(admin, orgA, renamed.config);

    const result = await summary(operator);
    // Además de los dos de la configuración, cada organización nace con sus agentes de stock y financiero (ADR-046, ADR-049).
    expect(result.agents.map((agent) => agent.name).sort()).toEqual(["Finanzas", "Jarvis Renombrado", "Sinapsis de Prueba", "Stock"]);
    const attention = result.agents.find((agent) => agent.kind === "attention");
    expect(attention).toMatchObject({ status: "working", is_enabled: true });
    const analytic = result.agents.find((agent) => agent.kind === "analytic");
    expect(analytic).toMatchObject({ status: "paused", is_enabled: false });

    // Otra organización no ve los agentes de esta: solo el suyo de stock.
    expect((await summary(foreigner)).agents.map((agent) => agent.kind).sort()).toEqual(["finance", "stock"]);
  });

  it("solo el superadmin cambia agentes: un operador no puede crearlos ni modificarlos", async () => {
    const insert = await operator.client.from("agents").insert({ organization_id: orgA, kind: "copilot", name: "Intruso" });
    expect(insert.error).not.toBeNull();

    const update = await operator.client.from("agents").update({ name: "Cambiado" }).eq("organization_id", orgA).select("id");
    expect(update.data ?? []).toHaveLength(0);

    const admins = await createTestUser(admin, { organizationId: orgA, role: "superadmin", label: "home-su", runId });
    userIds.push(admins.id);
    const ok = await admins.client.from("agents").update({ tagline: "Frase nueva" }).eq("organization_id", orgA).eq("kind", "analytic").select("id");
    expect(ok.data).toHaveLength(1);
  });
});
