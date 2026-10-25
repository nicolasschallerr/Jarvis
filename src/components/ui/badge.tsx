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

const STATUS_TONES: Record<string, Tone> = {
  new: "info",
  in_progress: "accent",
  waiting_contact: "warning",
  waiting_area: "warning",
  resolved: "success",
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

export function PriorityBadge({ priority }: { priority: string }) {
  return <Badge tone={PRIORITY_TONES[priority] ?? "neutral"}>{PRIORITY_LABELS[priority] ?? "Normal"}</Badge>;
}
