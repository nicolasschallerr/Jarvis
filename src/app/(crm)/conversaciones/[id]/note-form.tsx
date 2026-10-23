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
        className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {pending ? "Guardando..." : "Guardar nota"}
      </button>
      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
