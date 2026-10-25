import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { listNotifications, markNotificationRead, noticeTarget } from "../src/lib/crm/notifications";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Pantalla de avisos (listar, marcar, destino). Datos inventados; organización y usuarios propios "zz-test-".

describe("a dónde lleva un aviso", () => {
  it("a la conversación del caso, a Consumo, o a ningún lado; nunca a una dirección externa", () => {
    expect(noticeTarget({ type: "case_assigned", cases: { conversation_id: "c-1" } })).toBe("/conversaciones/c-1");
    expect(noticeTarget({ type: "usage_limit", cases: null })).toBe("/consumo");
    expect(noticeTarget({ type: "otro", cases: null })).toBeNull();
    expect(noticeTarget({ type: "otro", cases: { conversation_id: null } })).toBeNull();
  });
});

const admin = adminClient();
const runId = randomId();
let orgId = "";
let ana: TestUser;
let beto: TestUser;
const userIds: string[] = [];

beforeAll(async () => {
  const { data: org, error } = await admin.from("organizations").insert({ slug: `zz-test-${runId}-avisos`, name: "Prueba Avisos" }).select("id").single();
  if (error || !org) throw new Error(`No se pudo crear la organización: ${error?.message}`);
  orgId = org.id;
  ana = await createTestUser(admin, { organizationId: orgId, role: "operator", label: "av-ana", runId });
  beto = await createTestUser(admin, { organizationId: orgId, role: "operator", label: "av-beto", runId });
  userIds.push(ana.id, beto.id);

  // 4 avisos para una persona (uno ya leído) y 1 para la otra; las filas con las mismas claves (lección 42).
  const base = Date.now() - 60_000;
  const rows = [0, 1, 2, 3].map((index) => ({
    organization_id: orgId,
    profile_id: ana.id,
    type: "usage_limit",
    title: `Aviso ${index}`,
    body: null,
    read_at: index === 0 ? new Date().toISOString() : null,
    created_at: new Date(base + index * 1000).toISOString(),
  }));
  rows.push({ organization_id: orgId, profile_id: beto.id, type: "usage_limit", title: "Aviso de Beto", body: null, read_at: null, created_at: new Date(base).toISOString() });
  const { error: insertError } = await admin.from("notifications").insert(rows);
  if (insertError) throw new Error(`No se pudieron crear los avisos: ${insertError.message}`);
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().eq("id", orgId);
});

describe("lista de avisos", () => {
  it("sin leer: solo los sin leer propios, del más nuevo al más viejo", async () => {
    const { items, hasMore } = await listNotifications({ userClient: ana.client, userId: ana.id, onlyUnread: true, limit: 10 });
    expect(items.map((item) => item.title)).toEqual(["Aviso 3", "Aviso 2", "Aviso 1"]);
    expect(hasMore).toBe(false);
  });

  it("todos: también los leídos; y pagina avisando si hay más", async () => {
    const all = await listNotifications({ userClient: ana.client, userId: ana.id, onlyUnread: false, limit: 10 });
    expect(all.items).toHaveLength(4);

    const page = await listNotifications({ userClient: ana.client, userId: ana.id, onlyUnread: false, limit: 3 });
    expect(page.items).toHaveLength(3);
    expect(page.hasMore).toBe(true);
  });

  it("nunca se ven los avisos de otra persona, aunque se pida su id", async () => {
    const { items } = await listNotifications({ userClient: ana.client, userId: beto.id, onlyUnread: false, limit: 10 });
    expect(items).toHaveLength(0);
  });
});

describe("marcar como leído", () => {
  it("marca el propio y no toca el ajeno", async () => {
    const { items: mine } = await listNotifications({ userClient: ana.client, userId: ana.id, onlyUnread: true, limit: 10 });
    const target = mine[0];
    expect(await markNotificationRead({ userClient: ana.client, userId: ana.id, id: target?.id ?? "" })).toEqual({ ok: true });
    expect((await listNotifications({ userClient: ana.client, userId: ana.id, onlyUnread: true, limit: 10 })).items).toHaveLength(2);

    // Ana intenta marcar el aviso de Beto: no cambia nada.
    const { data: betos } = await admin.from("notifications").select("id").eq("profile_id", beto.id);
    await markNotificationRead({ userClient: ana.client, userId: ana.id, id: betos?.[0]?.id ?? "" });
    await markNotificationRead({ userClient: ana.client, userId: beto.id, id: betos?.[0]?.id ?? "" });
    const { data: after } = await admin.from("notifications").select("read_at").eq("profile_id", beto.id);
    expect(after?.[0]?.read_at).toBeNull();
  });
});
