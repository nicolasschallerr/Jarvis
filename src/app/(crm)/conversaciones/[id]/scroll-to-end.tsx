"use client";

import { useEffect, useRef } from "react";

// Lleva la vista al último mensaje al abrir la conversación y cuando llega uno nuevo. Depende del id del último
// mensaje (no de la cantidad): al cargar mensajes anteriores la cantidad crece pero el último es el mismo, y la
// vista no tiene que saltar al final.
export function ScrollToEnd({ lastId }: { lastId: string | null }) {
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [lastId]);

  return <li ref={ref} aria-hidden="true" />;
}
