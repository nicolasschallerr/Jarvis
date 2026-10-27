import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/crm/format";

export type Tone = "neutral" | "accent" | "success" | "warning" | "danger" | "info" | "agent";

const TONES: Record<Tone, string> = {
  neutral: "bg-zinc-200/70 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  accent: "bg-accent-soft text-accent",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  info: "bg-info-soft text-info",
  agent: "bg-accent-soft text-accent",
};

const DOTS: Record<Tone, string> = {
  neutral: "bg-zinc-400",
  accent: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
  info: "bg-info",
  agent: "bg-agent-jarvis",
};

// Placa de estado. Un solo lugar para el color de cada significado: nada de azules o rojos sueltos.
export function Badge({ tone = "neutral", dot = false, children, title }: { tone?: Tone; dot?: boolean; children: React.ReactNode; title?: string }) {
  return (
    <span className={`badge ${TONES[tone]}`} title={title}>
      {dot ? <span className={`size-1.5 rounded-full ${DOTS[tone]}`} aria-hidden="true" /> : null}
      {children}
    </span>
  );
}

export const STATUS_TONES: Record<string, Tone> = {
  new: "info",
  in_progress: "accent",
  waiting_contact: "warning",
  waiting_area: "warning",
  resolved: "success",
};

// Color de identidad de cada estado para el tablero: punto del título y borde superior de la columna. Clases
// completas (no armadas con plantillas) para que Tailwind las encuentre. "Esperando al área" usa el ámbar del
// agente analítico así no se confunde con "Esperando al contacto" cuando las columnas están una al lado de la otra.
export const STATUS_ACCENTS: Record<string, { dot: string; border: string }> = {
  new: { dot: "bg-info", border: "border-t-info" },
  in_progress: { dot: "bg-accent", border: "border-t-accent" },
  waiting_contact: { dot: "bg-warning", border: "border-t-warning" },
  waiting_area: { dot: "bg-agent-sinapsis", border: "border-t-agent-sinapsis" },
  resolved: { dot: "bg-success", border: "border-t-success" },
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONES[status] ?? "neutral"} dot>
      {STATUS_LABELS[status] ?? "Sin estado"}
    </Badge>
  );
}

const PRIORITY_TONES: Record<string, Tone> = {
  low: "neutral",
  normal: "neutral",
  high: "warning",
  urgent: "danger",
};

// Punto de color de cada prioridad (filtros) y franja lateral de las tarjetas que piden atención. Las prioridades
// bajas no llevan franja: si todo resalta, nada resalta.
export const PRIORITY_DOTS: Record<string, string> = {
  urgent: "bg-danger",
  high: "bg-warning",
  normal: "bg-zinc-400",
  low: "bg-zinc-300 dark:bg-zinc-600",
};

export const PRIORITY_STRIPES: Record<string, string> = {
  urgent: "border-l-4 border-l-danger",
  high: "border-l-4 border-l-warning",
};

export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge tone={PRIORITY_TONES[priority] ?? "neutral"}>{PRIORITY_LABELS[priority] ?? "Normal"}</Badge>;
}
