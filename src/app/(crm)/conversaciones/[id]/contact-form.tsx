"use client";

import { useActionState } from "react";

import { updateContactAction, type ContactState } from "./contact-actions";

const INITIAL: ContactState = { error: null, warning: null, savedAt: null };
const fieldClass = "field !py-1.5";

export type ContactValues = {
  displayName: string;
  documentNumber: string;
  locality: string;
  notes: string;
};

export function ContactForm({
  contactId,
  conversationId,
  values,
  canEdit,
}: {
  contactId: string;
  conversationId: string;
  values: ContactValues;
  canEdit: boolean;
}) {
  const [state, action, pending] = useActionState(updateContactAction.bind(null, contactId, conversationId), INITIAL);

  return (
    <form action={action} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        Nombre
        <input name="displayName" defaultValue={values.displayName} maxLength={120} readOnly={!canEdit} className={fieldClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Documento
        <input
          name="documentNumber"
          defaultValue={values.documentNumber}
          inputMode="numeric"
          maxLength={14}
          placeholder="Solo números"
          readOnly={!canEdit}
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Localidad
        <input name="locality" defaultValue={values.locality} maxLength={80} readOnly={!canEdit} className={fieldClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Notas del contacto
        <textarea name="notes" defaultValue={values.notes} rows={3} maxLength={1000} readOnly={!canEdit} className={fieldClass} />
      </label>

      {canEdit ? (
        <button
          type="submit"
          disabled={pending}
          className="btn-primary"
        >
          {pending ? "Guardando..." : "Guardar ficha"}
        </button>
      ) : null}

      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      {state.warning ? <p className="text-sm text-amber-700 dark:text-amber-400">{state.warning}</p> : null}
      {state.savedAt && !state.error ? <p className="text-sm text-emerald-700 dark:text-emerald-400">Ficha guardada.</p> : null}
    </form>
  );
}
