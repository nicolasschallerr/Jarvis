"use client";

import { useActionState, useState, useTransition } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ACCESS_LINK_MINUTES, ROLE_LABELS, ROLES, type Role } from "@/lib/team/roles";

import { addMemberAction, changeActiveAction, changeRoleAction, resetAccessAction, type PeopleState } from "./people-actions";

export type PersonView = { id: string; fullName: string; email: string; role: Role; isActive: boolean; isYou: boolean };

const INITIAL: PeopleState = { error: null, link: null, notice: null };

// El enlace de acceso se muestra una sola vez: quien lo tenga entra como esa persona hasta que elija su contraseña.
function LinkBox({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm">
      <p className="text-warning">
        <strong>Se muestra una sola vez y dura {ACCESS_LINK_MINUTES} minutos.</strong> Quien tenga el enlace puede entrar como esa persona: mandáselo solo
        a ella.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <input readOnly value={link} aria-label="Enlace de acceso" className="field min-w-0 flex-1 font-mono text-xs" onFocus={(event) => event.currentTarget.select()} />
        <button
          type="button"
          className="btn-secondary"
          onClick={() => {
            void navigator.clipboard.writeText(link).then(() => setCopied(true));
          }}
        >
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
    </div>
  );
}

function Feedback({ state }: { state: PeopleState }) {
  return (
    <>
      {state.error ? (
        <p role="alert" className="text-sm text-danger">
          {state.error}
        </p>
      ) : null}
      {state.notice ? (
        <p role="status" className="text-sm text-success">
          {state.notice}
        </p>
      ) : null}
      {state.link ? <LinkBox link={state.link} /> : null}
    </>
  );
}

function AddPerson() {
  const [state, action, pending] = useActionState(addMemberAction, INITIAL);

  return (
    <form action={action} className="card flex flex-col gap-3 p-4">
      <h3 className="text-sm font-semibold">Sumar una persona</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Nombre y apellido
          <input name="fullName" required minLength={2} maxLength={120} autoComplete="off" className="field !py-1.5" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input name="email" type="email" required maxLength={200} autoComplete="off" className="field !py-1.5" />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm sm:max-w-xs">
        Rol
        <select name="role" defaultValue="operator" className="field !py-1.5">
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" disabled={pending} className="btn-primary self-start">
        {pending ? "Creando..." : "Crear y generar enlace"}
      </button>
      <Feedback state={state} />
    </form>
  );
}

function PersonRow({ person }: { person: PersonView }) {
  const [state, setState] = useState<PeopleState>(INITIAL);
  const [pending, startTransition] = useTransition();

  function run(task: () => Promise<PeopleState>) {
    setState(INITIAL);
    startTransition(async () => setState(await task()));
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={person.fullName} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 font-medium">
            {person.fullName}
            {person.isYou ? <Badge tone="accent">Vos</Badge> : null}
            {!person.isActive ? <Badge tone="warning">Desactivada</Badge> : null}
          </p>
          <p className="truncate text-sm text-muted">{person.email}</p>
        </div>
        <select
          aria-label={`Rol de ${person.fullName}`}
          value={person.role}
          disabled={pending || person.isYou}
          onChange={(event) => run(() => changeRoleAction(person.id, event.target.value))}
          className="field !w-auto !py-1 text-sm"
        >
          {ROLES.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <button type="button" disabled={pending || !person.isActive} className="btn-secondary !py-1 text-xs" onClick={() => run(() => resetAccessAction(person.id))}>
            Enlace de acceso
          </button>
          {!person.isYou ? (
            <button
              type="button"
              disabled={pending}
              className={person.isActive ? "btn-danger !py-1 text-xs" : "btn-secondary !py-1 text-xs"}
              onClick={() => {
                if (person.isActive && !window.confirm(`¿Desactivar a ${person.fullName}? Ya no va a poder entrar.`)) return;
                run(() => changeActiveAction(person.id, !person.isActive));
              }}
            >
              {person.isActive ? "Desactivar" : "Reactivar"}
            </button>
          ) : null}
        </div>
      </div>
      <Feedback state={state} />
    </li>
  );
}

// Personas de la organización: alta con enlace de acceso, rol, activar y desactivar, y enlace para quien olvidó su
// contraseña. Solo el superadmin ve esta sección.
export function People({ people }: { people: PersonView[] }) {
  return (
    <section aria-labelledby="personas" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 id="personas" className="text-lg font-semibold">
          Personas
        </h2>
        <p className="text-sm text-muted">
          Quién puede entrar y con qué rol. Si alguien olvidó su contraseña, generale un enlace de acceso y pasaselo.
        </p>
      </div>
      <ul className="card divide-y divide-line">
        {people.map((person) => (
          <PersonRow key={person.id} person={person} />
        ))}
      </ul>
      <AddPerson />
    </section>
  );
}
