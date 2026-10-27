export type AgentKind = "attention" | "analytic" | "stock";
export type AgentStatus = "paused" | "working" | "waiting_approval";

const ROLES: Record<AgentKind, string> = {
  attention: "Agente de atención",
  analytic: "Agente analítico",
  stock: "Agente de stock",
};

// Los agentes que se muestran en el CRM. La base tiene otros tipos de agente internos (resumen, clasificador...) que no
// son compañeros de equipo visibles: para esos devuelve null.
export function toAgentKind(kind: string): AgentKind | null {
  return kind === "attention" || kind === "analytic" || kind === "stock" ? kind : null;
}

export const AGENT_COLOR: Record<AgentKind, string> = {
  attention: "var(--agent-jarvis)",
  analytic: "var(--agent-sinapsis)",
  stock: "var(--agent-stock)",
};

const AGENT_BAR: Record<AgentKind, string> = {
  attention: "bg-agent-jarvis",
  analytic: "bg-agent-sinapsis",
  stock: "bg-agent-stock",
};

export type AgentView = {
  kind: AgentKind;
  name: string;
  tagline: string | null;
  status: AgentStatus;
  isEnabled: boolean;
};

export type StatusTone = "off" | "ready" | "busy" | "waiting";

// "En pausa" en la base significa "no está trabajando ahora": un agente encendido en reposo está disponible, y uno
// apagado, apagado.
export function agentStatus(agent: Pick<AgentView, "status" | "isEnabled">): { label: string; tone: StatusTone } {
  if (!agent.isEnabled) return { label: "Apagado", tone: "off" };
  if (agent.status === "working") return { label: "Trabajando", tone: "busy" };
  if (agent.status === "waiting_approval") return { label: "Esperando aprobación", tone: "waiting" };
  return { label: "Disponible", tone: "ready" };
}

const DOT: Record<StatusTone, string> = {
  off: "bg-zinc-400",
  ready: "bg-success",
  busy: "bg-accent",
  waiting: "bg-warning",
};

// Punto de estado: cuando el agente está encendido, un anillo late alrededor (en vivo).
export function StatusDot({ tone }: { tone: StatusTone }) {
  return (
    <span className="relative inline-flex size-2.5 shrink-0" aria-hidden="true">
      {tone !== "off" ? <span className={`live-ping absolute inset-0 rounded-full ${DOT[tone]}`} /> : null}
      <span className={`relative size-2.5 rounded-full ${DOT[tone]}`} />
    </span>
  );
}

// Emblema del agente: su inicial dentro de las órbitas de la marca, en el color del agente. Las órbitas giran cuando
// está encendido, y más rápido cuando está trabajando.
export function AgentEmblem({ kind, name, tone, className = "size-14" }: { kind: AgentKind; name: string; tone: StatusTone; className?: string }) {
  const color = AGENT_COLOR[kind];
  const off = tone === "off";
  return (
    <span className={`relative grid shrink-0 place-items-center ${className}`} aria-hidden="true">
      <svg viewBox="0 0 48 48" className="absolute inset-0 size-full" fill="none" style={{ color }}>
        <g
          className={off ? undefined : "orbit-ring"}
          style={{ transformOrigin: "24px 24px", ["--orbit-speed" as string]: tone === "busy" ? "6s" : "22s" }}
        >
          <ellipse cx="24" cy="24" rx="21" ry="8" transform="rotate(-58 24 24)" stroke="currentColor" strokeOpacity={off ? 0.25 : 0.55} strokeWidth="1.2" />
          <ellipse cx="24" cy="24" rx="21" ry="8.5" transform="rotate(18 24 24)" stroke="currentColor" strokeOpacity={off ? 0.2 : 0.4} strokeWidth="1.2" />
          {off ? null : <circle cx="24" cy="3.5" r="2" fill="currentColor" />}
        </g>
      </svg>
      <span
        className="relative grid size-[52%] place-items-center rounded-full text-sm font-bold"
        style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
      >
        {name.trim().charAt(0).toUpperCase() || "A"}
      </span>
    </span>
  );
}

// Tarjeta de un agente: su emblema, su rol, su estado en vivo y una frase suya. La frase es de personalidad (la
// configura el cliente): no cuenta cosas que el agente no hizo.
export function AgentCard({ agent }: { agent: AgentView }) {
  const status = agentStatus(agent);
  const accent = AGENT_BAR[agent.kind];

  return (
    <article className="card spotlight flex items-center gap-4 overflow-hidden p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <span className={`absolute inset-y-0 left-0 w-1 ${accent}`} aria-hidden="true" />
      <AgentEmblem kind={agent.kind} name={agent.name} tone={status.tone} className="size-20" />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <h3 className="font-display text-lg font-semibold leading-tight">{agent.name}</h3>
          <p className="text-sm text-muted">{ROLES[agent.kind]}</p>
        </div>

        <p className="flex items-center gap-2 text-sm">
          <StatusDot tone={status.tone} />
          <span>{status.label}</span>
        </p>

        <p className="text-sm text-muted italic">
          {agent.isEnabled ? `“${agent.tagline ?? "Acá estoy."}”` : "Todavía no está activo: cuando lo enciendas, va a trabajar con tu equipo."}
        </p>
      </div>
    </article>
  );
}
