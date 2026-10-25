import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { checkUsageAlerts } from "../src/lib/usage/alerts";
import { evaluateUsage, levelFor, parseLimits } from "../src/lib/usage/limits";
import { resolveMonth, todayIn } from "../src/lib/crm/consumption";
import { adminClient, createTestUser, randomId, type TestUser } from "./helpers/supabase-test";

// Límites de consumo y alertas (ADR-036). Datos inventados; organización y usuarios propios "zz-test-".

describe("niveles y medidores", () => {
  it("avisa al llegar al umbral y marca superado desde el 100%", () => {
    expect(levelFor(79.9, 80)).toBe("ok");
    expect(levelFor(80, 80)).toBe("warning");
    expect(levelFor(99.9, 80)).toBe("warning");
    expect(levelFor(100, 80)).toBe("exceeded");
    expect(levelFor(250, 80)).toBe("exceeded");
  });

  it("el estado general es el peor de los dos medidores; sin límites no hay estado", () => {
    const limits = { credits: 100, costUsd: 10, alertPercent: 80 };
    expect(evaluateUsage({ credits: 10, costUsd: 1 }, limits).level).toBe("ok");
    expect(evaluateUsage({ credits: 85, costUsd: 1 }, limits).level).toBe("warning");
    expect(evaluateUsage({ credits: 85, costUsd: 12 }, limits).level).toBe("exceeded");
    expect(evaluateUsage({ credits: 85, costUsd: 12 }, { credits: 100, costUsd: null, alertPercent: 80 }).cost).toBeNull();
    expect(evaluateUsage({ credits: 999, costUsd: 999 }, { credits: null, costUsd: null, alertPercent: 80 })).toMatchObject({ credits: null, cost: null, level: "ok" });
  });

  it("lee el formulario: vacío es sin límite, coma o punto en el costo, y rechaza lo raro", () => {
    expect(parseLimits({ credits: "", costUsd: "", alertPercent: "" })).toEqual({ ok: true, limits: { credits: null, costUsd: null, alertPercent: 80 } });
    expect(parseLimits({ credits: "1000", costUsd: "12,5", alertPercent: "90" })).toEqual({ ok: true, limits: { credits: 1000, costUsd: 12.5, alertPercent: 90 } });
    expect(parseLimits({ credits: "-5", costUsd: "", alertPercent: "80" }).ok).toBe(false);
    expect(parseLimits({ credits: "10.5", costUsd: "", alertPercent: "80" }).ok).toBe(false);
    expect(parseLimits({ credits: "abc", costUsd: "", alertPercent: "80" }).ok).toBe(false);
    expect(parseLimits({ credits: "", costUsd: "0", alertPercent: "80" }).ok).toBe(false);
    expect(parseLimits({ credits: "", costUsd: "", alertPercent: "0" }).ok).toBe(false);
    expect(parseLimits({ credits: "", costUsd: "", alertPercent: "101" }).ok).toBe(false);
  });
});

const admin = adminClient();
const runId = randomId();
let orgId = "";
let boss: TestUser;
let operator: TestUser;
let contactId = "";
const userIds: string[] = [];
let windowCount = 0;

// Primer día del mes en curso, al mediodía UTC: las ventanas no se pisan (dos días entre una y otra).
const month = resolveMonth(undefined, todayIn("America/Argentina/Buenos_Aires", new Date())).month;
const monthStart = new Date(`${month}-01T12:00:00Z`);

async function addWindows(count: number) {
  const rows = Array.from({ length: count }, () => {
    const opened = new Date(monthStart.getTime() + windowCount * 2 * 86_400_000);
    windowCount += 1;
    return {
      organization_id: orgId,
      contact_id: contactId,
      initiated_by: "contact" as const,
      opened_at: opened.toISOString(),
      expires_at: new Date(opened.getTime() + 24 * 3_600_000).toISOString(),
      credits: 1,
    };
  });
  const { error } = await admin.from("conversation_windows").insert(rows);
  if (error) throw new Error(`No se pudieron crear las ventanas: ${error.message}`);
}

const notificationsOf = async (profileId: string) => {
  const { data } = await admin.from("notifications").select("type, title, body").eq("profile_id", profileId).eq("type", "usage_limit").order("created_at");
  return data ?? [];
};

beforeAll(async () => {
  const { data: org, error } = await admin
    .from("organizations")
    .insert({ slug: `zz-test-${runId}-usage`, name: "Prueba Consumo", monthly_credit_limit: 10, monthly_cost_limit_usd: 1, usage_alert_percent: 80 })
    .select("id")
    .single();
  if (error || !org) throw new Error(`No se pudo crear la organización: ${error?.message}`);
  orgId = org.id;

  boss = await createTestUser(admin, { organizationId: orgId, role: "superadmin", label: "uso-boss", runId });
  operator = await createTestUser(admin, { organizationId: orgId, role: "operator", label: "uso-op", runId });
  userIds.push(boss.id, operator.id);

  const { data: contact } = await admin.from("contacts").insert({ organization_id: orgId, display_name: "Ana Prueba" }).select("id").single();
  contactId = contact?.id ?? "";
});

afterAll(async () => {
  for (const id of userIds) await admin.auth.admin.deleteUser(id);
  await admin.from("organizations").delete().eq("id", orgId);
});

describe("consumo del mes de una organización", () => {
  it("la función suma créditos y costo solo del mes y de esa organización; las personas no pueden llamarla", async () => {
    await addWindows(3);
    await admin.from("ai_calls").insert({
      organization_id: orgId,
      agent_kind: "attention",
      model: "claude-sonnet-5-5",
      input_tokens: 1000,
      output_tokens: 100,
      latency_ms: 900,
      stop_reason: "end_turn",
      cost_usd: 0.25,
    });

    const { data } = await admin.rpc("org_month_usage", { p_org: orgId, p_month: `${month}-01` });
    expect(data?.[0]).toMatchObject({ credits: 3 });
    expect(Number(data?.[0]?.cost_usd)).toBeCloseTo(0.25, 4);

    const { data: lastMonth } = await admin.rpc("org_month_usage", { p_org: orgId, p_month: "2020-01-01" });
    expect(lastMonth?.[0]).toMatchObject({ credits: 0 });

    const { error } = await boss.client.rpc("org_month_usage", { p_org: orgId, p_month: `${month}-01` });
    expect(error).not.toBeNull();
  });
});

describe("avisos de consumo", () => {
  const now = new Date();

  it("por debajo del umbral no avisa", async () => {
    const result = await checkUsageAlerts(admin, now);
    expect(result.checked).toBeGreaterThanOrEqual(1);
    expect(await notificationsOf(boss.id)).toHaveLength(0);
  });

  it("al llegar al 80% avisa una sola vez, y solo a los superadmins", async () => {
    await addWindows(5);
    await admin.from("organizations").update({ usage_checked_at: null }).eq("id", orgId);
    await checkUsageAlerts(admin, now);

    const notices = await notificationsOf(boss.id);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.title).toContain("80%");
    expect(notices[0]?.body).toContain("8 de 10");
    expect(await notificationsOf(operator.id)).toHaveLength(0);

    // Otra pasada más tarde con el mismo nivel: no repite.
    await admin.from("organizations").update({ usage_checked_at: null }).eq("id", orgId);
    await checkUsageAlerts(admin, new Date(now.getTime() + 60_000));
    expect(await notificationsOf(boss.id)).toHaveLength(1);
  });

  it("no revisa de nuevo antes de 10 minutos", async () => {
    await addWindows(3);
    const result = await checkUsageAlerts(admin, new Date(now.getTime() + 2 * 60_000));
    expect(result.checked).toBe(0);
    expect(await notificationsOf(boss.id)).toHaveLength(1);
  });

  it("al superar el límite avisa de nuevo, una vez", async () => {
    const later = new Date(now.getTime() + 15 * 60_000);
    await checkUsageAlerts(admin, later);
    const notices = await notificationsOf(boss.id);
    expect(notices).toHaveLength(2);
    expect(notices[1]?.title).toContain("Se superó el límite");

    await checkUsageAlerts(admin, new Date(later.getTime() + 15 * 60_000));
    expect(await notificationsOf(boss.id)).toHaveLength(2);
  });

  it("en un mes nuevo empieza de cero (sin consumo, sin aviso) y limpia el estado", async () => {
    const nextMonth = new Date(now.getTime() + 35 * 86_400_000);
    await checkUsageAlerts(admin, nextMonth);
    expect(await notificationsOf(boss.id)).toHaveLength(2);
    const { data } = await admin.from("organizations").select("usage_alert_level, usage_alert_month").eq("id", orgId).single();
    expect(data?.usage_alert_level).toBeNull();
    expect(data?.usage_alert_month).toBe(resolveMonth(undefined, todayIn("America/Argentina/Buenos_Aires", nextMonth)).month);
  });
});
