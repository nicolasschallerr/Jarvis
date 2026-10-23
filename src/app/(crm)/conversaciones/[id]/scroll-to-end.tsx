"use client";

import { useEffect, useRef } from "react";

// Lleva la vista al último mensaje al abrir la conversación y cuando llega uno nuevo.
export function ScrollToEnd({ count }: { count: number }) {
  const ref = useRef<HTMLLIElement>(null);

  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [count]);

  return <li ref={ref} aria-hidden="true" />;
}
