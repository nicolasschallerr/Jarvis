import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { actorLabel, auditQueryFrom, describeAudit, listAudit } from "../src/lib/audit/list";
import { setConversationAi } from "../src/lib/crm/ai-switch";
import { csvCell, toCsv } from "../src/lib/export/csv";
import { auditCsv, canExport, casesCsv, contactsCsv, consumptionCsv, exportDate, isExportType } from "../src/lib/export/datasets";
import { createMember, setMemberRole } from "../src/lib/team/members";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Auditoría ampliada y exportaciones (ADR-035). Datos inventados; organizaciones y usuarios propios "zz-test-".

describe("CSV", () => {
  it("escapa comas, comillas y saltos de línea", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('dijo "hola"')).toBe('"dijo ""hola"""');
    expect(csvCell("línea 1\nlínea 2")).toBe('"línea 1\nlínea 2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(7)).toBe("7");
  });

  it("neutraliza las fórmulas (un nombre que empieza con = + - @ no se ejecuta en la planilla)", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvCell("+549 3420000000")).toBe("'+549 3420000000");
    expect(csvCell("@usuario")).toBe("'@usuario");
    expect(csvCell("-cmd")).toBe("'-cmd");
    // Un número negativo de verdad no es una fórmula.
    expect(csvCell(-5)).toBe("-5");
  });

  it("arma el archivo con marca para Excel y fin de línea CRLF", () => {
    const csv = toCsv(["Nombre", "Notas"], [["Ana Prueba", "hola, mundo"]]);
    expect(csv.startsWith("﻿Nombre,Notas\r\n")).toBe(true);
    expect(csv).toContain('Ana Prueba,"hola, mundo"\r\n');
  });

  it("las fechas salen en horario de Argentina", () => {
    expect(exportDate("2026-10-25T15:03:00Z")).toBe("2026-10-25 12:03");
    expect(exportDate(null)).toBe("");
  });
});

describe("qué se puede exportar y quién puede", () => {
  it("los datos personales y la auditoría son solo del superadmin; el operador no exporta", () => {
    expect(canExport("superadmin", "contactos")).toBe(true);
    expect(canExport("viewer", "contactos")).toBe(false);
    expect(canExport("superadmin", "auditoria")).toBe(true);
    expect(canExport("viewer", "auditoria")).toBe(false);
    expect(canExport("viewer", "casos")).toBe(true);
    expect(canExport("viewer", "consumo")).toBe(true);
    expect(canExport("operator", "casos")).toBe(false);
    expect(isExportType("casos")).toBe(true);
    expect(isExportType("../etc/passwd")).toBe(false);
  });

  it("el filtro de la auditoría ignora valores raros", () => {
    expect(auditQueryFrom({ tipo: "contact", ver: "100" })).toEqual({ group: "contact", limit: 100 });
    expect(auditQueryFrom({ tipo: "xx", ver: "-4" })).toEqual({ group: "todo", limit: 50 });
    expect(auditQueryFrom({ ver: "999999" }).limit).toBe(500);
  });

  it("describe las acciones en español, sin datos personales", () => {
    const names = new Map([["p1", "Laura Gómez"]]);
    expect(describeAudit({ action: "conversation.ai_toggled", data: { enabled: false } }, names)).toContain("Tomó una conversación");
    expect(describeAudit({ action: "sector.member_added", data: { profile_id: "p1" } }, names)).toBe("Sumó a Laura Gómez a un sector");
    expect(describeAudit({ action: "contact.updated", data: { fields: ["document_number", "locality"] } }, names)).toBe("Editó la ficha de un contacto (documento, localidad)");
    expect(describeAudit({ action: "algo.raro", data: {} }, names)).toBe("algo.raro");
    expect(actorLabel({ actorId: null, data: { actor: "agent" } }, names)).toBe("Agente");
    expect(actorLabel({ actorId: null, data: {} }, names)).toBe("Sistema");
    expect(actorLabel({ actorId: "p1", data: {} }, names)).toBe("Laura Gómez");
  });
});

const admin = adminClient();
const runId = randomId();
const orgIds: string[] = [];
const userIds: string[] = [];
let orgA = "";
let orgB = "";
let boss: TestUser;
let operator: TestUser;
let viewer: TestUser;
let foreign: TestUser;
let conversationId = "";
let channelId = "";

beforeAll(async () => {
  for (const label of ["a", "b"]) {
    const { data, error } = await admin.from("organizations").insert({ slug: `zz-test-${runId}-aud-${label}`, name: `Prueba Auditoría ${label}` }).select("id").single();
    if (error || !data) throw new Error(`No se pudo crear la organización: ${error?.message}`);
    orgIds.push(data.id);
  }
  [orgA = "", orgB = ""] = orgIds;
  boss = await createTestUser(admin, { organizationId: orgA, role: "superadmin", label: "aud-boss", runId });
  operator = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "aud-op", runId });
  viewer = await createTestUser(admin, { organizationId: orgA, role: "viewer", label: "aud-viewer", runId });
  foreign = await createTestUser(admin, { organizationId: orgB, role: "superadmin", label: "aud-ajeno", runId });
  userIds.push(boss.id, operator.id, viewer.id, foreign.id);

  const { data: channel, error: channelError } = await admin
    .from("channels")
    .insert({ organization_id: orgA, type: "telegram", name: "Canal auditado", external_id: `zz-test-${runId}-aud`, secret_ref: "CHANNEL_TOKEN_ZZTEST_SECRETO" })
    .select("id")
    .single();
  if (channelError || !channel) throw new Error(`No se pudo crear el canal: ${channelError?.message}`);
  channelId = channel.id;

  const { error: ingestError } = await admin.rpc("ingest_inbound_message", {
    p_organization_id: orgA,
    p_channel_id: channelId,
    p_channel_type: "telegram",
    p_identifier: `7${Date.now().toString().slice(-8)}`,
    p_contact_name: "Ana Prueba",
    p_external_id: `${runId}-aud:1`,
    p_type: "text",
    p_body: "hola",
    p_provider_timestamp: new Date().toISOString(),
    p_raw: {},
  });
  if (ingestError) throw new Error(`No se pudo sembrar el mensaje: ${ingestError.message}`);
  const { data: conversation } = await admin.from("conversations").select("id, contact_id").eq("channel_id", channelId).single();
  conversationId = conversation?.id ?? "";

  // Un caso con un título que parece fórmula (para probar el CSV con datos reales).
  await admin.from("cases").insert({ organization_id: orgA, contact_id: conversation?.contact_id ?? "", conversation_id: conversationId, title: "=1+1 caso raro", status: "new" });
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

describe("disparadores de auditoría", () => {
  it("tomar el chat deja registro con quién lo hizo", async () => {
    const result = await setConversationAi({ userClient: operator.client, profile: { id: operator.id, role: "operator" }, conversationId, enabled: false });
    expect(result.ok).toBe(true);

    const { data } = await admin.from("audit_log").select("actor_profile_id, data").eq("organization_id", orgA).eq("action", "conversation.ai_toggled").eq("entity_id", conversationId);
    expect(data).toEqual([{ actor_profile_id: operator.id, data: { enabled: false } }]);
  });

  it("cambiar un canal queda registrado, sin el token ni datos internos", async () => {
    const { error } = await boss.client.from("channels").update({ name: "Canal renombrado" }).eq("id", channelId);
    expect(error).toBeNull();
    const { data } = await admin.from("audit_log").select("actor_profile_id, data").eq("organization_id", orgA).eq("action", "channel.updated");
    expect(data).toHaveLength(1);
    expect(data?.[0]?.actor_profile_id).toBe(boss.id);
    expect(JSON.stringify(data?.[0]?.data)).not.toContain("SECRETO");
    expect(data?.[0]?.data).toMatchObject({ name: "Canal renombrado", type: "telegram" });
  });

  it("lo que cambia el servidor, sin persona, queda como Sistema; lo de una persona, con su nombre", async () => {
    // Al tomar el chat, el operador quedó asignado (registro con su nombre). Ahora el servidor reasigna.
    await admin.from("conversations").update({ assigned_to: boss.id }).eq("id", conversationId);
    const { data } = await admin
      .from("audit_log")
      .select("actor_profile_id, data")
      .eq("organization_id", orgA)
      .eq("action", "conversation.assigned")
      .order("created_at");
    expect(data).toHaveLength(2);
    expect(data?.[0]).toMatchObject({ actor_profile_id: operator.id, data: { to: operator.id } });
    expect(data?.[1]).toMatchObject({ actor_profile_id: null, data: { from: operator.id, to: boss.id } });
  });

  it("alta y cambio de rol de una persona dejan registro con el nombre de quien lo hizo y sin el email", async () => {
    const created = await createMember(admin, { organizationId: orgA, email: `zz-test-${runId}-nuevo@example.test`, fullName: "Nora Prueba", role: "operator", siteUrl: "https://orbita.test", actorId: boss.id });
    expect(created.ok).toBe(true);
    const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
    const newId = users.users.find((user) => user.email === `zz-test-${runId}-nuevo@example.test`)?.id ?? "";
    userIds.push(newId);

    await setMemberRole(admin, { organizationId: orgA, actorId: boss.id, userId: newId, role: "viewer" });

    const { data } = await admin.from("audit_log").select("action, actor_profile_id, data").eq("organization_id", orgA).like("action", "person.%").order("created_at");
    expect(data?.map((row) => row.action)).toEqual(["person.created", "person.role_changed"]);
    expect(data?.every((row) => row.actor_profile_id === boss.id)).toBe(true);
    expect(JSON.stringify(data)).not.toContain("@example.test");
    expect(data?.[1]?.data).toMatchObject({ name: "Nora Prueba", from: "operator", to: "viewer" });
  });
});

describe("quién puede leer el registro", () => {
  it("el superadmin lee el de su organización; el operador, el de consulta y otra organización, nada", async () => {
    const own = await listAudit({ userClient: boss.client, group: "todo", limit: 50 });
    expect(own.failed).toBe(false);
    expect(own.items.length).toBeGreaterThan(3);
    expect(own.items.every((item) => item.action.length > 0)).toBe(true);

    expect((await listAudit({ userClient: operator.client, group: "todo", limit: 50 })).items).toHaveLength(0);
    expect((await listAudit({ userClient: viewer.client, group: "todo", limit: 50 })).items).toHaveLength(0);
    expect((await listAudit({ userClient: foreign.client, group: "todo", limit: 50 })).items).toHaveLength(0);
  });

  it("filtra por tipo de movimiento", async () => {
    const people = await listAudit({ userClient: boss.client, group: "person", limit: 50 });
    expect(people.items.length).toBeGreaterThan(0);
    expect(people.items.every((item) => item.action.startsWith("person."))).toBe(true);
  });

  it("nadie puede escribir en el registro con su sesión", async () => {
    const { error } = await boss.client.from("audit_log").insert({ organization_id: orgA, action: "falso", entity_type: "x" });
    expect(error).not.toBeNull();
  });
});

describe("exportaciones con datos reales", () => {
  it("casos: encabezado, fila y fórmula neutralizada; otra organización no ve nada", async () => {
    const mine = await casesCsv(boss.client);
    expect(mine.rows).toBe(1);
    expect(mine.csv).toContain("Título,Estado,Prioridad");
    expect(mine.csv).toContain("'=1+1 caso raro");
    expect(mine.csv).toContain("Ana Prueba");
    expect(mine.truncated).toBe(false);

    expect((await casesCsv(foreign.client)).rows).toBe(0);
    // Consulta y reportes puede leer los casos para exportarlos.
    expect((await casesCsv(viewer.client)).rows).toBe(1);
  });

  it("contactos: nombre y canal; sin duplicar ni mostrar otra organización", async () => {
    const mine = await contactsCsv(boss.client);
    expect(mine.csv).toContain("Ana Prueba");
    expect(mine.csv).toContain("Telegram");
    expect((await contactsCsv(foreign.client)).rows).toBe(0);
  });

  it("consumo: una fila por día y el total", async () => {
    const result = await consumptionCsv(boss.client, undefined);
    expect(result.csv.startsWith("﻿Día,Créditos")).toBe(true);
    expect(result.csv).toContain("Total ");
    expect(result.rows).toBeGreaterThan(0);
  });

  it("auditoría: legible y solo para quien puede leerla", async () => {
    const mine = await auditCsv(boss.client);
    expect(mine.csv).toContain("Tomó una conversación");
    expect(mine.csv).toContain("Nora Prueba");
    expect((await auditCsv(operator.client)).rows).toBe(0);
  });
});
