import type { SupabaseClient } from "@supabase/supabase-js";

import { resolveMonth, todayIn } from "@/lib/crm/consumption";
import type { Database } from "@/lib/supabase/database.types";

import { evaluateUsage, rankOf, type UsageLevel } from "./limits";

type Admin = SupabaseClient<Database>;

export type UsageAlertsResult = { checked: number; notified: number };

// Cada cuánto se revisa una organización (el trabajador pasa cada 10 segundos; el consumo no cambia tan rápido).
export const CHECK_EVERY_MS = 10 * 60 * 1000;

const number = new Intl.NumberFormat("es-AR");
const usd = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const monthName = new Intl.DateTimeFormat("es-AR", { month: "long", timeZone: "UTC" });

// Texto del aviso según qué medidor lo disparó.
function message(level: UsageLevel, month: string, parts: Array<{ label: string; used: string; limit: string; percent: number }>) {
  const monthLabel = monthName.format(new Date(`${month}-01T00:00:00Z`));
  const lead = parts.filter((part) => part.percent >= 100).length > 0 ? parts.filter((part) => part.percent >= 100) : parts;
  const worst = [...lead].sort((a, b) => b.percent - a.percent)[0];
  const title =
    level === "exceeded"
      ? `Se superó el límite de ${worst?.label ?? "consumo"} de ${monthLabel}`
      : `Consumo de ${monthLabel}: ${Math.floor(worst?.percent ?? 0)}% del límite de ${worst?.label ?? "consumo"}`;
  const body = parts.map((part) => `${part.label}: ${part.used} de ${part.limit}`).join(" · ") + ". Revisalo en Consumo.";
  return { title, body };
}

// Revisa el consumo del mes de las organizaciones con límites y avisa a sus superadmins una sola vez al cruzar el
// umbral y otra vez al superar el límite (no cada 10 segundos). En un mes nuevo se empieza de cero.
export async function checkUsageAlerts(admin: Admin, now: Date = new Date()): Promise<UsageAlertsResult> {
  const result: UsageAlertsResult = { checked: 0, notified: 0 };

  const dueBefore = new Date(now.getTime() - CHECK_EVERY_MS).toISOString();
  const { data: organizations, error } = await admin
    .from("organizations")
    .select("id, timezone, monthly_credit_limit, monthly_cost_limit_usd, usage_alert_percent, usage_alert_month, usage_alert_level, usage_checked_at")
    .or("monthly_credit_limit.not.is.null,monthly_cost_limit_usd.not.is.null")
    .or(`usage_checked_at.is.null,usage_checked_at.lt.${dueBefore}`)
    .limit(50);
  if (error) throw new Error(`No se pudieron leer las organizaciones con límites: ${error.message}`);

  for (const organization of organizations ?? []) {
    result.checked += 1;
    const month = resolveMonth(undefined, todayIn(organization.timezone, now)).month;

    const { data: usage, error: usageError } = await admin.rpc("org_month_usage", { p_org: organization.id, p_month: `${month}-01` });
    if (usageError) {
      console.error("consumo del mes:", usageError.message);
      continue;
    }
    const used = { credits: Number(usage?.[0]?.credits ?? 0), costUsd: Number(usage?.[0]?.cost_usd ?? 0) };
    const status = evaluateUsage(used, { credits: organization.monthly_credit_limit, costUsd: organization.monthly_cost_limit_usd, alertPercent: organization.usage_alert_percent });

    // En un mes nuevo se empieza sin avisos previos.
    const alreadyNotified: UsageLevel | null = organization.usage_alert_month === month ? ((organization.usage_alert_level as UsageLevel | null) ?? null) : null;
    const update: Partial<Database["public"]["Tables"]["organizations"]["Update"]> = { usage_checked_at: now.toISOString() };

    if (rankOf(status.level) > rankOf(alreadyNotified)) {
      const parts = [
        status.credits ? { label: "créditos", used: number.format(status.credits.used), limit: number.format(status.credits.limit), percent: status.credits.percent } : null,
        status.cost ? { label: "costo de IA", used: usd.format(status.cost.used), limit: usd.format(status.cost.limit), percent: status.cost.percent } : null,
      ].filter((part) => part !== null);
      const { title, body } = message(status.level, month, parts);

      const { data: admins } = await admin.from("profiles").select("id").eq("organization_id", organization.id).eq("role", "superadmin").eq("is_active", true);
      if (admins?.length) {
        const { error: insertError } = await admin
          .from("notifications")
          .insert(admins.map((person) => ({ organization_id: organization.id, profile_id: person.id, type: "usage_limit", title, body })));
        if (insertError) {
          console.error("aviso de consumo:", insertError.message);
          continue;
        }
        result.notified += admins.length;
      }
      update.usage_alert_month = month;
      update.usage_alert_level = status.level === "ok" ? null : status.level;
    } else if (organization.usage_alert_month !== month) {
      // Mes nuevo y por debajo del umbral: se limpia el estado del mes anterior.
      update.usage_alert_month = month;
      update.usage_alert_level = null;
    }

    await admin.from("organizations").update(update).eq("id", organization.id);
  }

  return result;
}
