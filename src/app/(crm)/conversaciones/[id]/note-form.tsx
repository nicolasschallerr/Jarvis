"use client";

import { useActionState, useEffect, useRef } from "react";

import { addNoteAction, type NoteState } from "./note-actions";

const INITIAL: NoteState = { error: null, savedAt: null };

export function NoteForm({ conversationId }: { conversationId: string }) {
  const [state, action, pending] = useActionState(addNoteAction.bind(null, conversationId), INITIAL);
  const formRef = useRef<HTMLFormElement>(null);

  // Después de guardar se vacía el cuadro.
  useEffect(() => {
    if (state.savedAt) formRef.current?.reset();
  }, [state.savedAt]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2">
      <textarea
        name="body"
        rows={3}
        required
        maxLength={2000}
        disabled={pending}
        aria-label="Nueva nota interna"
        placeholder="Anotación para el equipo. El contacto no la ve."
        className="field !py-1.5"
      />
      <button
        type="submit"
        disabled={pending}
        className="btn-primary"
      >
        {pending ? "Guardando..." : "Guardar nota"}
      </button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
