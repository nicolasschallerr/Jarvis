// Ilustración de la marca para el inicio de sesión y la página pública: el símbolo de Orbita en el centro y anillos que
// giran a distinta velocidad, cada uno con un punto (los agentes) que lo recorre. Todo es CSS: con menos movimiento queda
// quieto (globals.css).
const RINGS = [
  { inset: "0%", speed: "48s", reverse: false, dot: "var(--agent-jarvis)", opacity: 0.35 },
  { inset: "14%", speed: "32s", reverse: true, dot: "var(--agent-sinapsis)", opacity: 0.5 },
  { inset: "28%", speed: "20s", reverse: false, dot: "var(--accent)", opacity: 0.7 },
];

export function OrbitVisual({ className = "", labels }: { className?: string; labels?: { top: string; bottom: string } }) {
  return (
    <div className={`relative aspect-square ${className}`} aria-hidden="true">
      <div className="absolute inset-[30%] rounded-full blur-3xl" style={{ background: "radial-gradient(closest-side, var(--glow), transparent)" }} />
      {RINGS.map((ring) => (
        <div
          key={ring.inset}
          className={`orbit-ring absolute rounded-full border border-current ${ring.reverse ? "orbit-ring-reverse" : ""}`}
          style={{ inset: ring.inset, opacity: ring.opacity, ["--orbit-speed" as string]: ring.speed }}
        >
          <span
            className="absolute top-0 left-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{ background: ring.dot, boxShadow: `0 0 18px 4px ${ring.dot}` }}
          />
        </div>
      ))}
      <svg viewBox="0 0 48 48" className="absolute inset-[38%] size-[24%]" fill="none">
        <g className="orbit-spin" style={{ transformOrigin: "24px 24px" }}>
          <ellipse cx="24" cy="24" rx="19" ry="7" transform="rotate(-58 24 24)" className="stroke-accent" strokeWidth="2" />
          <ellipse cx="24" cy="24" rx="19" ry="7.5" transform="rotate(18 24 24)" className="stroke-accent" strokeWidth="2" />
          <ellipse cx="24" cy="24" rx="16" ry="6.5" transform="rotate(-22 24 24)" className="stroke-accent" strokeWidth="2" />
        </g>
      </svg>
      {labels ? (
        <>
          <span className="eyebrow absolute top-[8%] right-0 rounded-full border border-line bg-surface/80 px-3 py-1 backdrop-blur">{labels.top}</span>
          <span className="eyebrow absolute bottom-[8%] left-0 rounded-full border border-line bg-surface/80 px-3 py-1 backdrop-blur">{labels.bottom}</span>
        </>
      ) : null}
    </div>
  );
}
