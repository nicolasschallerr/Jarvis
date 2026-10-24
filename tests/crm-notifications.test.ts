import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getUnreadNotifications, markAllNotificationsRead } from "../src/lib/crm/notifications";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Avisos al sector contra el proyecto de desarrollo. Usa organizaciones y usuarios propios con el
// prefijo "zz-test-".

const admin = adminClient();
const runId = randomId();
const orgIds: string[] = [];
const userIds: string[] = [];

let orgA = "";
let conversationId = "";
let member: TestUser;
let otherMember: TestUser;
let outsider: TestUser;
let viewerMember: TestUser;

beforeAll(async () => {
  const { data: org, error } = await admin
    .from("organizations")
    .insert({ slug: `zz-test-${runId}-avisos`, name: "Prueba Avisos" })
    .select("id")
    .single();
  if (error || !org) throw new Error(`No se pudo crear la organización: ${error?.message}`);
  orgA = org.id;
  orgIds.push(orgA);

  member = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "av-miembro", runId });
  otherMember = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "av-miembro2", runId });
  outsider = await createTestUser(admin, { organizationId: orgA, role: "operator", label: "av-otro", runId });
  viewerMember = await createTestUser(admin, { organizationId: orgA, role: "viewer", label: "av-viewer", runId });
  userIds.push(member.id, otherMember.id, outsider.id, viewerMember.id);

  const { data: sectors } = await admin
    .from("sectors")
    .insert([
      { organization_id: orgA, slug: "viajes", name: "Viajes" },
      { organization_id: orgA, slug: "creditos", name: "Créditos" },
    ])
    .select("id, slug");
  const viajes = sectors?.find((sector) => sector.slug === "viajes")?.id ?? "";
  await admin.from("sector_members").insert([
    { sector_id: viajes, profile_id: member.id, organization_id: orgA },
    { sector_id: viajes, profile_id: otherMember.id, organization_id: orgA },
    { sector_id: viajes, profile_id: viewerMember.id, organization_id: orgA },
  ]);

  const { data: channel } = await admin
    .from("channels")
    .insert({ organization_id: orgA, type: "telegram", name: "Bot", external_id: `zz-test-${runId}-av` })
    .select("id")
    .single();
  const identifier = `7${Date.now().toString().slice(-8)}`;
  await admin.rpc("ingest_inbound_message", {
    p_organization_id: orgA,
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
  conversationId = message?.conversation_id ?? "";
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().in("id", orgIds);
});

describe("avisos al sector", () => {
  it("una consulta al área avisa a las personas del sector, no al resto ni a usuarios de consulta", async () => {
    const { error } = await admin.rpc("agent_ask_area", { p_conversation_id: conversationId, p_sector_slug: "viajes", p_question: "¿Hay cupo?" });
    expect(error).toBeNull();

    const mine = await getUnreadNotifications({ userClient: member.client, userId: member.id });
    expect(mine.unread).toBe(1);
    expect(mine.items[0]).toMatchObject({ type: "area_query", title: "Consulta pendiente para Viajes" });
    expect(mine.items[0]?.cases?.conversation_id).toBe(conversationId);

    expect((await getUnreadNotifications({ userClient: otherMember.client, userId: otherMember.id })).unread).toBe(1);
    expect((await getUnreadNotifications({ userClient: outsider.client, userId: outsider.id })).unread).toBe(0);
    expect((await getUnreadNotifications({ userClient: viewerMember.client, userId: viewerMember.id })).unread).toBe(0);
  });

  it("el aviso no incluye el texto de la consulta", async () => {
    const { data } = await admin.from("notifications").select("title, body").eq("profile_id", member.id);
    expect(JSON.stringify(data)).not.toContain("¿Hay cupo?");
  });

  it("una derivación también avisa", async () => {
    await admin.rpc("agent_handoff_case", { p_conversation_id: conversationId, p_sector_slug: "viajes", p_summary: "Resumen" });
    const mine = await getUnreadNotifications({ userClient: member.client, userId: member.id });
    expect(mine.unread).toBe(2);
    expect(mine.items[0]?.type).toBe("case_handoff");
  });

  it("marcar como leídos solo toca los avisos propios", async () => {
    expect(await markAllNotificationsRead({ userClient: member.client, userId: member.id })).toEqual({ ok: true });
    expect((await getUnreadNotifications({ userClient: member.client, userId: member.id })).unread).toBe(0);
    // El otro miembro sigue con los suyos sin leer.
    expect((await getUnreadNotifications({ userClient: otherMember.client, userId: otherMember.id })).unread).toBe(2);

    // Aunque se pidiera con el id de otro, RLS no deja tocar sus filas.
    await markAllNotificationsRead({ userClient: outsider.client, userId: otherMember.id });
    expect((await getUnreadNotifications({ userClient: otherMember.client, userId: otherMember.id })).unread).toBe(2);
  });

  it("una derivación a un sector sin personas no falla", async () => {
    const { error } = await admin.rpc("agent_handoff_case", { p_conversation_id: conversationId, p_sector_slug: "creditos", p_summary: "Otro" });
    expect(error).toBeNull();
  });
});
