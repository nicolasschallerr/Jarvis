import Link from "next/link";

import { AnimatedNumber } from "./animated-number";
import { ArrowRightIcon } from "./icons";

export type StatTone = "accent" | "success" | "warning" | "danger" | "info";

const ICON_TONE: Record<StatTone, string> = {
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
};

// Escalonado de entrada: cada tile aparece un poco después del anterior.
export const stagger = (index: number) => ({ animationDelay: `${index * 0.06}s` });

// Tile de una métrica (el mismo del Panorama, para todo el CRM): número que cuenta hasta su valor, ícono con el tono
// de lo que significa y, si lleva a algún lado, flecha al pasar el mouse. `value` como texto (ej. "1 min 20 s") se
// muestra tal cual, sin contar.
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = "accent",
  href,
  suffix,
  index = 0,
  emphasize = false,
}: {
  label: string;
  value: number | string;
  hint?: string;
  icon: React.ReactNode;
  tone?: StatTone;
  href?: string;
  suffix?: string;
  index?: number;
  emphasize?: boolean;
}) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        {typeof value === "number" ? (
          <AnimatedNumber value={value} suffix={suffix} className={`font-mono text-3xl font-semibold ${emphasize ? "text-danger" : ""}`} />
        ) : (
          <span className="font-mono text-2xl font-semibold">{value}</span>
        )}
        <span className={`grid size-9 shrink-0 place-items-center rounded-xl transition duration-200 group-hover:scale-110 group-hover:rotate-6 ${ICON_TONE[tone]}`} aria-hidden="true">
          {icon}
        </span>
      </span>
      <span className="text-sm font-medium">{label}</span>
      {hint || href ? (
        <span className="flex items-center justify-between text-xs text-muted">
          {hint}
          {href ? (
            <span className="-translate-x-1 opacity-0 transition duration-200 group-hover:translate-x-0 group-hover:opacity-100" aria-hidden="true">
              <ArrowRightIcon className="size-3.5" />
            </span>
          ) : null}
        </span>
      ) : null}
    </>
  );

  const className = `card spotlight group flex h-full flex-col gap-1 p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${emphasize ? "border-danger/40" : "hover:border-accent/40"}`;
  return (
    <div className="rise-in" style={stagger(index)}>
      {href ? (
        <Link href={href} className={className}>
          {body}
        </Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </div>
  );
}
