"use client";

import { useSyncExternalStore } from "react";

type Choice = "auto" | "on" | "off";

const STORAGE_KEY = "jarvis-motion";
const EVENT = "jarvis-motion-change";

function read(): Choice {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "on" || value === "off" ? value : "auto";
  } catch {
    return "auto";
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

// Mismo cálculo que el script que corre antes de pintar (ver layout.tsx).
function apply(choice: Choice) {
  const reduce = choice === "off" || (choice !== "on" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  document.documentElement.dataset.motion = reduce ? "reduce" : "full";
}

// Elegir cuánto se mueve la interfaz. "Automáticas" sigue a la preferencia del sistema (lo recomendado por
// accesibilidad); quien tiene las animaciones apagadas en su sistema por rendimiento puede activarlas acá.
export function MotionToggle() {
  const choice = useSyncExternalStore(subscribe, read, () => "auto" as Choice);

  function change(next: Choice) {
    try {
      if (next === "auto") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Sin almacenamiento (modo privado): el cambio vale solo para esta visita.
    }
    apply(next);
    window.dispatchEvent(new Event(EVENT));
  }

  return (
    <label className="flex flex-col gap-1 text-xs text-muted">
      Animaciones
      <select
        value={choice}
        onChange={(event) => change(event.target.value as Choice)}
        className="field !py-1.5 text-sm text-foreground"
      >
        <option value="auto">Automáticas (según tu sistema)</option>
        <option value="on">Siempre activas</option>
        <option value="off">Reducidas</option>
      </select>
    </label>
  );
}
