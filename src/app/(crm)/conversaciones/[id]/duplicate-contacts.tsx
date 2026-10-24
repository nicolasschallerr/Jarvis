"use client";

import { useActionState, useState } from "react";

import type { DuplicateCandidate } from "@/lib/crm/contact-merge";

import { mergeContactAction, type MergeState } from "./merge-actions";

const INITIAL: MergeState = { error: null, message: null };

function Candidate({ keepId, conversationId, candidate }: { keepId: string; conversationId: string; candidate: DuplicateCandidate }) {
  const [state, action, pending] = useActionState(mergeContactAction.bind(null, keepId, candidate.id, conversationId), INITIAL);
  // Unir no se puede deshacer: primero se pide confirmar.
  const [confirming, setConfirming] = useState(false);

  const channels = candidate.identities.map((identity) => `${identity.channelType} ${identity.identifier}`).join(", ");

  return (
    <li className="flex flex-col gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/40">
      <div>
        <p className="font-medium">{candidate.displayName || "Sin nombre"}</p>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">
          {[candidate.locality, channels].filter(Boolean).join(" · ") || "Sin más datos"}
        </p>
      </div>

      {confirming ? (
        <form action={action} className="flex flex-col gap-2">
          <p className="text-xs">
            Todo lo de este contacto (conversaciones, casos y datos) pasa al de esta conversación. <strong>No se puede deshacer.</strong>
          </p>
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="btn-primary !px-2 !py-1 text-xs">
              {pending ? "Uniendo..." : "Sí, unir"}
            </button>
            <button type="button" disabled={pending} onClick={() => setConfirming(false)} className="btn-secondary !px-2 !py-1 text-xs">
              Cancelar
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} className="btn-secondary !px-2 !py-1 text-xs self-start">
          Unir con este contacto
        </button>
      )}

      {state.error ? <p role="alert" className="text-xs text-red-600 dark:text-red-400">{state.error}</p> : null}
      {state.message ? <p role="status" className="text-xs text-emerald-700 dark:text-emerald-400">{state.message}</p> : null}
    </li>
  );
}

export function DuplicateContacts({ keepId, conversationId, candidates }: { keepId: string; conversationId: string; candidates: DuplicateCandidate[] }) {
  if (candidates.length === 0) return null;

  return (
    <section aria-labelledby="duplicados" className="flex flex-col gap-2">
      <h3 id="duplicados" className="text-sm font-semibold">Posibles duplicados</h3>
      <p className="text-xs text-zinc-600 dark:text-zinc-400">Otras fichas con el mismo documento. Pueden ser la misma persona escribiendo por otro canal.</p>
      <ul className="flex flex-col gap-2">
        {candidates.map((candidate) => (
          <Candidate key={candidate.id} keepId={keepId} conversationId={conversationId} candidate={candidate} />
        ))}
      </ul>
    </section>
  );
}
