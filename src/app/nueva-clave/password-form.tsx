"use client";

import { useActionState } from "react";

import { MIN_PASSWORD_LENGTH } from "@/lib/team/roles";

import { setPassword, type PasswordState } from "./actions";

const INITIAL: PasswordState = { error: null };

export function PasswordForm() {
  const [state, action, pending] = useActionState(setPassword, INITIAL);

  return (
    <form action={action} className="flex w-full flex-col gap-4">
      <label className="flex flex-col gap-1 text-sm font-medium">
        Contraseña nueva
        <input name="password" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} className="field text-base font-normal" />
        <span className="text-xs font-normal text-muted">Al menos {MIN_PASSWORD_LENGTH} caracteres. Una frase larga es más segura que una palabra con símbolos.</span>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Repetila
        <input name="confirm" type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} className="field text-base font-normal" />
      </label>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Guardando..." : "Guardar contraseña"}
      </button>
    </form>
  );
}
