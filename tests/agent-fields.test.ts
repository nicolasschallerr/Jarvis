import { readFileSync } from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildSystemPrompt } from "../src/lib/agent/context";
import { createAttentionTools, missingRequiredFields, type ToolContext } from "../src/lib/agent/tools";
import { buildAttentionSettings } from "../src/lib/client-config/attention";
import { parseClientConfig } from "../src/lib/client-config/load";
import { createMemoryBackend, type RecordedAction } from "../src/lib/evals/memory-backend";
import { adminClient, randomId } from "./helpers/supabase-test";

// Datos que junta el agente: validación, reintentos, guardián antes de derivar y guardado en la base.
// Datos inventados (clientes/_plantilla).

const templateText = readFileSync("clientes/_plantilla/sectores-y-reglas.yaml", "utf8").replace(/\r\n/g, "\n");
const parsed = parseClientConfig(templateText);
if (!parsed.ok) throw new Error(parsed.errors.join("; "));
const settings = buildAttentionSettings(parsed.config, {});

describe("campos en la configuración", () => {
  it("la plantilla define los datos con su destino y su unidad", () => {
    const byId = Object.fromEntries(settings.fields.map((field) => [field.id, field]));
    expect(byId.dni).toMatchObject({ store: "contact_document", clean: "digits", required: true, units: null });
    expect(byId.monto).toMatchObject({ store: "case", units: ["creditos"] });
    expect(byId.email).toMatchObject({ required: false, units: ["viajes"] });
    expect(settings.maxFieldRetries).toBe(3);
  });

  function withChange(change: (text: string) => string) {
    return parseClientConfig(change(templateText));
  }

  it("rechaza una expresión regular inválida", () => {
    const result = withChange((text) => text.replace("regex: '^[A-Za-zÁÉÍÓÚáéíóúÑñ ]{3,60}$'", "regex: '([a-z'"));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain("expresión regular");
  });

  it("rechaza ids repetidos, unidades inexistentes y dos datos con el mismo destino", () => {
    const repeated = withChange((text) => text.replace("  - id: localidad", "  - id: dni"));
    expect(repeated.ok).toBe(false);
    if (!repeated.ok) expect(repeated.errors.join("\n")).toContain("repetido");

    const unknownUnit = withChange((text) => text.replace("unidades: [creditos]", "unidades: [no-existe]"));
    expect(unknownUnit.ok).toBe(false);
    if (!unknownUnit.ok) expect(unknownUnit.errors.join("\n")).toContain('"no-existe"');

    const sameDestination = withChange((text) => text.replace("guardar_en: contacto_localidad", "guardar_en: contacto_documento"));
    expect(sameDestination.ok).toBe(false);
    if (!sameDestination.ok) expect(sameDestination.errors.join("\n")).toContain("más de un campo");
  });

  it("las instrucciones listan los datos, los generales y los de cada unidad", () => {
    const prompt = buildSystemPrompt("Hola", settings, new Date("2026-10-26T15:00:00Z"));
    expect(prompt).toContain("Datos a juntar");
    expect(prompt).toContain("`dni`: DNI");
    expect(prompt).toContain("Solo en Créditos");
    expect(prompt).toContain("`email`: Correo electrónico (opcional)");
  });
});

function tools() {
  const actions: RecordedAction[] = [];
  const backend = createMemoryBackend(actions);
  const context: ToolContext = {
    unitSlugs: settings.units.map((unit) => unit.id),
    sectorSlugs: settings.sectors.map((sector) => sector.id),
    fields: settings.fields,
    maxFieldRetries: settings.maxFieldRetries,
  };
  const list = createAttentionTools(backend, context);
  const run = (name: string, input: unknown) => {
    const tool = list.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`No existe ${name}`);
    return tool.run(input);
  };
  return { actions, backend, run, context };
}

describe("validación de datos", () => {
  it("limpia y guarda un dato válido en la ficha del asociado", async () => {
    const { backend, run } = tools();
    const result = await run("guardar_datos_del_caso", { datos: { dni: "12.345.678", nombre: "Ana Prueba" } });
    expect(result.isError).toBeUndefined();
    expect(backend.state.contact).toEqual({ name: "Ana Prueba", document: "12345678", locality: null });
  });

  it("rechaza un dato inválido, cuenta el intento y explica cómo escribirlo", async () => {
    const { backend, run } = tools();
    const result = await run("guardar_datos_del_caso", { datos: { dni: "abc" } });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("DNI");
    expect(result.output).toContain("intento 1 de 3");
    expect(backend.state.contact.document).toBeNull();
  });

  it("guarda lo válido aunque otro dato venga mal", async () => {
    const { backend, run } = tools();
    const result = await run("guardar_datos_del_caso", { unidad: "creditos", datos: { localidad: "Villa Ejemplo", monto: "mucho" } });
    expect(result.isError).toBe(true);
    expect(result.output).toContain("Se guardaron: Localidad");
    expect(backend.state.contact.locality).toBe("Villa Ejemplo");
    expect(backend.state.data.monto).toBeUndefined();
  });

  it("tras el máximo de intentos manda derivar a una persona, y un dato válido reinicia la cuenta", async () => {
    const { run } = tools();
    await run("guardar_datos_del_caso", { datos: { dni: "x" } });
    await run("guardar_datos_del_caso", { datos: { dni: "y" } });
    const third = await run("guardar_datos_del_caso", { datos: { dni: "z" } });
    expect(third.output).toContain("superó los 3 intentos");
    expect(third.decision).toEqual({ action: "field_retries_exceeded", field: "dni" });

    const other = tools();
    await other.run("guardar_datos_del_caso", { datos: { dni: "x" } });
    await other.run("guardar_datos_del_caso", { datos: { dni: "12345678" } });
    const again = await other.run("guardar_datos_del_caso", { datos: { dni: "x" } });
    expect(again.output).toContain("intento 1 de 3");
  });

  it("los datos que no están definidos se guardan tal cual", async () => {
    const { backend, run } = tools();
    await run("guardar_datos_del_caso", { datos: { plazo_deseado: "12 meses" } });
    expect(backend.state.data.plazo_deseado).toBe("12 meses");
  });
});

describe("guardián de datos antes de derivar", () => {
  async function completeContact(run: ReturnType<typeof tools>["run"]) {
    await run("guardar_datos_del_caso", { datos: { nombre: "Ana Prueba", dni: "12345678", localidad: "Villa Ejemplo" } });
  }

  it("no deriva si faltan datos obligatorios y dice cuáles", async () => {
    const { actions, run } = tools();
    const result = await run("derivar_a_sector", { sector: "creditos", resumen: "Pide un crédito" });
    expect(result.isError).toBe(true);
    expect(result.output).toBe("Faltan datos obligatorios: Nombre y apellido, DNI, Localidad. Pedíselos al asociado de a uno, en ese orden, y guardalos antes de derivar.");
    expect(actions.some((action) => action.kind === "handoff")).toBe(false);
  });

  it("exige también los datos propios de la unidad, pero no los de otras", async () => {
    const { run } = tools();
    await completeContact(run);
    await run("guardar_datos_del_caso", { unidad: "creditos", datos: {} });

    const missing = await run("derivar_a_sector", { sector: "creditos", resumen: "x" });
    expect(missing.output).toContain("Monto solicitado");
    expect(missing.output).not.toContain("Correo");

    await run("guardar_datos_del_caso", { unidad: "creditos", datos: { monto: "$ 500.000" } });
    const ok = await run("derivar_a_sector", { sector: "creditos", resumen: "Pide un crédito de 500000" });
    expect(ok.isError).toBeUndefined();
    expect(ok.decision).toMatchObject({ action: "handoff", sector: "creditos", unit: "creditos" });
  });

  it("los datos opcionales no bloquean", async () => {
    const { run } = tools();
    await completeContact(run);
    await run("guardar_datos_del_caso", { unidad: "viajes", datos: {} });
    const result = await run("derivar_a_sector", { sector: "viajes", resumen: "Consulta de viaje" });
    expect(result.isError).toBeUndefined();
  });

  it("deja derivar sin datos en los casos de excepción", async () => {
    const { actions, run } = tools();
    const result = await run("derivar_a_sector", { sector: "atencion-general", resumen: "Transferencia no reconocida", datos_incompletos_ok: true });
    expect(result.isError).toBeUndefined();
    expect(actions.filter((action) => action.kind === "handoff")).toHaveLength(1);
  });

  it("sin datos configurados no exige nada", () => {
    expect(missingRequiredFields([], { unit: null, data: {}, contact: { name: null, document: null, locality: null } })).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Integración contra jarvis-dev: las funciones de la base
// ---------------------------------------------------------------------------

const admin = adminClient();
const runId = randomId();
let organizationId = "";
let conversationId = "";
let contactId = "";

beforeAll(async () => {
  const { data: org, error } = await admin
    .from("organizations")
    .insert({ slug: `zz-test-${runId}-campos`, name: "Prueba Campos" })
    .select("id")
    .single();
  if (error || !org) throw new Error(`No se pudo crear la organización: ${error?.message}`);
  organizationId = org.id;

  const { data: channel } = await admin
    .from("channels")
    .insert({ organization_id: organizationId, type: "telegram", name: "Bot", external_id: `zz-test-${runId}-tg` })
    .select("id")
    .single();
  const identifier = `9${Date.now().toString().slice(-8)}`;
  await admin.rpc("ingest_inbound_message", {
    p_organization_id: organizationId,
    p_channel_id: channel?.id ?? "",
    p_channel_type: "telegram",
    p_identifier: identifier,
    p_contact_name: "",
    p_external_id: `${identifier}:1`,
    p_type: "text",
    p_body: "hola",
    p_provider_timestamp: new Date().toISOString(),
    p_raw: {},
  });
  const { data: message } = await admin.from("messages").select("conversation_id").eq("external_id", `${identifier}:1`).single();
  conversationId = message?.conversation_id ?? "";
  const { data: conversation } = await admin.from("conversations").select("contact_id").eq("id", conversationId).single();
  contactId = conversation?.contact_id ?? "";
});

afterAll(async () => {
  await admin.from("organizations").delete().eq("id", organizationId);
});

describe("funciones de la base para los datos", () => {
  it("guardan la ficha del asociado sin borrar lo que ya estaba, y la auditoría marca al agente", async () => {
    expect((await admin.rpc("agent_save_contact_data", { p_conversation_id: conversationId, p_display_name: "Ana Prueba", p_document_number: "12.345.678", p_locality: "" })).error).toBeNull();
    expect((await admin.rpc("agent_save_contact_data", { p_conversation_id: conversationId, p_display_name: "", p_document_number: "", p_locality: "Villa Ejemplo" })).error).toBeNull();

    const { data: contact } = await admin.from("contacts").select("display_name, document_number, locality").eq("id", contactId).single();
    expect(contact).toEqual({ display_name: "Ana Prueba", document_number: "12345678", locality: "Villa Ejemplo" });

    const { data: audit } = await admin.from("audit_log").select("data").eq("entity_id", contactId).eq("action", "contact.updated");
    expect(audit?.length).toBeGreaterThanOrEqual(2);
    expect(audit?.every((row) => (row.data as { actor?: string }).actor === "agent")).toBe(true);
  });

  it("rechazan un documento con dígitos de menos", async () => {
    const { error } = await admin.rpc("agent_save_contact_data", { p_conversation_id: conversationId, p_display_name: "", p_document_number: "123", p_locality: "" });
    expect(error).not.toBeNull();
  });

  it("cuentan los intentos fallidos en el caso y los borran al validar", async () => {
    const first = await admin.rpc("agent_record_field_attempt", { p_conversation_id: conversationId, p_field: "dni", p_ok: false });
    const second = await admin.rpc("agent_record_field_attempt", { p_conversation_id: conversationId, p_field: "dni", p_ok: false });
    expect([first.data, second.data]).toEqual([1, 2]);

    const ok = await admin.rpc("agent_record_field_attempt", { p_conversation_id: conversationId, p_field: "dni", p_ok: true });
    expect(ok.data).toBe(0);
    const again = await admin.rpc("agent_record_field_attempt", { p_conversation_id: conversationId, p_field: "dni", p_ok: false });
    expect(again.data).toBe(1);

    expect((await admin.rpc("agent_record_field_attempt", { p_conversation_id: conversationId, p_field: "Mal Nombre!", p_ok: false })).error).not.toBeNull();
  });

  it("el estado del caso devuelve la unidad, los datos sin el contador y la ficha", async () => {
    await admin.rpc("agent_save_case_data", { p_conversation_id: conversationId, p_unit_slug: "", p_title: "Caso de prueba", p_data: { monto: "500000" } });
    const { data, error } = await admin.rpc("agent_case_snapshot", { p_conversation_id: conversationId });
    expect(error).toBeNull();
    expect(data).toEqual({
      unit: null,
      data: { monto: "500000" },
      contact: { name: "Ana Prueba", document: "12345678", locality: "Villa Ejemplo" },
    });
  });
});
