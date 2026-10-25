import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { followupTemplateValues } from "../src/lib/followups/run";
import { listWhatsAppTemplates } from "../src/lib/outbound/whatsapp";
import { sendTemplateMessage, syncTemplates, TemplateError } from "../src/lib/whatsapp/service";
import {
  buildTemplatePayload,
  checkValues,
  parameterFormatOf,
  renderTemplate,
  rowFromMeta,
  statusFromMeta,
  templateVariables,
} from "../src/lib/whatsapp/templates";
import { adminClient, randomId } from "./helpers/supabase-test";

// Plantillas de WhatsApp (Fase 9, ADR-030). Las llamadas a Meta son falsas: no se manda nada real. Datos inventados.

describe("plantillas: variables y armado del pedido", () => {
  it("lee las variables en orden y sin repetir, posicionales o con nombre", () => {
    expect(templateVariables("Hola {{1}}, tu turno es el {{2}}. Gracias {{1}}")).toEqual(["1", "2"]);
    expect(templateVariables("Hola {{ nombre }}, tu caso {{numero}}")).toEqual(["nombre", "numero"]);
    expect(parameterFormatOf("Hola {{1}}")).toBe("positional");
    expect(parameterFormatOf("Hola {{nombre}}")).toBe("named");
    expect(parameterFormatOf("Sin variables")).toBe("positional");
  });

  it("completa el texto y limpia lo que Meta rechaza (saltos de línea, espacios de más)", () => {
    expect(renderTemplate("Hola {{1}}, ¿seguimos?", { "1": "Ana\nPrueba" })).toBe("Hola Ana Prueba, ¿seguimos?");
    expect(checkValues("Hola {{1}} y {{2}}", { "1": "Ana" })).toEqual({ ok: false, error: "Completá la variable {{2}}." });
    expect(checkValues("Hola {{1}}", { "1": "  Ana  " })).toEqual({ ok: true, values: { "1": "Ana" } });
  });

  it("arma el pedido de la Cloud API con parámetros posicionales", () => {
    expect(
      buildTemplatePayload({ to: "5490000000001", name: "recordatorio", language: "es_AR", body: "Hola {{1}}", format: "positional", values: { "1": "Ana" } }),
    ).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "+5490000000001",
      type: "template",
      template: { name: "recordatorio", language: { code: "es_AR" }, components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }] }] },
    });
  });

  it("con parámetros con nombre agrega parameter_name; sin variables no manda componentes", () => {
    const named = buildTemplatePayload({ to: "+549", name: "x", language: "es", body: "Hola {{nombre}}", format: "named", values: { nombre: "Ana" } });
    expect(named.template).toMatchObject({ components: [{ type: "body", parameters: [{ type: "text", parameter_name: "nombre", text: "Ana" }] }] });
    const plain = buildTemplatePayload({ to: "+549", name: "x", language: "es", body: "Hola", format: "positional", values: {} });
    expect(plain.template).toEqual({ name: "x", language: { code: "es" } });
  });

  it("traduce los estados de Meta y descarta plantillas sin cuerpo", () => {
    expect(statusFromMeta("APPROVED")).toBe("approved");
    expect(statusFromMeta("PENDING")).toBe("submitted");
    expect(statusFromMeta("REJECTED")).toBe("rejected");
    expect(statusFromMeta("PAUSED")).toBe("paused");
    expect(statusFromMeta("DISABLED")).toBe("disabled");
    expect(rowFromMeta({ name: "x", language: "es", components: [{ type: "HEADER", text: "x" }] })).toBeNull();
    expect(rowFromMeta({ name: "x", language: "es", status: "REJECTED", rejected_reason: "NONE", components: [{ type: "BODY", text: "Hola {{nombre}}" }] })).toMatchObject({
      meta_status: "rejected",
      parameter_format: "named",
      rejected_reason: null,
    });
  });

  it("los seguimientos completan la plantilla con datos conocidos o no la usan", () => {
    const known = { contact: "Ana", agent: "Sofía", organization: "Cooperativa Ejemplo" };
    expect(followupTemplateValues("Hola {{1}}, soy {{2}} de {{3}}", known)).toEqual({ "1": "Ana", "2": "Sofía", "3": "Cooperativa Ejemplo" });
    expect(followupTemplateValues("Hola {{nombre}}", known)).toEqual({ nombre: "Ana" });
    expect(followupTemplateValues("Tu turno es el {{fecha}}", known)).toBeNull();
    expect(followupTemplateValues("Hola {{1}}", { ...known, contact: "" })).toBeNull();
  });
});

describe("listado de plantillas de Meta", () => {
  it("sigue las páginas y solo hacia graph.facebook.com", async () => {
    const urls: string[] = [];
    const pages = [
      { data: [{ name: "a" }], paging: { next: "https://graph.facebook.com/v23.0/1/message_templates?after=x" } },
      { data: [{ name: "b" }], paging: { next: "https://otro-dominio.example/robar" } },
    ];
    const fetchImpl = async (url: string) => {
      urls.push(url);
      return new Response(JSON.stringify(pages[urls.length - 1]), { status: 200 });
    };
    const list = await listWhatsAppTemplates({ token: "t", wabaId: "1234567", fetchImpl });
    expect(list).toHaveLength(2);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("/1234567/message_templates?fields=");
  });
});

// --- Contra la base de desarrollo -------------------------------------------------------------------------------

const admin = adminClient();
const runId = randomId();
const tokenVar = `WHATSAPP_ACCESS_TOKEN_ZZTEST_${runId.toUpperCase()}`;
const orgIds: string[] = [];
let channelId = "";
let conversationId = "";
let contactId = "";
let approvedId = "";
let pendingId = "";
let foreignTemplateId = "";

const metaSent: Array<{ url: string; body: Record<string, unknown> }> = [];
const fakeMeta = async (url: string, init: RequestInit) => {
  metaSent.push({ url, body: JSON.parse(String(init.body)) as Record<string, unknown> });
  return new Response(JSON.stringify({ messaging_product: "whatsapp", contacts: [{ wa_id: "549" }], messages: [{ id: `wamid.${runId}.${metaSent.length}` }] }), { status: 200 });
};

beforeAll(async () => {
  process.env[tokenVar] = "token-de-prueba";
  for (const label of ["a", "b"]) {
    const { data, error } = await admin.from("organizations").insert({ slug: `zz-test-${runId}-tpl-${label}`, name: `Prueba Plantillas ${label}` }).select("id").single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  const [orgA = "", orgB = ""] = orgIds;

  const { data: channel, error: channelError } = await admin
    .from("channels")
    .insert({ organization_id: orgA, type: "whatsapp", name: "WhatsApp prueba", external_id: `99${Date.now()}`, secret_ref: tokenVar, config: { waba_id: "1234567890" } })
    .select("id")
    .single();
  if (channelError || !channel) throw new Error(`No se pudo crear el canal: ${channelError?.message}`);
  channelId = channel.id;

  // El contacto escribió hace 3 días: la ventana de 24 h está cerrada.
  const { error: ingestError } = await admin.rpc("ingest_inbound_message", {
    p_organization_id: orgA,
    p_channel_id: channelId,
    p_channel_type: "whatsapp",
    p_identifier: `54900${Date.now().toString().slice(-6)}`,
    p_contact_name: "Ana Prueba",
    p_external_id: `wamid.in.${runId}`,
    p_type: "text",
    p_body: "hola",
    p_provider_timestamp: new Date(Date.now() - 72 * 3_600_000).toISOString(),
    p_raw: {},
  });
  if (ingestError) throw new Error(`No se pudo sembrar el mensaje: ${ingestError.message}`);
  const { data: conversation } = await admin.from("conversations").select("id, contact_id").eq("channel_id", channelId).single();
  conversationId = conversation?.id ?? "";
  contactId = conversation?.contact_id ?? "";

  const rows = [
    { organization_id: orgA, channel_id: channelId, name: "recordatorio", language: "es_AR", body: "Hola {{1}}, ¿seguimos con tu consulta?", meta_status: "approved" as const },
    { organization_id: orgA, channel_id: channelId, name: "en_revision", language: "es_AR", body: "Hola {{1}}", meta_status: "submitted" as const },
    { organization_id: orgB, channel_id: null, name: "ajena", language: "es_AR", body: "Hola", meta_status: "approved" as const },
  ];
  const { data: templates, error: templateError } = await admin.from("message_templates").insert(rows).select("id, name");
  if (templateError || !templates) throw new Error(`No se pudieron crear las plantillas: ${templateError?.message}`);
  approvedId = templates.find((row) => row.name === "recordatorio")?.id ?? "";
  pendingId = templates.find((row) => row.name === "en_revision")?.id ?? "";
  foreignTemplateId = templates.find((row) => row.name === "ajena")?.id ?? "";
});

afterAll(async () => {
  delete process.env[tokenVar];
  await admin.from("organizations").delete().in("id", orgIds);
});

describe("envío de plantillas", () => {
  it("con la ventana cerrada, una plantilla aprobada sale y queda en la conversación con el texto completo", async () => {
    const sent = await sendTemplateMessage(admin, { conversationId, templateId: approvedId, values: { "1": "Ana" }, sender: "operator", fetchImpl: fakeMeta });
    expect(sent.text).toBe("Hola Ana, ¿seguimos con tu consulta?");

    const last = metaSent.at(-1);
    expect(last?.url).toMatch(/\/v\d+\.\d+\/\d+\/messages$/);
    expect(last?.body).toMatchObject({ type: "template", template: { name: "recordatorio", language: { code: "es_AR" } } });

    const { data } = await admin.from("messages").select("body, status, template_id, external_id").eq("id", sent.messageId).single();
    expect(data).toMatchObject({ body: "Hola Ana, ¿seguimos con tu consulta?", status: "sent", template_id: approvedId });
  });

  it("no envía una plantilla en revisión ni una de otra organización", async () => {
    const before = metaSent.length;
    await expect(sendTemplateMessage(admin, { conversationId, templateId: pendingId, values: { "1": "Ana" }, sender: "operator", fetchImpl: fakeMeta })).rejects.toThrow(
      "aprobadas",
    );
    await expect(sendTemplateMessage(admin, { conversationId, templateId: foreignTemplateId, values: {}, sender: "operator", fetchImpl: fakeMeta })).rejects.toBeInstanceOf(
      TemplateError,
    );
    expect(metaSent.length).toBe(before);
  });

  it("pide completar las variables y respeta la baja del contacto", async () => {
    await expect(sendTemplateMessage(admin, { conversationId, templateId: approvedId, values: {}, sender: "operator", fetchImpl: fakeMeta })).rejects.toThrow("{{1}}");

    await admin.from("contacts").update({ opted_out_at: new Date().toISOString() }).eq("id", contactId);
    await expect(sendTemplateMessage(admin, { conversationId, templateId: approvedId, values: { "1": "Ana" }, sender: "operator", fetchImpl: fakeMeta })).rejects.toThrow(
      "no recibir",
    );
    await admin.from("contacts").update({ opted_out_at: null }).eq("id", contactId);
  });

  it("si Meta rechaza el pedido, el mensaje queda como fallido con el motivo", async () => {
    const rejecting = async () => new Response(JSON.stringify({ error: { message: "Template name does not exist", code: 132001 } }), { status: 400 });
    await expect(sendTemplateMessage(admin, { conversationId, templateId: approvedId, values: { "1": "Ana" }, sender: "operator", fetchImpl: rejecting })).rejects.toThrow(
      "Meta:",
    );
    const { data } = await admin.from("messages").select("status").eq("conversation_id", conversationId).eq("status", "failed");
    expect(data?.length).toBeGreaterThan(0);
  });
});

describe("sincronización con Meta", () => {
  it("guarda y actualiza las plantillas del canal, y desactiva las que Meta ya no devuelve", async () => {
    const [orgA = ""] = orgIds;
    const meta = {
      data: [
        { id: "111", name: "recordatorio", language: "es_AR", status: "APPROVED", category: "UTILITY", components: [{ type: "BODY", text: "Hola {{1}}, ¿seguimos?" }] },
        { id: "222", name: "promo", language: "es_AR", status: "REJECTED", category: "MARKETING", rejected_reason: "INVALID_FORMAT", components: [{ type: "BODY", text: "Oferta" }] },
      ],
    };
    const result = await syncTemplates(admin, orgA, { fetchImpl: async () => new Response(JSON.stringify(meta), { status: 200 }) });
    expect(result).toMatchObject({ synced: 2, channels: 1, problems: [] });

    const { data } = await admin.from("message_templates").select("name, meta_status, body, category, rejected_reason, meta_template_id").eq("organization_id", orgA).order("name");
    expect(data).toEqual([
      { name: "en_revision", meta_status: "disabled", body: "Hola {{1}}", category: null, rejected_reason: null, meta_template_id: null },
      { name: "promo", meta_status: "rejected", body: "Oferta", category: "marketing", rejected_reason: "INVALID_FORMAT", meta_template_id: "222" },
      { name: "recordatorio", meta_status: "approved", body: "Hola {{1}}, ¿seguimos?", category: "utility", rejected_reason: null, meta_template_id: "111" },
    ]);
  });

  it("explica qué falta si el canal no tiene la cuenta de WhatsApp Business configurada", async () => {
    const [, orgB = ""] = orgIds;
    const result = await syncTemplates(admin, orgB, { fetchImpl: async () => new Response("{}", { status: 200 }) });
    expect(result.channels).toBe(0);
    expect(result.problems[0]).toContain("WhatsApp");
  });
});
