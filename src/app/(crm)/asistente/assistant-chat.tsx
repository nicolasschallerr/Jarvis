"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { AssistantOrb } from "@/components/assistant/assistant-orb";
import { CaseIcon, ChatIcon, CoinIcon, ContactsIcon, GaugeIcon, StockIcon } from "@/components/ui/icons";
import type { AnalystTurn } from "@/lib/analytics/ask";

import { askAssistantAction } from "./actions";

type Entry = { id: number; role: "user" | "assistant"; text: string; tools?: string[]; isError?: boolean };

export type Suggestion = { topic: "casos" | "conversaciones" | "contactos" | "stock" | "finanzas" | "consumo"; question: string };

const TOPIC: Record<Suggestion["topic"], { label: string; icon: React.ReactNode; tint: string }> = {
  casos: { label: "Casos", icon: <CaseIcon />, tint: "bg-info-soft text-info" },
  conversaciones: { label: "Conversaciones", icon: <ChatIcon />, tint: "bg-accent-soft text-accent" },
  contactos: { label: "Contactos", icon: <ContactsIcon />, tint: "bg-success-soft text-success" },
  stock: { label: "Stock", icon: <StockIcon />, tint: "bg-agent-stock/15 text-agent-stock" },
  finanzas: { label: "Finanzas", icon: <CoinIcon />, tint: "bg-agent-finance/15 text-agent-finance" },
  consumo: { label: "Consumo", icon: <GaugeIcon />, tint: "bg-warning-soft text-warning" },
};

// Las **negritas** de la respuesta se ven como negrita; el resto es texto (sin interpretar HTML).
function withBold(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={index}>{part.slice(2, -2)}</strong> : part,
  );
}

const prefersStill = () => typeof document !== "undefined" && document.documentElement.dataset.motion === "reduce";

// La respuesta aparece escribiéndose, de a pocas palabras. Con "menos movimiento" aparece entera.
function TypedAnswer({ text, onDone }: { text: string; onDone: () => void }) {
  const [shown, setShown] = useState(() => (prefersStill() ? text.length : 0));
  const done = shown >= text.length;

  useEffect(() => {
    if (done) {
      onDone();
      return;
    }
    const timer = window.setTimeout(() => {
      // Avanza hasta el próximo espacio (palabra entera) o 3 caracteres, lo que llegue primero.
      const next = text.indexOf(" ", shown + 3);
      setShown(next === -1 ? text.length : next + 1);
    }, 16);
    return () => window.clearTimeout(timer);
  }, [done, onDone, shown, text]);

  return <span className={done ? undefined : "answer-caret"}>{withBold(text.slice(0, shown))}</span>;
}

export function AssistantChat({
  agentName,
  firstName,
  organizationName,
  suggestions,
  toolLabels,
}: {
  agentName: string;
  firstName: string;
  organizationName: string;
  suggestions: Suggestion[];
  toolLabels: Record<string, string>;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [typing, setTyping] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const nextId = useRef(1);

  // Seguir el final de la charla mientras llegan y se escriben las respuestas.
  useEffect(() => {
    const element = scrollRef.current;
    // Sin charla no hay nada que seguir: la pantalla de bienvenida se ve desde arriba.
    if (!element || (entries.length === 0 && !pending)) return;
    const follow = () => element.scrollTo({ top: element.scrollHeight, behavior: prefersStill() ? "auto" : "smooth" });
    follow();
    if (typing === null) return;
    const interval = window.setInterval(follow, 250);
    return () => window.clearInterval(interval);
  }, [entries, pending, typing]);

  // La caja de texto crece con lo que se escribe (hasta un tope).
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }, [question]);

  function ask(text: string) {
    const clean = text.trim();
    if (!clean || pending) return;

    const history: AnalystTurn[] = entries.filter((entry) => !entry.isError).map((entry) => ({ role: entry.role, text: entry.text }));
    setEntries((current) => [...current, { id: nextId.current++, role: "user", text: clean }]);
    setQuestion("");

    startTransition(async () => {
      const result = await askAssistantAction(history, clean);
      const id = nextId.current++;
      setEntries((current) => [
        ...current,
        result.ok ? { id, role: "assistant", text: result.answer, tools: result.toolsUsed } : { id, role: "assistant", text: result.error, isError: true },
      ]);
      if (result.ok) setTyping(id);
      inputRef.current?.focus();
    });
  }

  const empty = entries.length === 0;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Luces de la marca que se mueven despacio detrás de todo. */}
      <div className="pointer-events-none absolute inset-0 -z-0" aria-hidden="true">
        <div
          className="aurora absolute -top-40 left-1/2 size-[34rem] -translate-x-1/2 rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--agent-assistant) 16%, transparent), transparent)" }}
        />
        <div
          className="aurora absolute -bottom-32 -left-20 size-96 rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--glow), transparent)", animationDelay: "-6s" }}
        />
        <div
          className="aurora absolute top-1/3 -right-24 size-80 rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, color-mix(in srgb, var(--agent-finance) 10%, transparent), transparent)", animationDelay: "-11s" }}
        />
      </div>

      <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
        {empty ? (
          <section className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center gap-8 px-4 py-10 text-center sm:px-6">
            <div className="rise-in flex flex-col items-center gap-5">
              <AssistantOrb className="size-28 sm:size-32" thinking={pending} />
              <div className="flex flex-col gap-2">
                <p className="eyebrow">
                  {agentName} · {organizationName}
                </p>
                <h2 className="gradient-text font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                  ¿En qué te ayudo{firstName ? `, ${firstName}` : ""}?
                </h2>
                <p className="mx-auto max-w-lg text-sm text-muted sm:text-base">
                  Preguntame lo que quieras sobre la organización. Busco el dato real en el CRM y te lo explico. No modifico nada.
                </p>
              </div>
            </div>

            <ul className="grid w-full grid-cols-1 gap-3 text-left sm:grid-cols-2">
              {suggestions.map((suggestion, index) => {
                const topic = TOPIC[suggestion.topic];
                return (
                  // En el celular, cuatro: así el saludo y las sugerencias entran en la pantalla.
                  <li key={suggestion.question} className={`rise-in ${index >= 4 ? "hidden sm:block" : ""}`} style={{ animationDelay: `${0.15 + index * 0.06}s` }}>
                    <button
                      type="button"
                      onClick={() => ask(suggestion.question)}
                      disabled={pending}
                      className="card spotlight group flex h-full w-full items-start gap-3 bg-surface/80 p-4 text-left backdrop-blur transition duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md disabled:opacity-60"
                    >
                      <span className={`grid size-9 shrink-0 place-items-center rounded-xl transition duration-200 group-hover:scale-110 group-hover:-rotate-6 ${topic.tint}`} aria-hidden="true">
                        {topic.icon}
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="eyebrow !text-[0.65rem]">{topic.label}</span>
                        <span className="text-sm font-medium">{suggestion.question}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <ol className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6" aria-live="polite" aria-label="Conversación con el Asistente">
            {entries.map((entry) =>
              entry.role === "user" ? (
                <li key={entry.id} className="rise-in flex justify-end">
                  <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl rounded-br-lg bg-linear-to-br from-accent to-agent-assistant px-4 py-2.5 text-sm text-white shadow-sm sm:text-[15px]">
                    {entry.text}
                  </p>
                </li>
              ) : (
                <li key={entry.id} className="rise-in flex items-start gap-3">
                  <AssistantOrb className="mt-0.5 size-9" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <p className="text-xs font-semibold text-muted">{agentName}</p>
                    <div
                      className={`whitespace-pre-wrap break-words rounded-3xl rounded-tl-lg border px-4 py-3 text-sm leading-relaxed shadow-sm backdrop-blur sm:text-[15px] ${
                        entry.isError ? "border-danger/30 bg-danger-soft text-danger" : "border-line bg-surface/85"
                      }`}
                    >
                      {entry.isError ? entry.text : typing === entry.id ? <TypedAnswer text={entry.text} onDone={() => setTyping(null)} /> : withBold(entry.text)}
                    </div>
                    {entry.tools && entry.tools.length > 0 && typing !== entry.id ? (
                      <ul className="fade-in flex flex-wrap items-center gap-1.5" aria-label="Datos que consultó">
                        <li className="text-xs text-muted">Consultó</li>
                        {entry.tools.map((tool) => (
                          <li key={tool} className="rounded-full border border-line bg-surface/80 px-2 py-0.5 text-xs text-muted">
                            {toolLabels[tool] ?? tool}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </li>
              ),
            )}
            {pending ? (
              <li className="rise-in flex items-center gap-3" role="status">
                <AssistantOrb className="size-9" thinking />
                <span className="shimmer-text text-sm font-medium">Buscando en los datos de {organizationName}</span>
                <span className="flex gap-1" aria-hidden="true">
                  {[0, 1, 2].map((dot) => (
                    <span key={dot} className="typing-dot size-1.5 rounded-full bg-accent" style={{ animationDelay: `${dot * 0.15}s` }} />
                  ))}
                </span>
              </li>
            ) : null}
          </ol>
        )}
      </div>

      <div className="relative px-4 pt-2 pb-4 sm:px-6 sm:pb-6">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            ask(question);
          }}
          className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-[1.75rem] border border-line bg-surface/90 p-2 pl-4 shadow-lg backdrop-blur transition duration-200 focus-within:border-accent/60 focus-within:shadow-[0_0_0_4px_var(--glow)]"
        >
          <textarea
            ref={inputRef}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                ask(question);
              }
            }}
            rows={1}
            maxLength={1000}
            aria-label={`Tu pregunta para ${agentName}`}
            placeholder={`Preguntale a ${agentName}...`}
            className="max-h-44 min-w-0 flex-1 resize-none bg-transparent py-2 text-sm outline-none placeholder:text-muted sm:text-[15px]"
          />
          {!empty ? (
            <button
              type="button"
              onClick={() => {
                setEntries([]);
                setTyping(null);
              }}
              disabled={pending}
              className="hidden shrink-0 rounded-full px-3 py-2 text-xs font-medium text-muted transition hover:bg-zinc-100 hover:text-foreground sm:block dark:hover:bg-zinc-800"
            >
              Nueva charla
            </button>
          ) : null}
          <button
            type="submit"
            disabled={pending || question.trim() === ""}
            aria-label="Preguntar"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-linear-to-br from-accent to-agent-assistant text-white shadow-md transition duration-200 hover:scale-105 disabled:scale-100 disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 19V5M5.5 11.5 12 5l6.5 6.5" />
            </svg>
          </button>
        </form>
        <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-muted">
          {agentName} solo lee: responde con los datos de {organizationName} que podés ver vos.
        </p>
      </div>
    </div>
  );
}
