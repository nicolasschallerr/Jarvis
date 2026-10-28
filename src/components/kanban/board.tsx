"use client";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";

import { moveCaseAction, type MoveState } from "@/app/(crm)/casos/actions";
import { CASE_STATUSES, type CaseStatus } from "@/lib/crm/cases";
import { Avatar } from "@/components/ui/avatar";
import { Badge, PriorityBadge, PRIORITY_STRIPES, STATUS_ACCENTS, STATUS_TONES } from "@/components/ui/badge";
import { ErrorBanner } from "@/components/ui/error-banner";
import { InboxIcon } from "@/components/ui/icons";
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

// Destinos de la bandeja del celular: "bandeja:<estado>". Al soltar se traducen al estado.
const TRAY = "bandeja:";
const statusOf = (id: unknown): CaseStatus | null => {
  const value = typeof id === "string" && id.startsWith(TRAY) ? id.slice(TRAY.length) : id;
  return isStatus(value) ? value : null;
};

// Con el dedo cuenta dónde está el dedo (no el borde de la tarjeta que se arrastra): así soltar en la bandeja o en una
// columna angosta es preciso. Si el dedo no está sobre nada, se usa la superposición de la tarjeta.
const collisions: CollisionDetection = (args) => {
  const byPointer = pointerWithin(args);
  return byPointer.length > 0 ? byPointer : rectIntersection(args);
};

// Solo las prioridades alta y urgente llevan placa: la normal y la baja son el caso común y su placa era ruido.
const showsPriority = (priority: string) => priority === "urgent" || priority === "high";

// Clases compartidas por la tarjeta y su copia flotante mientras se arrastra (así se ven iguales).
const cardClass = (item: BoardCase) => `card spotlight flex flex-col gap-1.5 p-3 ${PRIORITY_STRIPES[item.priority] ?? ""}`;

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
        {showsPriority(item.priority) ? (
          <span className="shrink-0">
            <PriorityBadge priority={item.priority} />
          </span>
        ) : null}
      </div>
      <p className="truncate text-xs text-muted">
        {item.contactName || "Sin nombre"} · {item.sectorName ?? "Sin sector"}
      </p>
      <div className="mt-1 flex items-center gap-2 text-xs text-muted">
        {item.assigneeName ? (
          <>
            <Avatar name={item.assigneeName} size="sm" />
            <span className="min-w-0 truncate">
              <span className="sr-only">Asignado a </span>
              {item.assigneeName}
            </span>
          </>
        ) : (
          <>
            {/* Círculo punteado: se lee "falta alguien" de un vistazo, sin inventar iniciales. */}
            <span className="size-7 shrink-0 rounded-full border border-dashed border-zinc-400 dark:border-zinc-600" aria-hidden="true" />
            <span className="min-w-0 truncate">Sin asignar</span>
          </>
        )}
        <time dateTime={item.updatedAt} className="ml-auto shrink-0 font-mono text-[11px]">
          {shortDate(item.updatedAt, now)}
        </time>
      </div>
    </>
  );
}

function CaseCard({ item, now, canEdit, onMove }: { item: BoardCase; now: Date; canEdit: boolean; onMove: (id: string, status: CaseStatus) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: item.id, disabled: !canEdit });

  return (
    <li
      ref={setNodeRef}
      {...(canEdit ? listeners : {})}
      // touch-action manipulation: el dedo sigue desplazando el tablero; el arrastre empieza solo después de mantenerlo.
      // Sin "callout": en el iPhone mantener apretado un enlace abría la vista previa en vez de levantar la tarjeta.
      style={{ touchAction: "manipulation", WebkitTouchCallout: "none" }}
      className={`group ${cardClass(item)} select-none transition ${canEdit ? "cursor-grab active:cursor-grabbing" : ""} ${isDragging ? "scale-[0.98] opacity-40" : "hover:-translate-y-0.5 hover:shadow-md"}`}
    >
      <CardBody item={item} now={now} />

      {canEdit ? (
        // Los controles se esconden hasta pasar el mouse o enfocar algo de la tarjeta, así el tablero se lee limpio.
        // Es opacidad y no `hidden`: el teclado los sigue alcanzando con Tab. En pantallas táctiles (sin hover)
        // quedan siempre visibles porque no hay forma de "pasar por encima".
        <div className="mt-1 flex items-center gap-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
          {/* La tarjeta entera se agarra con el mouse (después de mover 6 px, así un clic en el enlace sigue siendo
              clic) o con el dedo (manteniendo apretado un momento, así el desplazamiento de las columnas no se pisa).
              La manija es el punto de entrada del teclado (espacio y flechas): dnd-kit solo acepta el teclado
              desde el activador. */}
          <button
            type="button"
            ref={setActivatorNodeRef}
            {...attributes}
            aria-label={`Mover el caso ${item.title}`}
            className="btn-secondary cursor-grab !px-2 !py-1 text-xs active:cursor-grabbing"
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
  const accent = STATUS_ACCENTS[status];

  return (
    <section
      ref={setNodeRef}
      aria-label={`${STATUS_LABELS[status]}: ${items.length} casos`}
      id={`columna-${status}`}
      // En el celular cada columna ocupa casi todo el ancho y asoma la siguiente; desde sm vuelven a 18 rem.
      className={`flex w-[84vw] max-w-80 shrink-0 snap-center flex-col gap-3 rounded-xl border-t-2 p-3 transition sm:w-72 sm:snap-start ${accent?.border ?? "border-t-line"} ${
        isOver ? "bg-accent-soft/40 ring-2 ring-accent" : "bg-zinc-100/70 dark:bg-zinc-900/60"
      }`}
    >
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <span className={`size-2 shrink-0 rounded-full ${accent?.dot ?? "bg-zinc-400"}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{STATUS_LABELS[status]}</span>
        <Badge tone={STATUS_TONES[status] ?? "neutral"}>{items.length}</Badge>
      </h2>
      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-line px-4 py-6 text-center text-xs text-muted">
          <InboxIcon className="size-5 opacity-60" />
          <p>{canEdit ? "Soltá un caso acá" : "Sin casos"}</p>
        </div>
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

// Un destino de la bandeja que aparece abajo en el celular mientras se arrastra un caso.
function TrayTarget({ status, count }: { status: CaseStatus; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: `${TRAY}${status}` });
  const accent = STATUS_ACCENTS[status];
  return (
    <li
      ref={setNodeRef}
      className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl border px-1 py-2 text-center transition duration-150 ${
        isOver ? "scale-105 border-accent bg-accent-soft shadow-md" : "border-line bg-surface"
      }`}
    >
      <span className={`size-2 rounded-full ${accent?.dot ?? "bg-zinc-400"}`} aria-hidden="true" />
      <span className="w-full truncate text-[11px] font-medium leading-tight">{STATUS_LABELS[status]}</span>
      <span className="text-[10px] text-muted tabular-nums">{count}</span>
    </li>
  );
}

// `now` llega del servidor como texto ISO: si el cliente calculara su propia hora, las fechas relativas ("hace 5 min")
// podrían no coincidir con el HTML del servidor y React avisaría un desajuste de hidratación.
export function Board({ cases, canEdit, now: nowIso }: { cases: BoardCase[]; canEdit: boolean; now: string }) {
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
  const now = new Date(nowIso);

  // Mouse y dedo por separado. El sensor de "puntero" también escuchaba al dedo y arrancaba un arrastre a los 6 px, así
  // que en el celular desplazar el tablero levantaba tarjetas sin querer. Ahora: mouse después de moverse 6 px (un clic
  // sigue siendo clic); dedo después de mantenerlo apretado un momento sin moverse (deslizar sigue desplazando).
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const titleOf = (id: unknown) => optimistic.find((item) => item.id === id)?.title ?? "el caso";
  const labelOf = (id: unknown) => {
    const status = statusOf(id);
    return status ? STATUS_LABELS[status] : "una columna";
  };

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

  const onDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    // Con el dedo, una vibración corta confirma que la tarjeta se levantó (si el teléfono lo permite).
    if (event.activatorEvent.type.startsWith("touch")) navigator.vibrate?.(12);
  };
  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const status = event.over ? statusOf(event.over.id) : null;
    if (status) move(String(event.active.id), status);
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
        <ErrorBanner>{error}</ErrorBanner>
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

      {/* Celular: saltar a una columna sin tener que deslizar el tablero entero. */}
      <nav aria-label="Columnas del tablero" className="flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:hidden">
        {CASE_STATUSES.map((status) => (
          <button
            key={status}
            type="button"
            onClick={() => document.getElementById(`columna-${status}`)?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" })}
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-medium"
          >
            <span className={`size-2 rounded-full ${STATUS_ACCENTS[status]?.dot ?? "bg-zinc-400"}`} aria-hidden="true" />
            {STATUS_LABELS[status]}
            <span className="text-muted tabular-nums">{optimistic.filter((item) => item.status === status).length}</span>
          </button>
        ))}
      </nav>

      <DndContext
        sensors={sensors}
        collisionDetection={collisions}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={() => setActiveId(null)}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              "Para mover un caso con el teclado, apretá espacio o Enter en la manija, usá las flechas para elegir la columna y volvé a apretar espacio para soltarlo. Escape cancela.",
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
            <div className={`${cardClass(activeItem)} w-64 rotate-2 cursor-grabbing shadow-2xl ring-2 ring-accent/40 sm:w-72`}>
              <CardBody item={activeItem} now={now} />
            </div>
          ) : null}
        </DragOverlay>

        {/* Celular: mientras se arrastra, una bandeja fija abajo con los cinco estados para soltar ahí. */}
        {activeItem ? (
          <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgb(0_0_0/0.08)] backdrop-blur sm:hidden">
            <p className="mb-2 text-center text-xs text-muted">Soltalo en el estado nuevo</p>
            <ul className="flex gap-1.5">
              {CASE_STATUSES.map((status) => (
                <TrayTarget key={status} status={status} count={optimistic.filter((item) => item.status === status).length} />
              ))}
            </ul>
          </div>
        ) : null}
      </DndContext>
    </div>
  );
}
