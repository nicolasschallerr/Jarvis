"use client";

import { useActionState, useState, useTransition } from "react";

import { cancelBroadcastAction, scheduleBroadcastAction, type BroadcastState } from "../actions";

const INITIAL: BroadcastState = { error: null };

// Qué se puede hacer con un envío según su estado. Todo lo que le escribe a gente pide confirmación: no se puede
// deshacer un mensaje ya enviado.
export function BroadcastControls({ id, status, audience }: { id: string; status: string; audience: number }) {
  const [state, action, pending] = useActionState(scheduleBroadcastAction.bind(null, id), INITIAL);
  const [when, setWhen] = useState<"now" | "later">("now");
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelling, startCancel] = useTransition();

  function cancel() {
    const question = status === "draft" ? "¿Descartar este borrador?" : "¿Cancelar el envío? Lo que todavía no salió no se va a enviar (lo ya enviado no se puede deshacer).";
    if (!window.confirm(question)) return;
    setCancelError(null);
    startCancel(async () => {
      const result = await cancelBroadcastAction(id);
      if (result.error) setCancelError(result.error);
    });
  }

  if (status === "done" || status === "cancelled") return null;

  return (
    <section aria-label="Acciones del envío" className="card flex flex-col gap-4 p-4">
      {status === "draft" ? (
        <form
          action={action}
          onSubmit={(event) => {
            const text = when === "now" ? `¿Enviar ahora a ${audience} contactos? No se puede deshacer.` : `¿Programar el envío a ${audience} contactos?`;
            if (!window.confirm(text)) event.preventDefault();
          }}
          className="flex flex-col gap-3"
        >
          <fieldset className="flex flex-col gap-2 text-sm">
            <legend className="mb-1 font-medium">¿Cuándo sale?</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="when" value="now" checked={when === "now"} onChange={() => setWhen("now")} className="size-4 accent-accent" />
              Ahora (en cuanto lo tome el sistema, en unos segundos)
            </label>
            <label className="flex flex-wrap items-center gap-2">
              <input type="radio" name="when" value="later" checked={when === "later"} onChange={() => setWhen("later")} className="size-4 accent-accent" />
              Programarlo para
              <input type="datetime-local" name="at" disabled={when !== "later"} required={when === "later"} className="field !w-auto !py-1" aria-label="Fecha y hora del envío" />
            </label>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" disabled={pending} className="btn-primary">
              {pending ? "Programando..." : when === "now" ? "Enviar ahora" : "Programar"}
            </button>
            <button type="button" onClick={cancel} disabled={cancelling} className="btn-secondary">
              Descartar borrador
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted">{status === "scheduled" ? "Todavía no salió: se puede cancelar sin que nadie reciba nada." : "Se está enviando. Si cancelás, lo que falta no sale."}</p>
          <button type="button" onClick={cancel} disabled={cancelling} className="btn-danger">
            {cancelling ? "Cancelando..." : "Cancelar envío"}
          </button>
        </div>
      )}
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {cancelError ? (
        <p role="alert" className="text-sm text-danger">
          {cancelError}
        </p>
      ) : null}
    </section>
  );
}
