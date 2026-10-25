import { Badge, type Tone } from "@/components/ui/badge";
import { evaluateUsage, type Limits, type Meter, type UsageLevel } from "@/lib/usage/limits";

import { LimitsForm } from "./limits-form";

const number = new Intl.NumberFormat("es-AR");
const usd = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const LEVEL_TONE: Record<UsageLevel, Tone> = { ok: "success", warning: "warning", exceeded: "danger" };
const LEVEL_LABEL: Record<UsageLevel, string> = { ok: "Dentro del límite", warning: "Cerca del límite", exceeded: "Límite superado" };
const BAR: Record<UsageLevel, string> = { ok: "bg-success", warning: "bg-warning", exceeded: "bg-danger" };

function MeterRow({ label, meter, format }: { label: string; meter: Meter; format: (value: number) => string }) {
  const width = Math.min(100, Math.round(meter.percent));
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-xs text-muted">
          {format(meter.used)} de {format(meter.limit)} · {Math.floor(meter.percent)}%
        </span>
      </div>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        role="progressbar"
        aria-label={`${label}: ${Math.floor(meter.percent)}% del límite`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.floor(meter.percent))}
      >
        <div className={`h-full rounded-full ${BAR[meter.level]}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

// Los límites del mes frente a lo consumido. Todos lo ven; solo el superadmin los cambia.
export function LimitsCard({ limits, used, canEdit }: { limits: Limits; used: { credits: number; costUsd: number }; canEdit: boolean }) {
  const status = evaluateUsage(used, limits);
  const hasLimits = status.credits !== null || status.cost !== null;

  return (
    <section aria-labelledby="limites" className="card flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="limites" className="eyebrow">
          Límites del mes
        </h2>
        {hasLimits ? (
          <Badge tone={LEVEL_TONE[status.level]} dot>
            {LEVEL_LABEL[status.level]}
          </Badge>
        ) : null}
      </div>

      {hasLimits ? (
        <div className="flex flex-col gap-4">
          {status.credits ? <MeterRow label="Créditos" meter={status.credits} format={(value) => number.format(value)} /> : null}
          {status.cost ? <MeterRow label="Costo estimado de IA" meter={status.cost} format={(value) => usd.format(value)} /> : null}
          <p className="text-xs text-muted">Se avisa a los superadministradores al llegar al {limits.alertPercent}% y al superar el límite.</p>
        </div>
      ) : (
        <p className="text-sm text-muted">Todavía no hay límites. {canEdit ? "Fijá uno para que te avisemos antes de pasarte." : ""}</p>
      )}

      {canEdit ? <LimitsForm credits={limits.credits} costUsd={limits.costUsd} alertPercent={limits.alertPercent} /> : null}
    </section>
  );
}
