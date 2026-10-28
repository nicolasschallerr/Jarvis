// El emblema del Asistente: las tres órbitas del logo de Orbita, cada una girando a su velocidad, alrededor de un núcleo
// que respira. Un satélite recorre la órbita exterior. Cuando piensa (`thinking`), todo gira más rápido y el núcleo
// brilla. Es decorativo: el texto de al lado dice lo que pasa. "Menos movimiento" lo deja quieto (globals.css).
export function AssistantOrb({ className = "size-24", thinking = false }: { className?: string; thinking?: boolean }) {
  const speed = (calm: number) => `${thinking ? calm / 6 : calm}s`;

  return (
    <span className={`relative grid shrink-0 place-items-center ${className}`} aria-hidden="true">
      {/* Halo */}
      <span className={`orb-halo absolute inset-[12%] rounded-full blur-xl ${thinking ? "opacity-90" : "opacity-60"}`} />

      <svg viewBox="0 0 48 48" className="absolute inset-0 size-full overflow-visible" fill="none">
        <defs>
          <linearGradient id="orb-stroke" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="var(--accent)" />
            <stop offset="1" stopColor="var(--agent-assistant)" />
          </linearGradient>
        </defs>
        <g className="orbit-ring" style={{ transformOrigin: "24px 24px", ["--orbit-speed" as string]: speed(18) }}>
          <ellipse cx="24" cy="24" rx="21" ry="7.8" transform="rotate(-58 24 24)" stroke="url(#orb-stroke)" strokeWidth="1.4" strokeOpacity="0.9" />
          <circle cx="24" cy="3" r="1.9" fill="var(--agent-assistant)" />
        </g>
        <g className="orbit-ring orbit-ring-reverse" style={{ transformOrigin: "24px 24px", ["--orbit-speed" as string]: speed(26) }}>
          <ellipse cx="24" cy="24" rx="21" ry="8.3" transform="rotate(18 24 24)" stroke="url(#orb-stroke)" strokeWidth="1.4" strokeOpacity="0.7" />
        </g>
        <g className="orbit-ring" style={{ transformOrigin: "24px 24px", ["--orbit-speed" as string]: speed(34) }}>
          <ellipse cx="24" cy="24" rx="17.5" ry="7" transform="rotate(-22 24 24)" stroke="url(#orb-stroke)" strokeWidth="1.4" strokeOpacity="0.55" />
          <circle cx="41.5" cy="24" r="1.3" fill="var(--accent)" />
        </g>
      </svg>

      {/* Núcleo */}
      <span className={`orb-core relative size-[30%] rounded-full ${thinking ? "orb-core-thinking" : ""}`} />
    </span>
  );
}
