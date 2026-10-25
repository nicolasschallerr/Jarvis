"use client";

import { useActionState } from "react";

import { syncTemplatesAction, type SyncState } from "./actions";

const INITIAL: SyncState = { error: null, message: null, problems: [] };

export function SyncButton() {
  const [state, action, pending] = useActionState(syncTemplatesAction, INITIAL);

  return (
    <form action={action} className="flex flex-col items-end gap-2">
      <button type="submit" disabled={pending} className="btn-primary">
        {pending ? "Sincronizando..." : "Sincronizar con Meta"}
      </button>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.message ? (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      ) : null}
      {state.problems.length > 0 ? (
        <ul role="alert" className="max-w-md list-disc rounded-lg bg-warning-soft py-2 pr-3 pl-6 text-left text-xs text-warning">
          {state.problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
