"use client";

import { useRef, useState, useTransition } from "react";

import type { AnalystAnswer, AnalystTurn } from "@/lib/analytics/ask";

import { askAnalystAction } from "./actions";

// Los agentes responden con **negritas** de Markdown: se muestran como negrita y el resto queda como texto (los saltos
// de línea y las listas con guion ya se ven bien con whitespace-pre-wrap). No se interpreta nada más: es texto seguro.
function withBold(text: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={index}>{part.slice(2, -2)}</strong> : part,
  );
}

type Entry = { role: "user" | "assistant"; text: string; tools?: string[]; isError?: boolean };

const TOOL_LABELS: Record<string, string> = {
  contar_casos: "casos",
  tiempos_de_resolucion: "tiempos de resolución",
  contar_conversaciones: "conversaciones",
  consultas_al_area: "consultas al área",
  resumen_de_consumo: "consumo",
};

const EXAMPLES = [
  "¿Cuántos casos abiertos hay por sector?",
  "¿Cuánto tardamos en resolver los casos este mes?",
  "¿Cuántos créditos usamos este mes?",
  "¿Qué sector tarda más en responder las consultas del agente?",
];

// El mismo chat sirve para el agente analítico y para el financiero (/finanzas): cambian la acción, los ejemplos y los
// nombres de las herramientas.
export function AnalystChat({
  agentName,
  action = askAnalystAction,
  examples = EXAMPLES,
  toolLabels = TOOL_LABELS,
  intro,
}: {
  agentName: string;
  action?: (history: AnalystTurn[], question: string) => Promise<AnalystAnswer>;
  examples?: string[];
  toolLabels?: Record<string, string>;
  intro?: string;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [question, setQuestion] = useState("");
  const [pending, startTransition] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  function ask(text: string) {
    const clean = text.trim();
    if (!clean || pending) return;

    // La charla previa (sin los errores) se manda para que entienda "¿y el mes pasado?".
    const history: AnalystTurn[] = entries.filter((entry) => !entry.isError).map((entry) => ({ role: entry.role, text: entry.text }));
    setEntries((current) => [...current, { role: "user", text: clean }]);
    setQuestion("");

    startTransition(async () => {
      const result = await action(history, clean);
      setEntries((current) => [
        ...current,
        result.ok ? { role: "assistant", text: result.answer, tools: result.toolsUsed } : { role: "assistant", text: result.error, isError: true },
      ]);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    });
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="card flex min-h-64 flex-1 flex-col gap-3 overflow-y-auto p-4" aria-live="polite">
        {entries.length === 0 ? (
          <div className="flex flex-col gap-3 text-sm">
            <p className="text-muted">
              {intro ?? `Preguntale a ${agentName} por los números de tu operación. Responde con datos reales y no modifica nada.`}
            </p>
            <ul className="flex flex-wrap gap-2">
              {examples.map((example) => (
                <li key={example}>
                  <button type="button" onClick={() => ask(example)} className="btn-secondary !px-3 !py-1.5 text-left text-xs">
                    {example}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          entries.map((entry, index) => (
            <div key={index} className={`flex flex-col gap-1 ${entry.role === "user" ? "items-end" : "items-start"}`}>
              <p
                className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-sm ${
                  entry.role === "user"
                    ? "bg-zinc-200 dark:bg-zinc-700"
                    : entry.isError
                      ? "bg-danger-soft text-danger"
                      : "bg-zinc-100 dark:bg-zinc-800"
                }`}
              >
                {entry.role === "assistant" && !entry.isError ? withBold(entry.text) : entry.text}
              </p>
              {entry.tools && entry.tools.length > 0 ? (
                <p className="text-xs text-muted">Consultó: {entry.tools.map((tool) => toolLabels[tool] ?? tool).join(", ")}</p>
              ) : null}
            </div>
          ))
        )}
        {pending ? <p className="text-sm text-muted">{agentName} está mirando los datos...</p> : null}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
        className="flex items-end gap-2"
      >
        <textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              ask(question);
            }
          }}
          rows={2}
          maxLength={1000}
          disabled={pending}
          aria-label="Tu pregunta"
          placeholder="Escribí tu pregunta..."
          className="field min-w-0 flex-1"
        />
        <button type="submit" disabled={pending || question.trim() === ""} className="btn-primary">
          {pending ? "Consultando..." : "Preguntar"}
        </button>
      </form>
    </div>
  );
}
