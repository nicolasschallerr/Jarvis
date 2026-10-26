"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";

import type { QuickReply } from "@/lib/crm/quick-replies";

import { SparkIcon } from "@/components/ui/icons";

import { sendReply, suggestReplyAction, type ReplyState } from "./actions";
import { editQuickReply, removeQuickReply, saveQuickReply } from "./quick-reply-actions";

const INITIAL: ReplyState = { error: null, sentAt: null };

export function ReplyForm({
  conversationId,
  agentName,
  aiEnabled,
  quickReplies,
}: {
  conversationId: string;
  agentName: string;
  aiEnabled: boolean;
  quickReplies: QuickReply[];
}) {
  const [state, action, pending] = useActionState(sendReply.bind(null, conversationId), INITIAL);
  const formRef = useRef<HTMLFormElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickPending, startQuick] = useTransition();
  const [suggesting, startSuggest] = useTransition();
  const [suggestError, setSuggestError] = useState<string | null>(null);

  // Después de un envío correcto se vacía el cuadro.
  useEffect(() => {
    if (state.sentAt) {
      formRef.current?.reset();
      textRef.current?.focus();
    }
  }, [state.sentAt]);

  function insert(body: string) {
    const area = textRef.current;
    if (!area) return;
    area.value = area.value.trim() ? `${area.value.trimEnd()}\n${body}` : body;
    area.focus();
  }

  // El copiloto redacta un borrador en el cuadro de respuesta; la persona lo lee, lo edita y lo envía ella.
  function suggest() {
    const area = textRef.current;
    if (area && area.value.trim() && !window.confirm("El cuadro tiene texto: el borrador lo va a reemplazar. ¿Seguir?")) return;
    setSuggestError(null);
    startSuggest(async () => {
      const result = await suggestReplyAction(conversationId);
      if (result.error || !result.text) {
        setSuggestError(result.error ?? "No se pudo pedir el borrador.");
        return;
      }
      if (area) {
        area.value = result.text;
        area.focus();
      }
    });
  }

  function save() {
    setQuickError(null);
    startQuick(async () => {
      const result = await saveQuickReply(conversationId, title, textRef.current?.value ?? "");
      if (result.error) setQuickError(result.error);
      else {
        setSaving(false);
        setTitle("");
      }
    });
  }

  // Renombrar (y, si hay texto escrito abajo, reemplazar el texto guardado con ese).
  function rename(reply: QuickReply) {
    const title = window.prompt("Nuevo título de la respuesta rápida:", reply.title);
    if (title === null) return;
    const typed = textRef.current?.value.trim() ?? "";
    const replaceText = typed !== "" && typed !== reply.body && window.confirm("¿Reemplazar también el texto guardado con el que escribiste abajo?");
    setQuickError(null);
    startQuick(async () => {
      const result = await editQuickReply(conversationId, reply.id, title, replaceText ? typed : reply.body);
      if (result.error) setQuickError(result.error);
    });
  }

  function remove(id: string, title: string) {
    // Es de toda la organización: se confirma antes de borrar.
    if (!window.confirm(`¿Borrar la respuesta rápida "${title}" para todo el equipo?`)) return;
    setQuickError(null);
    startQuick(async () => {
      const result = await removeQuickReply(conversationId, id);
      if (result.error) setQuickError(result.error);
    });
  }

  return (
    <form ref={formRef} action={action} className="flex flex-col gap-2 border-t border-line bg-surface px-4 py-3 sm:px-6">
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.aiPaused ? (
        <p role="status" className="text-xs text-warning">
          Tomaste el chat: {agentName} quedó en pausa en esta conversación. Podés devolvérselo desde el encabezado.
        </p>
      ) : aiEnabled ? (
        <p className="text-xs text-muted">{agentName} está atendiendo. Si respondés, tomás el chat y {agentName} se pausa acá.</p>
      ) : null}

      <details className="group text-sm">
        <summary className="cursor-pointer list-none text-xs font-medium text-muted hover:text-foreground [&::-webkit-details-marker]:hidden">
          Respuestas rápidas ({quickReplies.length}) <span aria-hidden="true">▾</span>
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          {quickReplies.length === 0 ? <p className="text-xs text-muted">Todavía no hay. Escribí un texto y guardalo para reusarlo.</p> : null}
          <ul className="flex flex-wrap gap-2">
            {quickReplies.map((reply) => (
              <li key={reply.id} className="flex items-center overflow-hidden rounded-lg border border-line">
                <button type="button" onClick={() => insert(reply.body)} title={reply.body} className="px-2.5 py-1 text-xs hover:bg-accent-soft">
                  {reply.title}
                </button>
                <button
                  type="button"
                  onClick={() => rename(reply)}
                  disabled={quickPending}
                  aria-label={`Editar la respuesta rápida ${reply.title}`}
                  title="Editar"
                  className="grid min-w-8 place-items-center border-l border-line px-2 py-1 text-sm text-muted hover:text-accent"
                >
                  ✎
                </button>
                <button
                  type="button"
                  onClick={() => remove(reply.id, reply.title)}
                  disabled={quickPending}
                  aria-label={`Borrar la respuesta rápida ${reply.title}`}
                  className="grid min-w-8 place-items-center border-l border-line px-2 py-1 text-sm text-muted hover:text-danger"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
          {saving ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={60}
                placeholder="Título (ej. Horarios)"
                aria-label="Título de la respuesta rápida"
                className="field !w-auto !py-1 text-xs"
              />
              <button type="button" onClick={save} disabled={quickPending} className="btn-primary !px-2 !py-1 text-xs">
                Guardar
              </button>
              <button type="button" onClick={() => setSaving(false)} className="btn-secondary !px-2 !py-1 text-xs">
                Cancelar
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setSaving(true)} className="btn-secondary self-start !px-2 !py-1 text-xs">
              Guardar el texto de abajo como respuesta rápida
            </button>
          )}
          {quickError ? (
            <p role="alert" className="text-xs text-danger">
              {quickError}
            </p>
          ) : null}
        </div>
      </details>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={suggest} disabled={suggesting || pending} className="btn-secondary !px-2.5 !py-1 text-xs">
          <SparkIcon className="size-3.5" aria-hidden="true" /> {suggesting ? "Redactando..." : "Sugerir respuesta"}
        </button>
        {suggestError ? (
          <p role="alert" className="text-xs text-danger">
            {suggestError}
          </p>
        ) : (
          <span className="text-xs text-muted">Es un borrador: revisalo antes de enviar.</span>
        )}
      </div>

      <div className="flex items-end gap-2">
        <textarea
          ref={textRef}
          name="text"
          rows={2}
          required
          maxLength={4000}
          readOnly={pending}
          aria-busy={pending}
          placeholder="Escribí tu respuesta. Enter envía, Shift+Enter hace un salto de línea."
          aria-label="Respuesta"
          className="min-h-12 flex-1 resize-y field"
          onKeyDown={(event) => {
            const touch = window.matchMedia("(pointer: coarse)").matches;
            if (event.key === "Enter" && !event.shiftKey && !touch && !event.nativeEvent.isComposing) {
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
