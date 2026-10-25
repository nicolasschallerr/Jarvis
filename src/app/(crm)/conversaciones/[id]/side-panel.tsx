"use client";

import { useEffect, useRef, useState } from "react";

const OPEN_EVENT = "jarvis:open-side-panel";

// Botón para abrir el panel en pantallas chicas. Va en el encabezado de la conversación (antes era un botón
// flotante que en el celular tapaba "Enviar").
export function OpenSidePanelButton() {
  return (
    <button type="button" onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))} className="btn-secondary !py-1 text-xs lg:hidden">
      Ficha y caso
    </button>
  );
}

// Panel lateral de la conversación (ficha, caso y notas). En pantallas grandes queda fijo a la derecha; en
// pantallas chicas se abre como un diálogo: toma el foco, se cierra con Esc y devuelve el foco al cerrar.
export function SidePanel({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<Element | null>(null);

  useEffect(() => {
    const onOpen = () => {
      returnFocus.current = document.activeElement;
      setOpen(true);
    };
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (returnFocus.current instanceof HTMLElement) returnFocus.current.focus();
    };
  }, [open]);

  return (
    <>
      {open ? <button type="button" aria-label="Cerrar el panel" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/40 lg:hidden" /> : null}

      <aside
        role={open ? "dialog" : undefined}
        aria-modal={open ? true : undefined}
        aria-label="Ficha del asociado y caso"
        className={`shrink-0 flex-col gap-5 overflow-y-auto border-l border-line bg-background p-4 lg:static lg:z-auto lg:flex lg:w-80 xl:w-96 ${
          open ? "fixed inset-y-0 right-0 z-50 flex w-[min(24rem,92vw)] shadow-xl" : "hidden"
        }`}
      >
        <button ref={closeRef} type="button" onClick={() => setOpen(false)} className="btn-secondary self-end lg:hidden">
          Cerrar
        </button>
        {children}
      </aside>
    </>
  );
}
