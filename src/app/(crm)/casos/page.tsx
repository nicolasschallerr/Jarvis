import Link from "next/link";

import { Board, type BoardCase } from "@/components/kanban/board";
import { getCurrentProfile } from "@/lib/auth/profile";
import { CASE_LIST_LIMIT, CASE_LIST_VIEWS, listCases, type CaseListView } from "@/lib/crm/case-list";
import type { CaseStatus } from "@/lib/crm/cases";
import { PRIORITY_LABELS, shortDate, STATUS_LABELS } from "@/lib/crm/format";
import { createClient } from "@/lib/supabase/server";

import { LiveRefresh } from "../live-refresh";

const VIEW_LABELS: Record<CaseListView, string> = {
  mine: "Mis casos",
  unassigned: "Sin asignar",
  sector: "Por sector",
  all: "Todos",
};

const PRIORITY_STYLES: Record<string, string> = {
  low: "bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  normal: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  high: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  urgent: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

type Mode = "tablero" | "lista";

// Cuántos casos resueltos recientes muestra la última columna del tablero.
const BOARD_RESOLVED_LIMIT = 15;

function href(view: CaseListView, sector: string | undefined, resolved: boolean, mode: Mode): string {
  const params = new URLSearchParams({ vista: view, modo: mode });
  if (view === "sector" && sector) params.set("sector", sector);
  if (resolved) params.set("resueltos", "1");
  return `/casos?${params.toString()}`;
}

export default async function CasosPage({ searchParams }: PageProps<"/casos">) {
  const profile = await getCurrentProfile();
  const query = await searchParams;

  const requestedView = first(query.vista);
  const view: CaseListView = CASE_LIST_VIEWS.find((candidate) => candidate === requestedView) ?? "mine";
  const sectorId = first(query.sector);
  const mode: Mode = first(query.modo) === "lista" ? "lista" : "tablero";
  const board = mode === "tablero";
  // El tablero ya trae los resueltos recientes en su última columna.
  const includeResolved = !board && first(query.resueltos) === "1";

  const supabase = await createClient();
  const { data: sectors } = await supabase.from("sectors").select("id, name").eq("is_active", true).order("name");

  let cases: Awaited<ReturnType<typeof listCases>> = [];
  let failed = false;
  try {
    cases = await listCases({ userClient: supabase, view, userId: profile.id, sectorId, includeResolved });
    if (board) {
      const resolved = await listCases({
        userClient: supabase,
        view,
        userId: profile.id,
        sectorId,
        resolvedOnly: true,
        limit: BOARD_RESOLVED_LIMIT,
      });
      cases = [...cases, ...resolved];
    }
  } catch {
    failed = true;
  }

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
      <header className="flex flex-col gap-3 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <h1 className="text-xl font-semibold tracking-tight">Casos</h1>

        <nav aria-label="Vistas de casos" className="flex flex-wrap items-center gap-2">
          {CASE_LIST_VIEWS.map((candidate) => (
            <Link
              key={candidate}
              href={href(candidate, sectorId, includeResolved, mode)}
              aria-current={candidate === view ? "page" : undefined}
              className={`rounded-md px-3 py-1.5 text-sm ${
                candidate === view
                  ? "bg-zinc-200 font-medium dark:bg-zinc-800"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-900"
              }`}
            >
              {VIEW_LABELS[candidate]}
            </Link>
          ))}
          <div className="ml-auto flex items-center gap-3">
            {board ? null : (
              <Link href={href(view, sectorId, !includeResolved, mode)} className="text-sm text-zinc-600 underline dark:text-zinc-400">
                {includeResolved ? "Ocultar resueltos" : "Incluir resueltos"}
              </Link>
            )}
            <div role="group" aria-label="Forma de ver los casos" className="flex rounded-lg border border-zinc-300 p-0.5 dark:border-zinc-700">
              {(["tablero", "lista"] as const).map((option) => (
                <Link
                  key={option}
                  href={href(view, sectorId, includeResolved, option)}
                  aria-current={option === mode ? "page" : undefined}
                  className={`rounded-md px-3 py-1 text-sm ${
                    option === mode
                      ? "bg-accent text-accent-foreground"
                      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  }`}
                >
                  {option === "tablero" ? "Tablero" : "Lista"}
                </Link>
              ))}
            </div>
          </div>
        </nav>

        {view === "sector" ? (
          <form method="get" action="/casos" className="flex items-center gap-2">
            <input type="hidden" name="vista" value="sector" />
            <input type="hidden" name="modo" value={mode} />
            {includeResolved ? <input type="hidden" name="resueltos" value="1" /> : null}
            <select
              name="sector"
              defaultValue={sectorId ?? ""}
              aria-label="Sector"
              className="field !py-1.5"
            >
              <option value="" disabled>
                Elegí un sector...
              </option>
              {(sectors ?? []).map((sector) => (
                <option key={sector.id} value={sector.id}>
                  {sector.name}
                </option>
              ))}
            </select>
            <button type="submit" className="btn-primary">
              Ver
            </button>
          </form>
        ) : null}
      </header>

      {failed ? (
        <p className="p-6 text-sm text-red-600 dark:text-red-400">No se pudieron cargar los casos. Probá recargar la página.</p>
      ) : view === "sector" && !sectorId ? (
        <p className="p-6 text-sm text-zinc-600 dark:text-zinc-400">Elegí un sector para ver sus casos.</p>
      ) : board ? (
        <div className="py-4">
          <Board cases={boardCases} canEdit={profile.role !== "viewer"} />
        </div>
      ) : cases.length === 0 ? (
        <p className="p-6 text-sm text-zinc-600 dark:text-zinc-400">No hay casos en esta vista.</p>
      ) : (
        <>
          <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
            {cases.map((item) => {
              const content = (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium">{item.title}</p>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${PRIORITY_STYLES[item.priority] ?? ""}`}>
                        {PRIORITY_LABELS[item.priority]}
                      </span>
                      <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        {STATUS_LABELS[item.status]}
                      </span>
                    </div>
                    <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">
                      {item.contacts?.display_name || "Sin nombre"} · {item.sectors?.name ?? "Sin sector"} ·{" "}
                      {item.assignee?.full_name ? `Asignado a ${item.assignee.full_name}` : "Sin asignar"}
                    </p>
                  </div>
                  <time className="shrink-0 text-xs text-zinc-600 dark:text-zinc-400" dateTime={item.updated_at}>
                    {shortDate(item.updated_at, now)}
                  </time>
                </>
              );

              return (
                <li key={item.id}>
                  {item.conversation_id ? (
                    <Link href={`/conversaciones/${item.conversation_id}`} className="flex items-start gap-4 px-6 py-4 hover:bg-zinc-100 dark:hover:bg-zinc-900">
                      {content}
                    </Link>
                  ) : (
                    <div className="flex items-start gap-4 px-6 py-4">{content}</div>
                  )}
                </li>
              );
            })}
          </ul>
          {cases.length >= CASE_LIST_LIMIT ? (
            <p className="px-6 py-3 text-xs text-zinc-600 dark:text-zinc-400">Se muestran los primeros {CASE_LIST_LIMIT} casos.</p>
          ) : null}
        </>
      )}
    </main>
  );
}
