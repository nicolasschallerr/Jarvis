"use client";

import { useActionState } from "react";

import { answerAreaQueryAction, type AreaAnswerState } from "./area-actions";

const INITIAL: AreaAnswerState = { error: null, savedAt: null };

export function AreaAnswerForm({ conversationId, queryId }: { conversationId: string; queryId: string }) {
  const [state, action, pending] = useActionState(answerAreaQueryAction.bind(null, conversationId, queryId), INITIAL);

  return (
    <form action={action} className="flex flex-col gap-2">
      <textarea
        name="answer"
        rows={3}
        required
        maxLength={2000}
        disabled={pending}
        aria-label="Respuesta a la consulta"
        placeholder="Respondé con el dato confirmado. El agente se lo transmite al asociado."
        className="field !py-1.5"
      />
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Enviando..." : "Responder consulta"}
      </button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
