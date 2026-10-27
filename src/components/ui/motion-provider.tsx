"use client";

import { MotionConfig } from "motion/react";
import { useSyncExternalStore } from "react";

// El interruptor de Preferencias avisa con este evento (ver motion-toggle.tsx).
const EVENT = "jarvis-motion-change";

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

// data-motion lo fija el script que corre antes de pintar (ver layout.tsx) y el interruptor del menú.
function readReduced() {
  return document.documentElement.dataset.motion === "reduce";
}

// true cuando la persona pidió menos movimiento. En el servidor se asume que no.
export function useReducedMotionChoice() {
  return useSyncExternalStore(subscribe, readReduced, () => false);
}

// Las animaciones de CSS ya respetan data-motion (globals.css); las de la librería de movimiento corren en
// JavaScript, así que se les avisa acá: con menos movimiento, los cambios son instantáneos.
export function MotionProvider({ children }: { children: React.ReactNode }) {
  const reduced = useReducedMotionChoice();
  return <MotionConfig reducedMotion={reduced ? "always" : "never"}>{children}</MotionConfig>;
}
