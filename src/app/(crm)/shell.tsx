"use client";

import { useEffect, useRef, useState } from "react";

import { Logo } from "@/components/ui/logo";
import { MotionProvider } from "@/components/ui/motion-provider";

// Esqueleto del CRM. En pantallas medianas y grandes el menú queda fijo a la izquierda; en celular hay
// una barra superior y el menú se abre como un cajón. El menú se recibe ya armado (lo renderiza el
// servidor) y es un solo elemento: solo cambia su posición según el ancho.
export function Shell({ sidebar, children }: { sidebar: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const swipeFrom = useRef<number | null>(null);

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
    <MotionProvider>
      <div
        className="flex h-dvh flex-col md:flex-row"
        // Mueve la luz de la tarjeta con reflejo (.spotlight) que está debajo del mouse.
        onPointerMove={(event) => {
          const card = (event.target as HTMLElement).closest<HTMLElement>(".spotlight");
          if (!card) return;
          const rect = card.getBoundingClientRect();
          card.style.setProperty("--mx", `${event.clientX - rect.left}px`);
          card.style.setProperty("--my", `${event.clientY - rect.top}px`);
        }}
      >
        {/* Para quien navega con teclado: saltar el menú e ir directo al contenido. */}
        <a
          href="#contenido"
          className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-foreground"
        >
          Saltar al contenido
        </a>
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-background/80 px-4 backdrop-blur md:hidden">
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

        {/* Fondo del cajón: aparece con un fundido y desenfoca lo de atrás. Siempre está, pero solo se toca abierto. */}
        <button
          type="button"
          aria-label="Cerrar el menú"
          tabIndex={open ? 0 : -1}
          onClick={() => setOpen(false)}
          className={`fixed inset-0 z-40 bg-zinc-950/45 backdrop-blur-[3px] transition-opacity duration-300 md:hidden ${open ? "opacity-100" : "pointer-events-none opacity-0"}`}
        />

        <aside
          id="menu-principal"
          data-open={open}
          // Un clic en un enlace o en cerrar sesión cierra el cajón.
          onClick={(event) => {
            if ((event.target as HTMLElement).closest("a, button[type=submit]")) setOpen(false);
          }}
          // Deslizar el dedo hacia la izquierda cierra el cajón.
          onTouchStart={(event) => {
            swipeFrom.current = event.touches[0]?.clientX ?? null;
          }}
          onTouchEnd={(event) => {
            const from = swipeFrom.current;
            const to = event.changedTouches[0]?.clientX;
            swipeFrom.current = null;
            if (open && from !== null && to !== undefined && from - to > 60) setOpen(false);
          }}
          className={`fixed inset-y-0 left-0 z-50 flex w-[19rem] max-w-[86%] flex-col justify-between rounded-r-3xl border-r border-line bg-background p-4 pt-5 shadow-2xl transition-[transform,visibility] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] md:visible md:static md:z-auto md:w-64 md:max-w-none md:translate-none md:rounded-none md:bg-surface/60 md:pt-4 md:shadow-none ${
            open ? "visible translate-x-0" : "invisible -translate-x-full"
          }`}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Cerrar el menú"
            className="absolute top-4 right-4 grid size-9 place-items-center rounded-full text-muted transition hover:bg-zinc-100 hover:text-foreground md:hidden dark:hover:bg-zinc-800"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
          {sidebar}
        </aside>

        <div id="contenido" tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto outline-none">
          {children}
        </div>
      </div>
    </MotionProvider>
  );
}
