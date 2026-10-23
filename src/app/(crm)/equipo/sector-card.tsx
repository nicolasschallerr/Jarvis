"use client";

import { useActionState, useState, useTransition } from "react";

import { addMember, removeMember, toggleLead, type TeamState } from "./actions";

export type SectorView = {
  id: string;
  name: string;
  members: { profileId: string; fullName: string; isLead: boolean }[];
  candidates: { profileId: string; fullName: string }[];
};

const NO_ERROR: TeamState = { error: null };

export function SectorCard({ sector }: { sector: SectorView }) {
  const [addState, addAction, adding] = useActionState(addMember.bind(null, sector.id), NO_ERROR);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<TeamState>) {
    startTransition(async () => {
      const result = await action();
      setActionError(result.error);
    });
  }

  const error = actionError ?? addState.error;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-800">
      <h2 className="text-base font-semibold">{sector.name}</h2>

      {sector.members.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Todavía no hay personas en este sector.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sector.members.map((member) => (
            <li key={member.profileId} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                {member.fullName}
                {member.isLead ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-300">
                    Responsable
                  </span>
                ) : null}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => toggleLead(sector.id, member.profileId, !member.isLead))}
                  className="btn-secondary !px-2 !py-1 text-xs"
                >
                  {member.isLead ? "Quitar responsable" : "Marcar responsable"}
                </button>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => run(() => removeMember(sector.id, member.profileId))}
                  className="btn-secondary !px-2 !py-1 text-xs"
                >
                  Quitar
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {sector.candidates.length > 0 ? (
        <form
          action={(formData) => {
            setActionError(null);
            addAction(formData);
          }}
          className="flex items-center gap-2"
        >
          <select
            name="profileId"
            defaultValue=""
            aria-label={`Sumar a una persona a ${sector.name}`}
            className="min-w-0 flex-1 field !py-1.5"
          >
            <option value="" disabled>
              Elegí a una persona...
            </option>
            {sector.candidates.map((candidate) => (
              <option key={candidate.profileId} value={candidate.profileId}>
                {candidate.fullName}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={adding}
            className="btn-primary"
          >
            Sumar
          </button>
        </form>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}
