"use client";

import { useActionState, useEffect, useRef } from "react";

import { sendReply, type ReplyState } from "./actions";

const INITIAL: ReplyState = { error: null, sentAt: null };

export function ReplyForm({ conversationId }: { conversationId: string }) {
  const [state, action, pending] = useActionState(sendReply.bind(null, conversationId), INITIAL);
  const formRef = useRef<HTMLFormElement>(null);

  // Después de un envío correcto se vacía el cuadro.
  useEffect(() => {
    if (state.sentAt) formRef.current?.reset();
  }, [state.sentAt]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2 border-t border-zinc-200 px-6 py-4 dark:border-zinc-800">
      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      <div className="flex items-end gap-2">
        <textarea
          name="text"
          rows={2}
          required
          maxLength={4000}
          disabled={pending}
          placeholder="Escribí tu respuesta. Enter envía, Shift+Enter hace un salto de línea."
          aria-label="Respuesta"
          className="min-h-12 flex-1 resize-y rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900"
        >
          {pending ? "Enviando..." : "Enviar"}
        </button>
      </div>
    </form>
  );
}
