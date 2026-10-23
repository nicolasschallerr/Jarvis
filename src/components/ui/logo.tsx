// Marca de Jarvis: dos nodos unidos, como una sinapsis. Usa el color de acento del tema.
export function LogoMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="Jarvis">
      <rect width="32" height="32" rx="9" className="fill-accent" />
      <path d="M10 21 L16 11 L22 21" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="stroke-accent-foreground" opacity="0.55" />
      <circle cx="10" cy="21" r="3" className="fill-accent-foreground" />
      <circle cx="22" cy="21" r="3" className="fill-accent-foreground" />
      <circle cx="16" cy="11" r="3.4" className="fill-accent-foreground" />
    </svg>
  );
}

export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <LogoMark />
      <span className="font-display text-xl font-semibold tracking-tight">Jarvis</span>
    </span>
  );
}
