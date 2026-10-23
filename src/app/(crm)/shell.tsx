"use client";

import { useEffect, useState } from "react";

import { Logo } from "@/components/ui/logo";

// Esqueleto del CRM. En pantallas medianas y grandes el menú queda fijo a la izquierda; en celular hay
// una barra superior y el menú se abre como un cajón. El menú se recibe ya armado (lo renderiza el
// servidor) y es un solo elemento: solo cambia su posición según el ancho.
export function Shell({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  // Esc cierra el cajón.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-zinc-200 px-4 md:hidden dark:border-zinc-800">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir el menú"
          aria-expanded={open}
          aria-controls="menu-principal"
          className="btn-secondary size-10 !p-0"
        >
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <Logo />
      </header>

      {open ? (
        <button
          type="button"
          aria-label="Cerrar el menú"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
        />
      ) : null}

      <aside
        id="menu-principal"
        // Un clic en un enlace o en cerrar sesión cierra el cajón.
        onClick={(event) => {
          if ((event.target as HTMLElement).closest("a, button[type=submit]")) setOpen(false);
        }}
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85%] flex-col justify-between border-r border-zinc-200 bg-background p-4 shadow-xl transition-[transform,visibility] duration-200 md:visible md:static md:z-auto md:w-60 md:max-w-none md:translate-x-0 md:shadow-none dark:border-zinc-800 ${
          open ? "visible translate-x-0" : "invisible -translate-x-full"
        }`}
      >
        {sidebar}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">{children}</div>
    </div>
  );
}
