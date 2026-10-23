// Mascotas de los agentes: ilustraciones planas originales, dibujadas en SVG. Usan los colores del tema
// (cada agente tiene el suyo) y reaccionan a su estado:
//   paused            ojos cerrados y "z" flotando
//   working           balanceo suave y parpadeo
//   waiting_approval  parpadeo y la antena (o la cresta) late

export type AgentKind = "attention" | "analytic";
export type AgentStatus = "paused" | "working" | "waiting_approval";

type Props = {
  kind: AgentKind;
  status: AgentStatus;
  className?: string;
  // Desfasa el parpadeo para que dos mascotas juntas no parpadeen a la vez.
  blinkDelay?: number;
};

function ClosedEyes({ cx1, cx2, cy }: { cx1: number; cx2: number; cy: number }) {
  return (
    <g fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-foreground">
      <path d={`M${cx1 - 6} ${cy} Q${cx1} ${cy + 5} ${cx1 + 6} ${cy}`} />
      <path d={`M${cx2 - 6} ${cy} Q${cx2} ${cy + 5} ${cx2 + 6} ${cy}`} />
    </g>
  );
}

function Zzz() {
  return (
    <g className="fill-zinc-500" fontFamily="var(--font-geist-sans), sans-serif" fontWeight="700" aria-hidden="true">
      <text x="92" y="26" fontSize="14" className="mascot-zzz">
        z
      </text>
      <text x="100" y="16" fontSize="10" className="mascot-zzz" style={{ animationDelay: "1s" }}>
        z
      </text>
    </g>
  );
}

// Jarvis: un robot redondo con auriculares, para el agente de atención.
function Jarvis({ status, blinkDelay }: { status: AgentStatus; blinkDelay: number }) {
  const sleeping = status === "paused";

  return (
    <g className={status === "working" ? "mascot-bob" : undefined}>
      {/* antena */}
      <line x1="60" y1="18" x2="60" y2="31" strokeWidth="4" strokeLinecap="round" className="stroke-agent-jarvis" />
      <circle cx="60" cy="14" r="5.5" className={`fill-agent-sinapsis ${status === "waiting_approval" ? "mascot-pulse" : ""}`} />
      {/* auriculares */}
      <rect x="15" y="52" width="9" height="22" rx="4.5" className="fill-agent-jarvis" opacity="0.75" />
      <rect x="96" y="52" width="9" height="22" rx="4.5" className="fill-agent-jarvis" opacity="0.75" />
      {/* cabeza */}
      <rect x="22" y="30" width="76" height="62" rx="22" className="fill-agent-jarvis" />
      {/* cara */}
      <rect x="30" y="40" width="60" height="40" rx="15" className="fill-surface" />
      {sleeping ? (
        <ClosedEyes cx1={47} cx2={73} cy={58} />
      ) : (
        <g className="fill-foreground">
          <ellipse cx="47" cy="58" rx="5" ry="7" className="mascot-eye" style={{ animationDelay: `${blinkDelay}s` }} />
          <ellipse cx="73" cy="58" rx="5" ry="7" className="mascot-eye" style={{ animationDelay: `${blinkDelay}s` }} />
        </g>
      )}
      <path d="M51 70 Q60 77 69 70" fill="none" strokeWidth="3" strokeLinecap="round" className="stroke-foreground" />
      {/* cuello */}
      <rect x="40" y="92" width="40" height="14" rx="7" className="fill-agent-jarvis" />
    </g>
  );
}

// Sinapsis: un búho con anteojos y un gráfico en la panza, para el agente analítico.
function Sinapsis({ status, blinkDelay }: { status: AgentStatus; blinkDelay: number }) {
  const sleeping = status === "paused";

  return (
    <g className={status === "working" ? "mascot-bob" : undefined}>
      {/* mechones */}
      <path d="M33 42 L29 20 L50 33 Z" className={`fill-agent-sinapsis ${status === "waiting_approval" ? "mascot-pulse" : ""}`} />
      <path d="M87 42 L91 20 L70 33 Z" className={`fill-agent-sinapsis ${status === "waiting_approval" ? "mascot-pulse" : ""}`} />
      {/* cuerpo */}
      <ellipse cx="60" cy="66" rx="37" ry="39" className="fill-agent-sinapsis" />
      {/* panza con un gráfico de barras */}
      <ellipse cx="60" cy="84" rx="22" ry="21" className="fill-surface" />
      <rect x="49" y="86" width="6" height="10" rx="1.5" className="fill-agent-sinapsis" />
      <rect x="57" y="80" width="6" height="16" rx="1.5" className="fill-agent-sinapsis" />
      <rect x="65" y="73" width="6" height="23" rx="1.5" className="fill-agent-sinapsis" />
      {/* anteojos */}
      <circle cx="46" cy="55" r="13.5" strokeWidth="3" className="fill-surface stroke-foreground" />
      <circle cx="74" cy="55" r="13.5" strokeWidth="3" className="fill-surface stroke-foreground" />
      <line x1="59.5" y1="55" x2="60.5" y2="55" strokeWidth="3" className="stroke-foreground" />
      {sleeping ? (
        <ClosedEyes cx1={46} cx2={74} cy={55} />
      ) : (
        <g className="fill-foreground">
          <circle cx="46" cy="55" r="4.5" className="mascot-eye" style={{ animationDelay: `${blinkDelay}s` }} />
          <circle cx="74" cy="55" r="4.5" className="mascot-eye" style={{ animationDelay: `${blinkDelay}s` }} />
        </g>
      )}
      {/* pico */}
      <path d="M56 65 L64 65 L60 72 Z" className="fill-foreground" opacity="0.85" />
      {/* patas */}
      <ellipse cx="47" cy="105" rx="9" ry="4.5" className="fill-agent-sinapsis" opacity="0.8" />
      <ellipse cx="73" cy="105" rx="9" ry="4.5" className="fill-agent-sinapsis" opacity="0.8" />
    </g>
  );
}

export function Mascot({ kind, status, className = "size-28", blinkDelay = 0 }: Props) {
  const name = kind === "attention" ? "Jarvis" : "Sinapsis";

  return (
    <svg viewBox="0 0 120 120" className={className} role="img" aria-label={`Mascota de ${name}`}>
      <ellipse cx="60" cy="112" rx="28" ry="4.5" className="fill-foreground" opacity="0.1" />
      {kind === "attention" ? <Jarvis status={status} blinkDelay={blinkDelay} /> : <Sinapsis status={status} blinkDelay={blinkDelay} />}
      {status === "paused" ? <Zzz /> : null}
    </svg>
  );
}
