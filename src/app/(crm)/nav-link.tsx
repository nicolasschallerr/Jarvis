"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(`${href}/`);

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`rounded-lg px-3 py-2 text-sm font-medium transition duration-150 ${
        active
          ? "bg-accent-soft text-accent"
          : "text-zinc-600 hover:bg-zinc-200/60 hover:text-foreground dark:text-zinc-400 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </Link>
  );
}
