import Link from "next/link";

import { getCurrentProfile } from "@/lib/auth/profile";
import { CASE_LIST_LIMIT, CASE_LIST_VIEWS, listCases, type CaseListView } from "@/lib/crm/case-list";
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

function href(view: CaseListView, sector: string | undefined, resolved: boolean): string {
  const params = new URLSearchParams({ vista: view });
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
  const includeResolved = first(query.resueltos) === "1";

  const supabase = await createClient();
  const { data: sectors } = await supabase.from("sectors").select("id, name").eq("is_active", true).order("name");

  let cases: Awaited<ReturnType<typeof listCases>> = [];
  let failed = false;
  try {
    cases = await listCases({ userClient: supabase, view, userId: profile.id, sectorId, includeResolved });
  } catch {
    failed = true;
  }

  const now = new Date();

  return (
    <main className="flex flex-1 flex-col">
      <LiveRefresh organizationId={profile.organizationId} />
      <header className="flex flex-col gap-3 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <h1 className="text-xl font-semibold tracking-tight">Casos</h1>

        <nav aria-label="Vistas de casos" className="flex flex-wrap items-center gap-2">
          {CASE_LIST_VIEWS.map((candidate) => (
            <Link
              key={candidate}
              href={href(candidate, sectorId, includeResolved)}
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
          <Link href={href(view, sectorId, !includeResolved)} className="ml-auto text-sm text-zinc-600 underline dark:text-zinc-400">
            {includeResolved ? "Ocultar resueltos" : "Incluir resueltos"}
          </Link>
        </nav>

        {view === "sector" ? (
          <form method="get" action="/casos" className="flex items-center gap-2">
            <input type="hidden" name="vista" value="sector" />
            {includeResolved ? <input type="hidden" name="resueltos" value="1" /> : null}
            <select
              name="sector"
              defaultValue={sectorId ?? ""}
              aria-label="Sector"
              className="rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-zinc-700"
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
            <button type="submit" className="rounded-md bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white dark:bg-zinc-100 dark:text-zinc-900">
              Ver
            </button>
          </form>
        ) : null}
      </header>

      {failed ? (
        <p className="p-6 text-sm text-red-600 dark:text-red-400">No se pudieron cargar los casos. Probá recargar la página.</p>
      ) : view === "sector" && !sectorId ? (
        <p className="p-6 text-sm text-zinc-600 dark:text-zinc-400">Elegí un sector para ver sus casos.</p>
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
