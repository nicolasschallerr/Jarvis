"use client";

import { useEffect, useState } from "react";

// Panel lateral de la conversación (ficha, caso y notas). En pantallas grandes queda fijo a la derecha;
// en pantallas chicas se abre como un cajón con un botón flotante. El contenido llega ya armado.
export function SidePanel({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="btn-primary fixed bottom-4 right-4 z-30 shadow-lg lg:hidden"
      >
        Ficha y caso
      </button>

      {open ? (
        <button
          type="button"
          aria-label="Cerrar el panel"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      ) : null}

      <aside
        className={`shrink-0 flex-col gap-5 overflow-y-auto border-l border-zinc-200 bg-background p-4 dark:border-zinc-800 lg:static lg:z-auto lg:flex lg:w-80 ${
          open ? "fixed inset-y-0 right-0 z-50 flex w-[min(24rem,92vw)] shadow-xl" : "hidden"
        }`}
      >
        <button type="button" onClick={() => setOpen(false)} className="btn-secondary self-end lg:hidden">
          Cerrar
        </button>
        {children}
      </aside>
    </>
  );
}
