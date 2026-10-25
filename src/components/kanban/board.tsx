"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";

import { moveCaseAction, type MoveState } from "@/app/(crm)/casos/actions";
import { CASE_STATUSES, type CaseStatus } from "@/lib/crm/cases";
import { PriorityBadge } from "@/components/ui/badge";
import { shortDate, STATUS_LABELS } from "@/lib/crm/format";

export type BoardCase = {
  id: string;
  title: string;
  status: CaseStatus;
  priority: string;
  sectorName: string | null;
  assigneeName: string | null;
  contactName: string | null;
  conversationId: string | null;
  updatedAt: string;
};

const isStatus = (value: unknown): value is CaseStatus => CASE_STATUSES.includes(value as CaseStatus);

function CardBody({ item, now }: { item: BoardCase; now: Date }) {
  return (
    <>
      <div className="flex items-start justify-between gap-2">
        {item.conversationId ? (
          <Link href={`/conversaciones/${item.conversationId}`} className="min-w-0 text-sm font-medium hover:underline">
            {item.title}
          </Link>
        ) : (
          <p className="min-w-0 text-sm font-medium">{item.title}</p>
        )}
        <span className="shrink-0">
          <PriorityBadge priority={item.priority} />
        </span>
      </div>
      <p className="text-xs text-muted">
        {item.contactName || "Sin nombre"} · {item.sectorName ?? "Sin sector"}
      </p>
      <p className="text-xs text-muted">
        {item.assigneeName ? `Asignado a ${item.assigneeName}` : "Sin asignar"} · {shortDate(item.updatedAt, now)}
      </p>
    </>
  );
}

function CaseCard({ item, now, canEdit, onMove }: { item: BoardCase; now: Date; canEdit: boolean; onMove: (id: string, status: CaseStatus) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: item.id, disabled: !canEdit });

  return (
    <li
      ref={setNodeRef}
      className={`card flex flex-col gap-1.5 p-3 transition ${isDragging ? "opacity-40" : "hover:-translate-y-0.5 hover:shadow-md"}`}
    >
      <CardBody item={item} now={now} />

      {canEdit ? (
        <div className="mt-1 flex items-center gap-2">
          {/* Manija: solo desde acá se arrastra, así los enlaces, el selector y el desplazamiento táctil de las
              columnas no se pisan con el arrastre. También se mueve con el teclado (espacio y flechas). */}
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...listeners}
            {...attributes}
            aria-label={`Mover el caso ${item.title}`}
            className="btn-secondary cursor-grab touch-none !px-2 !py-1 text-xs active:cursor-grabbing"
          >
            <svg viewBox="0 0 16 16" className="size-4" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="3" r="1.3" />
              <circle cx="11" cy="3" r="1.3" />
              <circle cx="5" cy="8" r="1.3" />
              <circle cx="11" cy="8" r="1.3" />
              <circle cx="5" cy="13" r="1.3" />
              <circle cx="11" cy="13" r="1.3" />
            </svg>
          </button>
          <label className="flex min-w-0 flex-1 items-center gap-1 text-xs text-muted">
            <span className="sr-only">Mover a</span>
            <select
              aria-label={`Mover el caso ${item.title} a otro estado`}
              value={item.status}
              onChange={(event) => isStatus(event.target.value) && onMove(item.id, event.target.value)}
              className="field min-w-0 flex-1 !px-2 !py-1 text-xs text-foreground"
            >
              {CASE_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {STATUS_LABELS[status]}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}
    </li>
  );
}

function Column({ status, items, now, canEdit, onMove }: { status: CaseStatus; items: BoardCase[]; now: Date; canEdit: boolean; onMove: (id: string, status: CaseStatus) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section
      ref={setNodeRef}
      aria-label={`${STATUS_LABELS[status]}: ${items.length} casos`}
      className={`flex w-72 shrink-0 snap-start flex-col gap-3 rounded-xl bg-zinc-100/70 p-3 transition dark:bg-zinc-900/60 ${isOver ? "ring-2 ring-accent" : ""}`}
    >
      <h2 className="flex items-center justify-between text-sm font-semibold">
        {STATUS_LABELS[status]}
        <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-medium dark:bg-zinc-800">{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line p-4 text-center text-xs text-muted">
          {canEdit ? "Soltá un caso acá" : "Sin casos"}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((item) => (
            <CaseCard key={item.id} item={item} now={now} canEdit={canEdit} onMove={onMove} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function Board({ cases, canEdit }: { cases: BoardCase[]; canEdit: boolean }) {
  // La tarjeta se mueve al instante (actualización optimista). Si el servidor rechaza el cambio, la acción
  // termina sin revalidar los datos y la tarjeta vuelve sola a su columna.
  const [optimistic, applyMove] = useOptimistic(cases, (state, move: { id: string; status: CaseStatus }) =>
    state.map((item) => (item.id === move.id ? { ...item, status: move.status } : item)),
  );
  const [error, setError] = useState<string | null>(null);
  const [resolving, setResolving] = useState<{ id: string; title: string } | null>(null);
  const [resolution, setResolution] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const now = new Date();

  // Mouse con una pequeña distancia (para que un clic no cuente como arrastre), tacto con una pausa y teclado.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const titleOf = (id: unknown) => optimistic.find((item) => item.id === id)?.title ?? "el caso";
  const labelOf = (id: unknown) => (isStatus(id) ? STATUS_LABELS[id] : "una columna");

  const commit = (id: string, status: CaseStatus, text: string) => {
    setError(null);
    startTransition(async () => {
      applyMove({ id, status });
      const result: MoveState = await moveCaseAction(id, status, text);
      if (result.error) setError(result.error);
    });
  };

  // Soltar en "Resuelto" pregunta cómo se resolvió (opcional); el resto de las columnas mueve directo.
  const move = (id: string, status: CaseStatus) => {
    const current = optimistic.find((item) => item.id === id);
    if (!current || current.status === status) return;
    if (status === "resolved") {
      setResolving({ id, title: current.title });
      setResolution("");
      return;
    }
    commit(id, status, "");
  };

  const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id));
  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    if (event.over && isStatus(event.over.id)) move(String(event.active.id), event.over.id);
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Levantaste el caso ${titleOf(active.id)}.`,
    onDragOver: ({ over }) => (over ? `El caso está sobre la columna ${labelOf(over.id)}.` : "El caso no está sobre ninguna columna."),
    onDragEnd: ({ over }) => (over ? `Soltaste el caso en ${labelOf(over.id)}.` : "Soltaste el caso fuera de las columnas: no se movió."),
    onDragCancel: ({ active }) => `Cancelaste el movimiento del caso ${titleOf(active.id)}.`,
  };

  const activeItem = optimistic.find((item) => item.id === activeId);

  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="mx-4 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}

      {resolving ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            commit(resolving.id, "resolved", resolution);
            setResolving(null);
          }}
          className="card mx-4 flex flex-col gap-2 p-3"
        >
          <label className="flex flex-col gap-1 text-sm">
            ¿Cómo se resolvió “{resolving.title}”? (opcional)
            <textarea rows={2} maxLength={1000} value={resolution} onChange={(event) => setResolution(event.target.value)} className="field" autoFocus />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={pending}>
              Marcar como resuelto
            </button>
            <button type="button" className="btn-secondary" onClick={() => setResolving(null)}>
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      <DndContext
        sensors={sensors}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "Para mover un caso, apretá espacio o Enter en la manija, usá las flechas para elegir la columna y volvé a apretar espacio para soltarlo. Escape cancela.",
          },
        }}
      >
        <div className="flex snap-x gap-4 overflow-x-auto px-4 pb-4">
          {CASE_STATUSES.map((status) => (
            <Column key={status} status={status} items={optimistic.filter((item) => item.status === status)} now={now} canEdit={canEdit} onMove={move} />
          ))}
        </div>

        <DragOverlay>
          {activeItem ? (
            <div className="card flex w-72 cursor-grabbing flex-col gap-1.5 p-3 shadow-xl">
              <CardBody item={activeItem} now={now} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
