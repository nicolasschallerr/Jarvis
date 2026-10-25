"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({
  href,
  icon,
  count,
  countLabel,
  children,
}: {
  href: string;
  icon?: React.ReactNode;
  // Un número para llamar la atención (por ejemplo, avisos sin leer). Cero no se muestra.
  count?: number;
  countLabel?: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const active = href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition duration-150 ${
        active ? "bg-accent-soft text-accent" : "text-muted hover:bg-zinc-200/60 hover:text-foreground dark:hover:bg-zinc-800"
      }`}
    >
      {icon ? <span className="shrink-0">{icon}</span> : null}
      <span className="flex-1">{children}</span>
      {count ? (
        <span className="rounded-full bg-accent px-1.5 text-xs font-semibold tabular-nums text-accent-foreground" aria-label={countLabel}>
          {count > 99 ? "99+" : count}
        </span>
      ) : null}
    </Link>
  );
}
