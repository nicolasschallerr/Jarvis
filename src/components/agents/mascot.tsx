"use client";

import dynamic from "next/dynamic";
import { Component, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import type { AnimalMood } from "./animal-scene";

// Mascotas de los agentes: animales en 3D (ver animal-scene.tsx). El agente de atención es un zorro con
// auriculares; el analítico, un búho con anteojos. Reaccionan a su estado:
//   paused (encendido)  disponible: respira, parpadea y sigue al cursor
//   working             trabajando: mueve la cola o aletea, la luz de marca late
//   waiting_approval    esperando: inclina la cabeza, la luz se pone ámbar
//   apagado (asleep)    duerme: ojos cerrados, cabeza baja y "z" flotando

export type AgentKind = "attention" | "analytic";
export type AgentStatus = "paused" | "working" | "waiting_approval";

type Props = {
  kind: AgentKind;
  status: AgentStatus;
  className?: string;
  // Desfasa los movimientos para que dos mascotas juntas no se muevan igual.
  blinkDelay?: number;
  // Marca el lugar donde "aterriza" la mascota al terminar la bienvenida (ver welcome-overlay).
  slot?: string;
  // El agente está apagado: la mascota duerme.
  asleep?: boolean;
};

const NAMES: Record<AgentKind, string> = { attention: "zorro", analytic: "búho" };

// El 3D se carga solo en el navegador y aparte del resto de la página (three.js pesa).
const AnimalScene = dynamic(() => import("./animal-scene"), { ssr: false, loading: () => <Placeholder /> });

function Placeholder() {
  return <span className="absolute inset-[18%] animate-pulse rounded-full bg-accent-soft" aria-hidden="true" />;
}

// Si el navegador no puede dibujar 3D (WebGL apagado o un error), se muestra un respaldo quieto en vez de romper
// la tarjeta.
class SceneBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

function Fallback({ kind }: { kind: AgentKind }) {
  return (
    <span className="absolute inset-[14%] grid place-items-center rounded-full bg-accent-soft text-4xl" aria-hidden="true">
      {kind === "attention" ? "🦊" : "🦉"}
    </span>
  );
}

// Se pregunta una sola vez por página (crear contextos WebGL de prueba cuesta).
let webglSupport: boolean | undefined;
function hasWebGL(): boolean {
  if (webglSupport === undefined) {
    try {
      const canvas = document.createElement("canvas");
      webglSupport = Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}

const noSubscription = () => () => {};

// null en el servidor (todavía no se sabe); en el navegador, si puede dibujar 3D.
function useWebGL(): boolean | null {
  return useSyncExternalStore(noSubscription, hasWebGL, () => null);
}

// El nivel de movimiento lo fija <html data-motion> (preferencia del sistema o el selector del menú) y puede
// cambiar en vivo.
function useMotionAllowed(): boolean {
  const [allowed, setAllowed] = useState(true);
  useEffect(() => {
    const read = () => setAllowed(document.documentElement.dataset.motion !== "reduce");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
    return () => observer.disconnect();
  }, []);
  return allowed;
}

export function Mascot({ kind, status, className = "size-28", blinkDelay = 0, slot, asleep = false }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  // Arranca visible; si el navegador sabe observarlo, se pausa cuando sale de pantalla.
  const [visible, setVisible] = useState(true);
  const webgl = useWebGL();
  const animate = useMotionAllowed();

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    // Solo se dibuja mientras está a la vista: ahorra batería y procesador.
    const observer = new IntersectionObserver(([entry]) => setVisible(Boolean(entry?.isIntersecting)), { rootMargin: "80px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const mood: AnimalMood = asleep ? "asleep" : status === "working" ? "working" : status === "waiting_approval" ? "waiting" : "idle";
  const label = `Mascota del agente: un ${NAMES[kind]} ${asleep ? "durmiendo" : mood === "working" ? "trabajando" : mood === "waiting" ? "esperando" : "atento"}`;

  return (
    <div ref={ref} className={`relative ${className}`} role="img" aria-label={label} data-mascot-slot={slot}>
      {webgl === false ? (
        <Fallback kind={kind} />
      ) : webgl ? (
        <SceneBoundary fallback={<Fallback kind={kind} />}>
          <AnimalScene kind={kind} mood={mood} delay={blinkDelay} animate={animate} visible={visible} />
        </SceneBoundary>
      ) : (
        <Placeholder />
      )}
      {asleep ? (
        <span className="pointer-events-none absolute top-[6%] right-[10%] font-mono text-sm font-bold text-muted" aria-hidden="true">
          <span className="mascot-zzz inline-block">z</span>
          <span className="mascot-zzz inline-block text-xs" style={{ animationDelay: "1s" }}>
            z
          </span>
        </span>
      ) : null}
    </div>
  );
}
