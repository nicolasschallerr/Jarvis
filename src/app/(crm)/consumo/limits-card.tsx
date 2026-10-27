import { Badge, type Tone } from "@/components/ui/badge";
import { evaluateUsage, type Limits, type Meter, type UsageLevel } from "@/lib/usage/limits";

import { LimitsForm } from "./limits-form";

const number = new Intl.NumberFormat("es-AR");
const usd = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

const LEVEL_TONE: Record<UsageLevel, Tone> = { ok: "success", warning: "warning", exceeded: "danger" };
const LEVEL_LABEL: Record<UsageLevel, string> = { ok: "Dentro del límite", warning: "Cerca del límite", exceeded: "Límite superado" };
// Medidor lineal: el relleno es un degradado verde → ámbar (en el % de aviso) → rojo (en el 100%) pintado a lo ancho de
// toda la pista y recortado hasta lo consumido. Así la punta toma el color que corresponde al porcentaje, y la marca
// muestra dónde salta el aviso.
function MeterRow({ label, meter, alertPercent, format }: { label: string; meter: Meter; alertPercent: number; format: (value: number) => string }) {
  const width = Math.min(100, Math.round(meter.percent));
  const alertAt = Math.min(100, Math.max(0, alertPercent));
  const gradient = `linear-gradient(90deg, var(--success) 0%, var(--success) ${Math.max(0, alertAt - 25)}%, var(--warning) ${alertAt}%, var(--danger) 100%)`;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="font-mono text-xs text-muted">
          {format(meter.used)} de {format(meter.limit)} · {Math.floor(meter.percent)}%
        </span>
      </div>
      <div
        className="relative h-2.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        role="progressbar"
        aria-label={`${label}: ${Math.floor(meter.percent)}% del límite`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(100, Math.floor(meter.percent))}
      >
        {width > 0 ? (
          <div className="grow-x h-full rounded-full" style={{ width: `${width}%`, backgroundImage: gradient, backgroundSize: `${(100 / width) * 100}% 100%` }} />
        ) : null}
        {alertAt > 0 && alertAt < 100 ? <span className="absolute inset-y-0 w-px bg-surface/80" style={{ left: `${alertAt}%` }} aria-hidden="true" /> : null}
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
          {status.credits ? <MeterRow label="Créditos" meter={status.credits} alertPercent={limits.alertPercent} format={(value) => number.format(value)} /> : null}
          {status.cost ? <MeterRow label="Costo estimado de IA" meter={status.cost} alertPercent={limits.alertPercent} format={(value) => usd.format(value)} /> : null}
          <p className="text-xs text-muted">Se avisa a los superadministradores al llegar al {limits.alertPercent}% y al superar el límite.</p>
        </div>
      ) : (
        <p className="text-sm text-muted">Todavía no hay límites. {canEdit ? "Fijá uno para que te avisemos antes de pasarte." : ""}</p>
      )}

      {canEdit ? <LimitsForm credits={limits.credits} costUsd={limits.costUsd} alertPercent={limits.alertPercent} /> : null}
    </section>
  );
}
