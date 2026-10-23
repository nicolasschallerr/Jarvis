"use client";

import { useActionState, useState, useTransition } from "react";

import { CASE_PRIORITIES, CASE_STATUSES, type CasePriority, type CaseStatus } from "@/lib/crm/cases";
import { PRIORITY_LABELS, STATUS_LABELS } from "@/lib/crm/format";

import {
  assignCaseAction,
  changePriorityAction,
  changeSectorAction,
  changeStatusAction,
  createCaseAction,
  type CaseState,
} from "./case-actions";

const NO_ERROR: CaseState = { error: null };
const fieldClass = "field !py-1.5";
const buttonClass =
  "btn-primary";

export function CreateCaseForm({ conversationId, sectors }: { conversationId: string; sectors: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(createCaseAction.bind(null, conversationId), NO_ERROR);

  return (
    <form action={action} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        Título del caso
        <input name="title" required maxLength={120} placeholder="Ej.: Consulta de préstamo" className={fieldClass} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Sector
        <select name="sectorId" defaultValue="" className={fieldClass}>
          <option value="">Sin sector todavía</option>
          {sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Prioridad
        <select name="priority" defaultValue="normal" className={fieldClass}>
          {CASE_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Creando..." : "Crear caso"}
      </button>
      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}

export function CaseControls(props: {
  conversationId: string;
  caseId: string;
  status: CaseStatus;
  priority: CasePriority;
  assignedTo: string | null;
  sectorId: string | null;
  currentUserId: string;
  people: { id: string; name: string }[];
  sectors: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState("");
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<CaseState>, onSuccess?: () => void) {
    startTransition(async () => {
      const result = await action();
      setError(result.error);
      if (!result.error) onSuccess?.();
    });
  }

  if (!props.canEdit) return null;

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Estado
        <select
          value={props.status}
          disabled={pending}
          onChange={(event) => {
            const status = event.target.value as CaseStatus;
            if (status === "resolved") {
              setResolving(true);
              return;
            }
            setResolving(false);
            run(() => changeStatusAction(props.conversationId, props.caseId, status, ""));
          }}
          className={fieldClass}
        >
          {CASE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
      </label>

      {resolving ? (
        <div className="flex flex-col gap-2 rounded-md border border-zinc-300 p-2 dark:border-zinc-700">
          <label className="flex flex-col gap-1 text-sm">
            ¿Cómo se resolvió? (opcional)
            <textarea
              rows={3}
              maxLength={1000}
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              className={fieldClass}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={pending}
              className={buttonClass}
              onClick={() =>
                run(
                  () => changeStatusAction(props.conversationId, props.caseId, "resolved", resolution),
                  () => {
                    setResolving(false);
                    setResolution("");
                  },
                )
              }
            >
              Marcar como resuelto
            </button>
            <button type="button" onClick={() => setResolving(false)} className="btn-secondary">
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      <label className="flex flex-col gap-1 text-sm">
        Prioridad
        <select
          value={props.priority}
          disabled={pending}
          onChange={(event) => run(() => changePriorityAction(props.conversationId, props.caseId, event.target.value as CasePriority))}
          className={fieldClass}
        >
          {CASE_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Sector
        <select
          value={props.sectorId ?? ""}
          disabled={pending}
          onChange={(event) => run(() => changeSectorAction(props.conversationId, props.caseId, event.target.value || null))}
          className={fieldClass}
        >
          <option value="">Sin sector</option>
          {props.sectors.map((sector) => (
            <option key={sector.id} value={sector.id}>
              {sector.name}
            </option>
          ))}
        </select>
        <span className="text-xs text-zinc-600 dark:text-zinc-400">Al cambiar de sector se quita la asignación.</span>
      </label>

      <label className="flex flex-col gap-1 text-sm">
        Asignado a
        <select
          value={props.assignedTo ?? ""}
          disabled={pending}
          onChange={(event) => run(() => assignCaseAction(props.conversationId, props.caseId, event.target.value || null))}
          className={fieldClass}
        >
          <option value="">Sin asignar</option>
          {props.people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>

      {props.assignedTo !== props.currentUserId ? (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => assignCaseAction(props.conversationId, props.caseId, props.currentUserId))}
          className="btn-secondary"
        >
          Tomarlo yo
        </button>
      ) : null}

      {error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </div>
  );
}
