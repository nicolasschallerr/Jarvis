"use client";

import { useActionState } from "react";

import { saveLimitsAction, type LimitsState } from "./actions";

const INITIAL: LimitsState = { error: null, savedAt: null };

export function LimitsForm({ credits, costUsd, alertPercent }: { credits: number | null; costUsd: number | null; alertPercent: number }) {
  const [state, action, pending] = useActionState(saveLimitsAction, INITIAL);

  return (
    <form action={action} className="flex flex-col gap-3 border-t border-line pt-4">
      <p className="text-sm text-muted">Dejá un campo vacío si no querés ese límite. Es un aviso: el agente no se corta al llegar.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Límite de créditos por mes
          <input name="credits" inputMode="numeric" defaultValue={credits ?? ""} placeholder="Sin límite" className="field !py-1.5" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Límite de costo de IA (USD)
          <input name="costUsd" inputMode="decimal" defaultValue={costUsd ?? ""} placeholder="Sin límite" className="field !py-1.5" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Avisar al llegar al (%)
          <input name="alertPercent" inputMode="numeric" defaultValue={alertPercent} className="field !py-1.5" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className="btn-primary">
          {pending ? "Guardando..." : "Guardar límites"}
        </button>
        {state.error ? (
          <p role="alert" className="text-sm text-danger">
            {state.error}
          </p>
        ) : null}
        {state.savedAt && !state.error ? (
          <p role="status" className="text-sm text-success">
            Límites guardados.
          </p>
        ) : null}
      </div>
    </form>
  );
}
