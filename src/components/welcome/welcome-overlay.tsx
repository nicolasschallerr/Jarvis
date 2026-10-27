"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { AgentEmblem, StatusDot, agentStatus, type AgentKind, type AgentStatus } from "@/components/agents/agent-card";
import { Logo } from "@/components/ui/logo";

export type WelcomeAgent = { kind: AgentKind; name: string; status: AgentStatus; line: string };

type Props = {
  // "full": la primera vez del día (unos 3 s). "short": el resto del día (0,8 s).
  mode: "full" | "short";
  greeting: string;
  agents: WelcomeAgent[];
  onDone: () => void;
};

type Phase = "enter" | "bubbles" | "settle";

// Línea de tiempo de la versión completa, en milisegundos.
const FULL = { bubbles: 1700, settle: 2500, done: 3300 } as const;
// Y de la corta.
const SHORT = { settle: 500, done: 800 } as const;
const SKIP_FADE_MS = 220;

// Escribe el texto de a una letra. Con enabled=false aparece completo de entrada.
function useTypewriter(text: string, startDelay: number, speed: number, enabled: boolean) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let interval: ReturnType<typeof setInterval> | undefined;
    const start = setTimeout(() => {
      interval = setInterval(() => {
        setCount((current) => {
          if (current + 1 >= text.length && interval) clearInterval(interval);
          return Math.min(current + 1, text.length);
        });
      }, speed);
    }, startDelay);
    return () => {
      clearTimeout(start);
      if (interval) clearInterval(interval);
    };
  }, [text, startDelay, speed, enabled]);

  return enabled ? text.slice(0, count) : text;
}

export default function WelcomeOverlay({ mode, greeting, agents, onDone }: Props) {
  const full = mode === "full";
  const [phase, setPhase] = useState<Phase>("enter");
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);
  const typed = useTypewriter(greeting, 900, 38, full);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    onDone();
  }, [onDone]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (full) {
      timers.push(setTimeout(() => setPhase("bubbles"), FULL.bubbles));
      timers.push(
        setTimeout(() => setPhase("settle"), FULL.settle),
      );
      timers.push(setTimeout(finish, FULL.done));
    } else {
      timers.push(setTimeout(() => setPhase("settle"), SHORT.settle));
      timers.push(setTimeout(finish, SHORT.done));
    }
    return () => timers.forEach(clearTimeout);
  }, [full, finish]);

  // "Saltar" (o Esc): todo se desvanece rápido y se termina.
  const skip = useCallback(() => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(finish, SKIP_FADE_MS);
  }, [leaving, finish]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") skip();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [skip]);

  const settling = phase === "settle";
  const fadeContent = settling || leaving;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden px-4" role="status" aria-live="polite">
      {/* Fondo: se desvanece al final para dejar ver el Panorama. */}
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 bg-background"
        initial={{ opacity: 1 }}
        animate={{ opacity: fadeContent ? 0 : 1 }}
        transition={{ duration: leaving ? SKIP_FADE_MS / 1000 : 0.6 }}
      />

      <button type="button" onClick={skip} className="btn-secondary absolute right-4 top-4 z-10">
        Saltar
      </button>

      <div className="relative flex w-full max-w-md flex-col items-center gap-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.88 }}
          animate={{ opacity: fadeContent ? 0 : 1, scale: 1 }}
          transition={{ duration: full ? 0.5 : 0.15, ease: "easeOut" }}
        >
          <Logo />
        </motion.div>

        <motion.h1
          className="font-display text-3xl font-semibold tracking-tight sm:text-4xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: fadeContent ? 0 : 1 }}
          transition={{ duration: full ? 0.3 : 0.15 }}
        >
          {/* Lectores de pantalla: el saludo completo de una vez; la escritura letra por letra es decoración. */}
          <span className="sr-only">{greeting}</span>
          <span aria-hidden="true" className="inline-flex items-center">
            {typed}
            {full && typed.length < greeting.length ? <span className="caret-blink ml-0.5 inline-block h-8 w-0.5 bg-accent" /> : null}
          </span>
        </motion.h1>

        {full ? (
          <ul className="flex w-full flex-col gap-4">
            {agents.map((agent, index) => (
              <li key={agent.kind} className="flex items-center gap-3">
                <motion.div
                  className="shrink-0"
                  // Entran de a uno, con un rebote suave.
                  initial={{ opacity: 0, y: 24, scale: 0.8 }}
                  animate={leaving || settling ? { opacity: 0, scale: 0.9 } : { opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: "spring", stiffness: 300, damping: 18, delay: leaving || settling ? 0 : 0.5 + index * 0.12 }}
                >
                  <AgentEmblem kind={agent.kind} name={agent.name} tone={agentStatus({ status: agent.status, isEnabled: true }).tone} className="size-16" />
                </motion.div>

                <motion.p
                  className="relative rounded-2xl rounded-tl-sm border border-zinc-200 bg-surface px-3 py-2 text-sm shadow-sm dark:border-zinc-800"
                  initial={{ opacity: 0, scale: 0.9, x: -8 }}
                  animate={{ opacity: phase === "enter" || fadeContent ? 0 : 1, scale: phase === "enter" ? 0.9 : 1, x: phase === "enter" ? -8 : 0 }}
                  transition={{ type: "spring", stiffness: 300, damping: 20, delay: phase === "bubbles" ? index * 0.15 : 0 }}
                >
                  <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: agent.kind === "attention" ? "var(--agent-jarvis)" : "var(--agent-sinapsis)" }}>
                    <StatusDot tone={agentStatus({ status: agent.status, isEnabled: true }).tone} />
                    {agent.name}
                  </span>
                  {agent.line}
                </motion.p>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
