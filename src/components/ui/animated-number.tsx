"use client";

import { useEffect, useRef, useState } from "react";

import { useReducedMotionChoice } from "./motion-provider";

const DURATION_MS = 900;
const format = new Intl.NumberFormat("es-AR");

// Un número que "cuenta" hasta su valor. La primera vez arranca de cero; cuando el valor cambia (la página se
// actualiza en vivo), sube o baja desde el anterior. Con menos movimiento aparece directo. El texto final es siempre el
// valor real: el lector de pantalla y el HTML del servidor lo tienen desde el principio.
export function AnimatedNumber({ value, suffix = "", className }: { value: number; suffix?: string; className?: string }) {
  const reduced = useReducedMotionChoice();
  const [shown, setShown] = useState(0);
  const from = useRef(0);

  useEffect(() => {
    if (reduced || typeof window.requestAnimationFrame !== "function") {
      from.current = value;
      return;
    }
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - start) / DURATION_MS);
      // Arranca rápido y frena al llegar.
      const eased = 1 - Math.pow(1 - progress, 3);
      setShown(Math.round(origin + (value - origin) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, reduced]);

  return (
    <span className={className}>
      <span className="sr-only">
        {format.format(value)}
        {suffix}
      </span>
      <span aria-hidden="true" className="tabular-nums">
        {format.format(reduced ? value : shown)}
        {suffix}
      </span>
    </span>
  );
}
