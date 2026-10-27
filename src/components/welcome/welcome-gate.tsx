"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import type { WelcomeAgent } from "./welcome-overlay";

// La animación (y la librería de movimiento) se descarga solo cuando hay que mostrarla.
const WelcomeOverlay = dynamic(() => import("./welcome-overlay"), { ssr: false });

const STORAGE_KEY = "jarvis-welcome-day";
const SAFETY_MS = 7000;

type Props = {
  // true cuando se llega desde el inicio de sesión (?bienvenida=1).
  play: boolean;
  todayKey: string;
  greeting: string;
  firstName: string;
  agents: WelcomeAgent[];
};

type Status = "idle" | "pending" | "playing" | "done";

// Decide si se muestra la bienvenida y cómo. Mientras decide, el servidor ya dibujó una cortina del color
// de fondo, así que el Inicio no parpadea antes de la animación. Los datos del Inicio ya vienen cargados:
// la animación no los espera ni los bloquea.
export function WelcomeGate({ play, todayKey, greeting, firstName, agents }: Props) {
  const [status, setStatus] = useState<Status>(play ? "pending" : "idle");
  const [mode, setMode] = useState<"full" | "short">("full");

  const done = useCallback(() => {
    delete document.documentElement.dataset.welcome;
    setStatus("done");
  }, []);

  useEffect(() => {
    if (!play) return;

    // Marca que la bienvenida está en pantalla (sirve para depurar y para las pruebas).
    document.documentElement.dataset.welcome = "playing";
    // Se quita el parámetro de la dirección: al recargar la página no se repite.
    window.history.replaceState(window.history.state, "", window.location.pathname);

    // Si la animación no llegara a cargar, esto devuelve el Inicio igual.
    const safety = setTimeout(done, SAFETY_MS);

    const decide = setTimeout(() => {
      // data-motion lo fija el script de layout.tsx con la elección del menú o, si no hay, la preferencia del
      // sistema. Si no está (por ejemplo, el script no corrió), se consulta la preferencia del sistema.
      const motion = document.documentElement.dataset.motion;
      const reduced = motion ? motion === "reduce" : window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        // Quien pide menos movimiento no ve la animación.
        done();
        return;
      }

      let seenToday = false;
      try {
        seenToday = localStorage.getItem(STORAGE_KEY) === todayKey;
        if (!seenToday) localStorage.setItem(STORAGE_KEY, todayKey);
      } catch {
        // Sin almacenamiento (modo privado): siempre la versión completa.
      }

      setMode(seenToday ? "short" : "full");
      setStatus("playing");
    }, 0);

    return () => {
      clearTimeout(safety);
      clearTimeout(decide);
      delete document.documentElement.dataset.welcome;
    };
  }, [play, todayKey, done]);

  if (status === "pending") {
    return <div aria-hidden="true" className="welcome-fallback fixed inset-0 z-[60] bg-background" />;
  }

  if (status === "playing") {
    // Va directo en <body>: así cubre toda la pantalla, menú incluido, sin depender de dónde esté el Panorama.
    return createPortal(<WelcomeOverlay mode={mode} greeting={`${greeting}, ${firstName}`} agents={agents} onDone={done} />, document.body);
  }

  return null;
}
