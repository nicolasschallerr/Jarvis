// Marca de Orbita AI (manual de marca v2.0): tres órbitas entrelazadas, una por capa del trabajo (software, datos e
// inteligencia artificial). Las proporciones son las del manual; el color sale del acento del tema.
export function LogoMark({ className = "size-8", animated = false, title = "Orbita AI" }: { className?: string; animated?: boolean; title?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} role="img" aria-label={title} fill="none">
      <g className={animated ? "orbit-spin" : undefined} style={{ transformOrigin: "24px 24px" }}>
        <ellipse cx="24" cy="24" rx="19" ry="7" transform="rotate(-58 24 24)" className="stroke-accent" strokeWidth="2" />
        <ellipse cx="24" cy="24" rx="19" ry="7.5" transform="rotate(18 24 24)" className="stroke-accent" strokeWidth="2" />
        <ellipse cx="24" cy="24" rx="16" ry="6.5" transform="rotate(-22 24 24)" className="stroke-accent" strokeWidth="2" />
      </g>
    </svg>
  );
}

// Logotipo horizontal: símbolo + "orbita" en Manrope 400 y "AI" en Manrope 700 color petróleo.
export function Logo({ className = "", size = "md" }: { className?: string; size?: "md" | "lg" }) {
  const mark = size === "lg" ? "size-11" : "size-8";
  const text = size === "lg" ? "text-3xl" : "text-xl";
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <LogoMark className={mark} />
      <span className={`${text} leading-none tracking-tight`} aria-hidden="true">
        <span className="font-normal">orbita</span> <span className="font-bold text-accent">AI</span>
      </span>
    </span>
  );
}
