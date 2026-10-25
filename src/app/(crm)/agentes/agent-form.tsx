"use client";

import { useActionState } from "react";

import { AgentCard, type AgentView } from "@/components/agents/agent-card";

import { saveAgent, type AgentFormState } from "./actions";

const INITIAL: AgentFormState = { error: null, saved: false };

export function AgentForm({ id, agent }: { id: string; agent: AgentView }) {
  const [state, action, pending] = useActionState(saveAgent.bind(null, id), INITIAL);

  return (
    <section className="flex flex-col gap-3">
      <AgentCard agent={agent} />

      <form action={action} className="card flex flex-col gap-3 p-4">
        <label className="flex flex-col gap-1 text-sm">
          Nombre
          <input name="name" defaultValue={agent.name} maxLength={40} required className="field" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Frase
          <input name="tagline" defaultValue={agent.tagline ?? ""} maxLength={140} className="field" />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isEnabled" defaultChecked={agent.isEnabled} className="size-4 accent-accent" />
          {agent.kind === "attention" ? "Encendido (atiende las conversaciones)" : "Encendido (responde las preguntas del equipo)"}
        </label>

        <div className="flex items-center gap-3">
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "Guardando..." : "Guardar"}
          </button>
          {state.saved ? <p role="status" className="text-sm text-success">Guardado.</p> : null}
          {state.error ? <p role="alert" className="text-sm text-danger">{state.error}</p> : null}
        </div>
      </form>
    </section>
  );
}
