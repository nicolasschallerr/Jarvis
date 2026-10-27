import { connection } from "next/server";
import Link from "next/link";

import { Board, type BoardCase } from "@/components/kanban/board";
import { Avatar } from "@/components/ui/avatar";
import { PriorityBadge, PRIORITY_DOTS, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { AutoSubmitSelect, FilterChips } from "@/components/ui/filter-chips";
import { CaseIcon } from "@/components/ui/icons";
import { LinkTabs, SegmentedLinks } from "@/components/ui/link-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentProfile } from "@/lib/auth/profile";
import {
  CASE_LIST_LIMIT,
  CASE_LIST_VIEWS,
  CASE_PRIORITIES,
  defaultCaseView,
  listCases,
  type CaseListView,
  type CasePriorityFilter,
} from "@/lib/crm/case-list";
import type { CaseStatus } from "@/lib/crm/cases";
import { PRIORITY_LABELS, shortDate } from "@/lib/crm/format";
import { canExport } from "@/lib/export/datasets";
import { createClient } from "@/lib/supabase/server";

import { LiveRefresh } from "../live-refresh";

export const metadata = { title: "Casos" };

const VIEW_LABELS: Record<CaseListView, string> = {
  mine: "Mis casos",
  unassigned: "Sin asignar",
  sector: "Por sector",
  all: "Todos",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type Mode = "tablero" | "lista";

// Hasta cuántos sectores se muestran como píldoras; con más, ocuparían varias filas y conviene un selector.
const SECTOR_CHIPS_MAX = 6;

// Cuántos casos resueltos recientes muestra la última columna del tablero.
const BOARD_RESOLVED_LIMIT = 15;

type Filters = { view: CaseListView; sector?: string; resolved: boolean; mode: Mode; priority: CasePriorityFilter | null };

function href(filters: Filters): string {
  const params = new URLSearchParams({ vista: filters.view, modo: filters.mode });
  if (filters.view === "sector" && filters.sector) params.set("sector", filters.sector);
  if (filters.resolved) params.set("resueltos", "1");
  if (filters.priority) params.set("prioridad", filters.priority);
  return `/casos?${params.toString()}`;
}

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

export default async function CasosPage({ searchParams }: PageProps<"/casos">) {
  // Página por pedido: lee la sesión y la hora actual (ver la nota de `instant` en el layout del CRM).
  await connection();
  const profile = await getCurrentProfile();
  const query = await searchParams;

  const requestedView = first(query.vista);
  const view: CaseListView = CASE_LIST_VIEWS.find((candidate) => candidate === requestedView) ?? defaultCaseView(profile.role);
  const sectorId = first(query.sector);
  const mode: Mode = first(query.modo) === "lista" ? "lista" : "tablero";
  const board = mode === "tablero";
  const requestedPriority = first(query.prioridad);
  const priority = CASE_PRIORITIES.find((candidate) => candidate === requestedPriority) ?? null;
  // El tablero ya trae los resueltos recientes en su última columna.
  const includeResolved = !board && first(query.resueltos) === "1";
  const filters: Filters = { view, sector: sectorId, resolved: includeResolved, mode, priority };

  const supabase = await createClient();

  // Las listas de casos y los sectores (que solo se usan en la vista "Por sector") se piden a la vez: cada consulta es
  // un viaje a la base y en fila sumaban la demora de las tres.
  let cases: Awaited<ReturnType<typeof listCases>> = [];
  let failed = false;
  const [sectorsResult, casesResult] = await Promise.all([
    view === "sector" ? supabase.from("sectors").select("id, name").eq("is_active", true).order("name") : Promise.resolve({ data: [] }),
    Promise.all([
      listCases({ userClient: supabase, view, userId: profile.id, sectorId, includeResolved, priority }),
      // El tablero muestra además los últimos resueltos en su última columna.
      board
        ? listCases({ userClient: supabase, view, userId: profile.id, sectorId, resolvedOnly: true, priority, limit: BOARD_RESOLVED_LIMIT })
        : Promise.resolve([]),
    ]).catch(() => null),
  ]);
  const sectors = sectorsResult.data;
  if (casesResult) cases = [...casesResult[0], ...casesResult[1]];
  else failed = true;

  const now = new Date();
  const sectorList = sectors ?? [];

  const boardCases: BoardCase[] = cases.map((item) => ({
    id: item.id,
    title: item.title ?? "Caso sin título",
    status: item.status as CaseStatus,
    priority: item.priority,
    sectorName: item.sectors?.name ?? null,
    assigneeName: item.assignee?.full_name ?? null,
    contactName: item.contacts?.display_name ?? null,
    conversationId: item.conversation_id,
    updatedAt: item.updated_at,
  }));

  return (
    <main className="flex flex-1 flex-col">
      <LiveRefresh organizationId={profile.organizationId} />
      <PageHeader
        title="Casos"
        description="Cada gestión que abre el agente o el equipo, con su estado, sector y responsable."
        actions={
          <>
            {canExport(profile.role, "casos") ? (
              <a href="/exportar/casos" className="btn-secondary" download>
                Exportar CSV
              </a>
            ) : null}
            <SegmentedLinks
            label="Forma de ver los casos"
            items={(["tablero", "lista"] as const).map((option) => ({
              href: href({ ...filters, mode: option }),
              label: option === "tablero" ? "Tablero" : "Lista",
              active: option === mode,
            }))}
          />
          </>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <LinkTabs
            label="Vistas de casos"
            items={CASE_LIST_VIEWS.map((candidate) => ({
              href: href({ ...filters, view: candidate }),
              label: VIEW_LABELS[candidate],
              active: candidate === view,
            }))}
          />
        </div>

        {/* Todos los filtros en una sola fila de píldoras. Son enlaces que arman la misma URL que antes (`prioridad`,
            `resueltos`, `sector`), así los enlaces guardados siguen andando. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <FilterChips
            label="Prioridad"
            items={[
              { href: href({ ...filters, priority: null }), label: "Todas", active: priority === null },
              ...CASE_PRIORITIES.map((option) => ({
                href: href({ ...filters, priority: option }),
                label: PRIORITY_LABELS[option] ?? option,
                active: option === priority,
                dot: PRIORITY_DOTS[option],
              })),
            ]}
          />
          {/* El tablero ya trae los resueltos recientes en su última columna: el interruptor solo tiene sentido en la lista. */}
          {board ? null : (
            <FilterChips
              label="Casos resueltos"
              items={[{ href: href({ ...filters, resolved: !includeResolved }), label: "Incluir resueltos", active: includeResolved, dot: "bg-success" }]}
            />
          )}
          {view === "sector" ? (
            sectorList.length > SECTOR_CHIPS_MAX ? (
              <AutoSubmitSelect
                action="/casos"
                label="Sector"
                name="sector"
                value={sectorId ?? ""}
                placeholder="Elegí un sector..."
                options={sectorList.map((sector) => ({ value: sector.id, label: sector.name }))}
                hidden={{ vista: "sector", modo: mode, ...(includeResolved ? { resueltos: "1" } : {}), ...(priority ? { prioridad: priority } : {}) }}
              />
            ) : (
              <FilterChips
                label="Sector"
                items={sectorList.map((sector) => ({ href: href({ ...filters, sector: sector.id }), label: sector.name, active: sector.id === sectorId }))}
              />
            )
          ) : null}
        </div>
      </PageHeader>

      {failed ? (
        <ErrorBanner>No se pudieron cargar los casos. Probá recargar la página.</ErrorBanner>
      ) : view === "sector" && !sectorId ? (
        <EmptyState icon={<CaseIcon className="size-6" />} title="Elegí un sector" description="Vas a ver los casos abiertos de ese sector." />
      ) : board && boardCases.length === 0 ? (
        // Sin ningún caso, cinco columnas vacías no dicen nada: mejor explicar por qué está vacío.
        <EmptyState
          icon={<CaseIcon className="size-6" />}
          title="No hay casos en esta vista"
          description={view === "mine" ? "Cuando te asignen un caso, aparece acá." : "Probá con otra vista o quitá los filtros."}
        />
      ) : board ? (
        <div className="py-4">
          <Board cases={boardCases} canEdit={profile.role !== "viewer"} now={now.toISOString()} />
        </div>
      ) : cases.length === 0 ? (
        <EmptyState
          icon={<CaseIcon className="size-6" />}
          title="No hay casos en esta vista"
          description={view === "mine" ? "Cuando te asignen un caso, aparece acá." : "Probá con otra vista o quitá los filtros."}
        />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {cases.map((item) => {
              const content = (
                <>
                  <Avatar name={item.contacts?.display_name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{item.title ?? "Caso sin título"}</p>
                    <p className="truncate text-sm text-muted">
                      {item.contacts?.display_name || "Sin nombre"} · {item.sectors?.name ?? "Sin sector"} ·{" "}
                      {item.assignee?.full_name ? `Asignado a ${item.assignee.full_name}` : "Sin asignar"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={item.status} />
                      <PriorityBadge priority={item.priority} />
                    </div>
                  </div>
                  <time className="shrink-0 font-mono text-[11px] text-muted" dateTime={item.updated_at}>
                    {shortDate(item.updated_at, now)}
                  </time>
                </>
              );

              return (
                <li key={item.id}>
                  {item.conversation_id ? (
                    <Link href={`/conversaciones/${item.conversation_id}`} className="flex items-start gap-3 px-4 py-3 transition hover:bg-zinc-100/80 sm:px-6 dark:hover:bg-zinc-900">
                      {content}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3 transition hover:bg-zinc-100/80 sm:px-6 dark:hover:bg-zinc-900">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {cases.length >= CASE_LIST_LIMIT ? <p className="px-6 py-3 text-xs text-muted">Se muestran los primeros {CASE_LIST_LIMIT} casos.</p> : null}
        </>
      )}
    </main>
  );
}
