"use server";

import { revalidatePath } from "next/cache";

import { recordAudit } from "@/lib/audit/record";
import { getCurrentProfile } from "@/lib/auth/profile";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseLimits } from "@/lib/usage/limits";

export type LimitsState = { error: string | null; savedAt: number | null };

// Fija los límites del mes. Solo el superadmin; la organización sale de su sesión, nunca del navegador. Al cambiar los
// límites se vuelve a avisar si corresponde (se borra el control de avisos del mes).
export async function saveLimitsAction(_previous: LimitsState, formData: FormData): Promise<LimitsState> {
  const profile = await getCurrentProfile();
  if (profile.role !== "superadmin") return { error: "Solo un superadministrador puede cambiar los límites.", savedAt: null };

  const parsed = parseLimits({
    credits: String(formData.get("credits") ?? ""),
    costUsd: String(formData.get("costUsd") ?? ""),
    alertPercent: String(formData.get("alertPercent") ?? ""),
  });
  if (!parsed.ok) return { error: parsed.error, savedAt: null };

  const admin = createAdminClient();
  const { error } = await admin
    .from("organizations")
    .update({
      monthly_credit_limit: parsed.limits.credits,
      monthly_cost_limit_usd: parsed.limits.costUsd,
      usage_alert_percent: parsed.limits.alertPercent,
      usage_alert_month: null,
      usage_alert_level: null,
      usage_checked_at: null,
    })
    .eq("id", profile.organizationId);
  if (error) return { error: "No se pudieron guardar los límites.", savedAt: null };

  await recordAudit(admin, {
    organizationId: profile.organizationId,
    actorId: profile.id,
    action: "usage.limits_changed",
    entityType: "organization",
    entityId: profile.organizationId,
    data: { credits: parsed.limits.credits, cost_usd: parsed.limits.costUsd, alert_percent: parsed.limits.alertPercent },
  });

  revalidatePath("/consumo");
  return { error: null, savedAt: Date.now() };
}
