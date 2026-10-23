import { Mascot, type AgentKind, type AgentStatus } from "./mascot";

const ROLES: Record<AgentKind, string> = {
  attention: "Agente de atención",
  analytic: "Agente analítico",
};

const STATUS: Record<AgentStatus, { label: string; dot: string }> = {
  paused: { label: "En pausa", dot: "bg-zinc-400" },
  working: { label: "Trabajando", dot: "bg-emerald-500" },
  waiting_approval: { label: "Esperando aprobación", dot: "bg-amber-500" },
};

export type AgentView = {
  kind: AgentKind;
  name: string;
  tagline: string | null;
  status: AgentStatus;
  isEnabled: boolean;
};

// Tarjeta de un agente: su mascota, su rol, su estado en vivo y una frase suya. La frase es de
// personalidad (la configura el cliente): no cuenta cosas que el agente no hizo.
export function AgentCard({ agent, blinkDelay = 0 }: { agent: AgentView; blinkDelay?: number }) {
  const status = STATUS[agent.status];
  const accent = agent.kind === "attention" ? "bg-agent-jarvis" : "bg-agent-sinapsis";

  return (
    <article className="card relative flex items-center gap-4 overflow-hidden p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md">
      <span className={`absolute inset-y-0 left-0 w-1.5 ${accent}`} aria-hidden="true" />
      <Mascot kind={agent.kind} status={agent.status} className="size-24 shrink-0 sm:size-28" blinkDelay={blinkDelay} slot={agent.kind} />

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div>
          <h3 className="font-display text-xl font-semibold leading-tight">{agent.name}</h3>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{ROLES[agent.kind]}</p>
        </div>

        <p className="flex items-center gap-2 text-sm">
          <span className={`size-2.5 rounded-full ${status.dot}`} aria-hidden="true" />
          <span>{status.label}</span>
        </p>

        <p className="relative rounded-xl rounded-tl-sm bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">
          {agent.isEnabled
            ? (agent.tagline ?? "Acá estoy.")
            : "Todavía no estoy activo: cuando me conecten, voy a trabajar con tu equipo."}
        </p>
      </div>
    </article>
  );
}
