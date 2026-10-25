import { connection } from "next/server";
import Link from "next/link";

import { Board, type BoardCase } from "@/components/kanban/board";
import { Avatar } from "@/components/ui/avatar";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
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
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <form method="get" action="/casos" className="flex items-center gap-2">
              <input type="hidden" name="vista" value={view} />
              <input type="hidden" name="modo" value={mode} />
              {view === "sector" && sectorId ? <input type="hidden" name="sector" value={sectorId} /> : null}
              {includeResolved ? <input type="hidden" name="resueltos" value="1" /> : null}
              <select name="prioridad" defaultValue={priority ?? ""} aria-label="Prioridad" className="field !w-auto !py-1.5 text-sm">
                <option value="">Todas las prioridades</option>
                {CASE_PRIORITIES.map((option) => (
                  <option key={option} value={option}>
                    {PRIORITY_LABELS[option]}
                  </option>
                ))}
              </select>
              <button type="submit" className="btn-secondary !py-1.5 text-sm">
                Filtrar
              </button>
            </form>
            {board ? null : (
              <Link href={href({ ...filters, resolved: !includeResolved })} className="text-sm text-muted underline-offset-2 hover:text-foreground hover:underline">
                {includeResolved ? "Ocultar resueltos" : "Incluir resueltos"}
              </Link>
            )}
          </div>
        </div>

        {view === "sector" ? (
          <form method="get" action="/casos" className="flex items-center gap-2">
            <input type="hidden" name="vista" value="sector" />
            <input type="hidden" name="modo" value={mode} />
            {includeResolved ? <input type="hidden" name="resueltos" value="1" /> : null}
            {priority ? <input type="hidden" name="prioridad" value={priority} /> : null}
            <select name="sector" defaultValue={sectorId ?? ""} aria-label="Sector" className="field !w-auto !py-1.5">
              <option value="" disabled>
                Elegí un sector...
              </option>
              {(sectors ?? []).map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {sector.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-primary !py-1.5">
              Ver
            </button>
          </form>
        ) : null}
      </PageHeader>

      {failed ? (
        <p role="alert" className="p-6 text-sm text-danger">
          No se pudieron cargar los casos. Probá recargar la página.
        </p>
      ) : view === "sector" && !sectorId ? (
        <EmptyState icon={<CaseIcon className="size-6" />} title="Elegí un sector" description="Vas a ver los casos abiertos de ese sector." />
      ) : board ? (
        <div className="py-4">
          <Board cases={boardCases} canEdit={profile.role !== "viewer"} />
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
                    <p className="truncate font-medium">{item.title}</p>
                    <p className="truncate text-sm text-muted">
                      {item.contacts?.display_name || "Sin nombre"} · {item.sectors?.name ?? "Sin sector"} ·{" "}
                      {item.assignee?.full_name ? `Asignado a ${item.assignee.full_name}` : "Sin asignar"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      <StatusBadge status={item.status} />
                      <PriorityBadge priority={item.priority} />
                    </div>
                  </div>
                  <time className="shrink-0 text-xs text-muted" dateTime={item.updated_at}>
                    {shortDate(item.updated_at, now)}
                  </time>
                </>
              );

              return (
                <li key={item.id}>
                  {item.conversation_id ? (
                    <Link href={`/conversaciones/${item.conversation_id}`} className="flex items-start gap-3 px-4 py-3 transition hover:bg-zinc-100 sm:px-6 dark:hover:bg-zinc-900">
                      {content}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3 sm:px-6">{content}</div>
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
