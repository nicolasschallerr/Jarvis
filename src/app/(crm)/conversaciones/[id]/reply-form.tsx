"use client";

import { useActionState, useEffect, useRef } from "react";

import { sendReply, type ReplyState } from "./actions";

const INITIAL: ReplyState = { error: null, sentAt: null };

export function ReplyForm({ conversationId, aiEnabled }: { conversationId: string; aiEnabled: boolean }) {
  const [state, action, pending] = useActionState(sendReply.bind(null, conversationId), INITIAL);
  const formRef = useRef<HTMLFormElement>(null);

  // Después de un envío correcto se vacía el cuadro.
  useEffect(() => {
    if (state.sentAt) formRef.current?.reset();
  }, [state.sentAt]);

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2 border-t border-line bg-surface px-4 py-3 sm:px-6">
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.aiPaused ? (
        <p role="status" className="text-xs text-warning">
          Tomaste el chat: Jarvis quedó en pausa en esta conversación. Podés devolvérselo desde el encabezado.
        </p>
      ) : aiEnabled ? (
        <p className="text-xs text-muted">Jarvis está atendiendo. Si respondés, tomás el chat y Jarvis se pausa acá.</p>
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
          className="min-h-12 flex-1 resize-y field"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Enviando..." : "Enviar"}
        </button>
      </div>
    </form>
  );
}
