"use client";

import { motion } from "motion/react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

type Hint = { top: number; left: number };

export function NavLink({
  href,
  icon,
  count,
  countLabel,
  description,
  children,
}: {
  href: string;
  icon?: React.ReactNode;
  // Un número para llamar la atención (por ejemplo, avisos sin leer). Cero no se muestra.
  count?: number;
  countLabel?: string;
  // Para qué sirve la sección: aparece a la derecha del menú al pasar el mouse o al llegar con el teclado.
  description?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);
  const [hint, setHint] = useState<Hint | null>(null);
  const hintId = `ayuda-${href.slice(1)}`;

  // La ficha va en posición fija, calculada desde el enlace: así no la recorta el menú cuando tiene desplazamiento.
  // Solo en pantallas donde el menú está fijo a la izquierda (en celular el menú es un cajón y no hay lugar).
  function show(event: React.SyntheticEvent<HTMLAnchorElement>) {
    if (!description || !window.matchMedia("(min-width: 768px)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setHint({ top: rect.top + rect.height / 2, left: rect.right + 12 });
  }

  return (
    <>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        aria-describedby={description ? hintId : undefined}
        onMouseEnter={show}
        onMouseLeave={() => setHint(null)}
        onClick={() => setHint(null)}
        onFocus={show}
        onBlur={() => setHint(null)}
        className={`group relative flex items-center gap-3 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
          active ? "text-accent" : "text-muted hover:text-foreground"
        }`}
      >
        {/* El fondo del activo es uno solo y se desliza de una sección a otra. */}
        {active ? (
          <motion.span
            layoutId="nav-activo"
            className="absolute inset-0 rounded-lg bg-accent-soft ring-1 ring-accent/15"
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            aria-hidden="true"
          />
        ) : (
          <span className="absolute inset-0 rounded-lg transition-colors duration-150 group-hover:bg-zinc-200/60 dark:group-hover:bg-zinc-800/70" aria-hidden="true" />
        )}
        {icon ? <span className="relative shrink-0 transition-transform duration-200 group-hover:scale-110">{icon}</span> : null}
        <span className="relative flex-1">{children}</span>
        {count ? (
          <span className="relative rounded-full bg-accent px-1.5 text-xs font-semibold tabular-nums text-accent-foreground" aria-label={countLabel}>
            {count > 99 ? "99+" : count}
          </span>
        ) : null}
      </Link>
      {description ? (
        <span
          id={hintId}
          role="tooltip"
          className={hint ? "nav-hint pointer-events-none fixed z-[70] w-64 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-muted shadow-lg" : "sr-only"}
          style={hint ? { top: hint.top, left: hint.left } : undefined}
        >
          <span aria-hidden="true" className="mb-0.5 block text-sm font-semibold text-foreground">{children}</span>
          {description}
        </span>
      ) : null}
    </>
  );
}
