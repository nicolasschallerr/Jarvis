// Límites mensuales de consumo (ADR-036). Todo es informativo: no corta al agente.

export type UsageLevel = "ok" | "warning" | "exceeded";

export type Limits = { credits: number | null; costUsd: number | null; alertPercent: number };

export type Meter = { used: number; limit: number; percent: number; level: UsageLevel };

export type UsageStatus = { credits: Meter | null; cost: Meter | null; level: UsageLevel };

const RANK: Record<UsageLevel, number> = { ok: 0, warning: 1, exceeded: 2 };

export function rankOf(level: UsageLevel | null | undefined): number {
  return level ? RANK[level] : 0;
}

export function levelFor(percent: number, alertPercent: number): UsageLevel {
  if (percent >= 100) return "exceeded";
  if (percent >= alertPercent) return "warning";
  return "ok";
}

function meter(used: number, limit: number | null, alertPercent: number): Meter | null {
  if (limit === null || limit <= 0) return null;
  const percent = (used / limit) * 100;
  return { used, limit, percent, level: levelFor(percent, alertPercent) };
}

// Estado del mes frente a los límites: cada medidor por separado y el peor de los dos.
export function evaluateUsage(used: { credits: number; costUsd: number }, limits: Limits): UsageStatus {
  const credits = meter(used.credits, limits.credits, limits.alertPercent);
  const cost = meter(used.costUsd, limits.costUsd, limits.alertPercent);
  const worst = Math.max(rankOf(credits?.level), rankOf(cost?.level));
  return { credits, cost, level: (["ok", "warning", "exceeded"] as const)[worst] ?? "ok" };
}

export type LimitsInput = { credits: string; costUsd: string; alertPercent: string };
export type LimitsParsed = { ok: true; limits: Limits } | { ok: false; error: string };

// Lee lo que escribió la persona. Vacío = sin límite. Acepta coma o punto decimal en el costo.
export function parseLimits(input: LimitsInput): LimitsParsed {
  const creditsText = input.credits.trim();
  const costText = input.costUsd.trim().replace(",", ".");
  const percentText = input.alertPercent.trim();

  let credits: number | null = null;
  if (creditsText !== "") {
    credits = Number(creditsText);
    if (!Number.isInteger(credits) || credits <= 0 || credits > 100_000_000) return { ok: false, error: "El límite de créditos tiene que ser un número entero mayor que cero." };
  }

  let costUsd: number | null = null;
  if (costText !== "") {
    costUsd = Number(costText);
    if (!Number.isFinite(costUsd) || costUsd <= 0 || costUsd > 100_000_000) return { ok: false, error: "El límite de costo tiene que ser un número mayor que cero." };
  }

  const alertPercent = percentText === "" ? 80 : Number(percentText);
  if (!Number.isInteger(alertPercent) || alertPercent < 1 || alertPercent > 100) return { ok: false, error: "El porcentaje de aviso va de 1 a 100." };

  return { ok: true, limits: { credits, costUsd, alertPercent } };
}
