import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getUnreadNotifications } from "../src/lib/crm/notifications";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Un segundo tema en la misma conversación (ADR-040): el caso ya derivado a un sector no se pisa. Datos inventados.

const admin = adminClient();
const runId = randomId();
let orgId = "";
const userIds: string[] = [];
let travelMember: TestUser;
let creditMember: TestUser;
const sectorIds: Record<string, string> = {};

async function newConversation(label: string) {
  const { data: channel } = await admin.from("channels").select("id").eq("organization_id", orgId).eq("external_id", `zz-test-${runId}-tp`).single();
  const identifier = `5${label}${Date.now().toString().slice(-6)}`;
  await admin.rpc("ingest_inbound_message", {
    p_organization_id: orgId,
    p_channel_id: channel?.id ?? "",
    p_channel_type: "telegram",
    p_identifier: identifier,
    p_contact_name: "Ana Prueba",
    p_external_id: `${identifier}:1`,
    p_type: "text",
    p_body: "hola",
    p_provider_timestamp: new Date().toISOString(),
    p_raw: {},
  });
  const { data: message } = await admin.from("messages").select("conversation_id").eq("external_id", `${identifier}:1`).single();
  return message?.conversation_id ?? "";
}

const handoff = (conversationId: string, sector: string, summary: string) => admin.rpc("agent_handoff_case", { p_conversation_id: conversationId, p_sector_slug: sector, p_summary: summary });

const caseOf = async (conversationId: string) => {
  const { data } = await admin.from("cases").select("id, sector_id, summary, status, priority").eq("conversation_id", conversationId).neq("status", "resolved").single();
  return data;
};

beforeAll(async () => {
  const { data: org, error } = await admin.from("organizations").insert({ slug: `zz-test-${runId}-tema`, name: "Prueba Segundo Tema" }).select("id").single();
  if (error || !org) throw new Error(`No se pudo crear la organización: ${error?.message}`);
  orgId = org.id;

  travelMember = await createTestUser(admin, { organizationId: orgId, role: "operator", label: "viajes", runId });
  creditMember = await createTestUser(admin, { organizationId: orgId, role: "operator", label: "creditos", runId });
  userIds.push(travelMember.id, creditMember.id);

  const { data: sectors } = await admin
    .from("sectors")
    .insert([
      { organization_id: orgId, slug: "viajes", name: "Viajes" },
      { organization_id: orgId, slug: "creditos", name: "Créditos" },
    ])
    .select("id, slug");
  for (const sector of sectors ?? []) sectorIds[sector.slug] = sector.id;
  await admin.from("sector_members").insert([
    { sector_id: sectorIds.viajes ?? "", profile_id: travelMember.id, organization_id: orgId },
    { sector_id: sectorIds.creditos ?? "", profile_id: creditMember.id, organization_id: orgId },
  ]);
  await admin.from("channels").insert({ organization_id: orgId, type: "telegram", name: "Bot", external_id: `zz-test-${runId}-tp` });
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().eq("id", orgId);
});

describe("segundo tema en la conversación", () => {
  it("la primera derivación asigna el sector y el resumen, como siempre", async () => {
    const conversation = await newConversation("a");
    const { error } = await handoff(conversation, "viajes", "Quiere cotizar un viaje a las sierras en marzo.");
    expect(error).toBeNull();
    const found = await caseOf(conversation);
    expect(found).toMatchObject({ sector_id: sectorIds.viajes, summary: "Quiere cotizar un viaje a las sierras en marzo.", status: "new" });
  });

  it("un segundo tema para OTRO sector no pisa el caso: se suma al resumen y avisa al sector nuevo", async () => {
    const conversation = await newConversation("b");
    await handoff(conversation, "viajes", "Quiere cotizar un viaje a las sierras en marzo.");
    const before = await caseOf(conversation);
    await admin.from("cases").update({ status: "in_progress" }).eq("id", before?.id ?? "");

    const { error } = await handoff(conversation, "creditos", "Pregunta por las condiciones de un crédito de 500 mil.");
    expect(error).toBeNull();

    const after = await caseOf(conversation);
    // El caso sigue en Viajes y en curso: nadie le sacó nada al sector que ya lo tenía.
    expect(after).toMatchObject({ id: before?.id, sector_id: sectorIds.viajes, status: "in_progress" });
    expect(after?.summary).toContain("Quiere cotizar un viaje a las sierras en marzo.");
    expect(after?.summary).toContain("Otro tema, para Créditos: Pregunta por las condiciones de un crédito de 500 mil.");

    // Créditos recibe su aviso con el resumen de lo suyo.
    const mine = await getUnreadNotifications({ userClient: creditMember.client, userId: creditMember.id });
    expect(mine.items.find((item) => item.title === "Consulta nueva para Créditos")?.body).toBe("Pregunta por las condiciones de un crédito de 500 mil.");
  });

  it("otra derivación al MISMO sector actualiza el resumen, como siempre", async () => {
    const conversation = await newConversation("c");
    await handoff(conversation, "viajes", "Primer resumen.");
    await handoff(conversation, "viajes", "Resumen actualizado.");
    expect((await caseOf(conversation))?.summary).toBe("Resumen actualizado.");
  });

  it("un tercer tema sigue sumándose, y el resumen no crece sin límite", async () => {
    const conversation = await newConversation("d");
    await handoff(conversation, "viajes", "Primero.");
    for (let index = 0; index < 5; index += 1) await handoff(conversation, "creditos", `Tema de créditos número ${index} ${"x".repeat(900)}`);
    const found = await caseOf(conversation);
    expect(found?.sector_id).toBe(sectorIds.viajes);
    expect((found?.summary ?? "").length).toBeLessThanOrEqual(4000);
    expect(found?.summary?.startsWith("Primero.")).toBe(true);
  });

  it("un sector que no existe sigue dando error y no cambia el caso", async () => {
    const conversation = await newConversation("e");
    await handoff(conversation, "viajes", "Primero.");
    const { error } = await handoff(conversation, "inventado", "Nada");
    expect(error?.message).toContain("Sector desconocido");
    expect((await caseOf(conversation))?.summary).toBe("Primero.");
  });
});
