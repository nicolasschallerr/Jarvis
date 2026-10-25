"use client";

import { useActionState } from "react";

import { Badge } from "@/components/ui/badge";
import type { ConsentStatus } from "@/lib/consent";

import { setConsentAction, type ConsentState } from "./consent-actions";

const INITIAL: ConsentState = { error: null, savedAt: null };

const STATUS: Record<ConsentStatus, { label: string; tone: "success" | "warning" | "neutral" }> = {
  accepted: { label: "Aceptó recibir mensajes", tone: "success" },
  withdrawn: { label: "Pidió no recibir más", tone: "warning" },
  none: { label: "Sin registrar", tone: "neutral" },
};

// Consentimiento para envíos masivos. Sin esto el contacto no entra en ninguna lista. Anotar cómo aceptó queda en la
// auditoría (sin datos personales: no escribir DNI ni teléfonos en la nota).
export function ConsentCard({ contactId, status, since, canEdit }: { contactId: string; status: ConsentStatus; since: string | null; canEdit: boolean }) {
  const [giveState, give, giving] = useActionState(setConsentAction.bind(null, contactId, "give"), INITIAL);
  const [withdrawState, withdraw, withdrawing] = useActionState(setConsentAction.bind(null, contactId, "withdraw"), INITIAL);
  const current = STATUS[status];
  const error = giveState.error ?? withdrawState.error;

  return (
    <section aria-labelledby="consentimiento" className="card flex flex-col gap-3 p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="consentimiento" className="font-semibold">
          Mensajes masivos
        </h2>
        <Badge tone={current.tone} dot>
          {current.label}
        </Badge>
      </div>
      {since ? <p className="text-xs text-muted">Desde {since}.</p> : null}
      <p className="text-xs text-muted">Solo se le escribe en masa a quien aceptó recibir mensajes. Una baja se respeta siempre.</p>

      {canEdit ? (
        <>
          {status !== "accepted" ? (
            <form action={give} className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-xs font-medium">
                ¿Cómo aceptó? (queda registrado)
                <input name="source" required minLength={3} maxLength={200} placeholder="Ej.: lo pidió por teléfono el 12/10" className="field !py-1.5 text-sm font-normal" />
              </label>
              <button type="submit" disabled={giving} className="btn-secondary self-start">
                {giving ? "Guardando..." : "Registrar que aceptó"}
              </button>
            </form>
          ) : null}
          {status !== "withdrawn" ? (
            <form
              action={withdraw}
              onSubmit={(event) => {
                if (!window.confirm("¿Registrar que pidió no recibir más mensajes? No va a entrar en ningún envío masivo.")) event.preventDefault();
              }}
            >
              <input type="hidden" name="source" value="registrado por una persona del equipo" />
              <button type="submit" disabled={withdrawing} className="btn-secondary">
                {withdrawing ? "Guardando..." : "Registrar baja"}
              </button>
            </form>
          ) : null}
        </>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
      {(giveState.savedAt || withdrawState.savedAt) && !error ? (
        <p role="status" className="text-sm text-success">
          Guardado.
        </p>
      ) : null}
    </section>
  );
}
