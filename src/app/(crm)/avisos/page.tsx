import Link from "next/link";
import { connection } from "next/server";

import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { AlertIcon, BellIcon, CaseIcon, TeamIcon } from "@/components/ui/icons";
import { LinkTabs } from "@/components/ui/link-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentProfile } from "@/lib/auth/profile";
import { dateTime, dayHeading, dayKeyOf, timeOnly } from "@/lib/crm/format";
import { listNotifications, noticeTarget, NOTIFICATIONS_PAGE_SIZE } from "@/lib/crm/notifications";
import { createClient } from "@/lib/supabase/server";

import { markNoticeRead, markNoticesRead } from "../avisos-actions";
import { LiveRefresh } from "../live-refresh";

export const metadata = { title: "Avisos" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Ícono y color de cada tipo de aviso: caso derivado o asignado (accent), consulta de un sector (info), límite de
// consumo (warning). Un tipo nuevo cae en la campana.
const NOTICE_KINDS: Record<string, { icon: React.ReactNode; chip: string }> = {
  case_handoff: { icon: <CaseIcon className="size-4" />, chip: "bg-accent-soft text-accent" },
  case_assigned: { icon: <CaseIcon className="size-4" />, chip: "bg-accent-soft text-accent" },
  area_query: { icon: <TeamIcon className="size-4" />, chip: "bg-info-soft text-info" },
  usage_limit: { icon: <AlertIcon className="size-4" />, chip: "bg-warning-soft text-warning" },
};
const DEFAULT_KIND = { icon: <BellIcon className="size-4" />, chip: "bg-zinc-100 text-muted dark:bg-zinc-800" };

function avisosHref(all: boolean, limit?: number): string {
  const params = new URLSearchParams();
  if (all) params.set("ver", "todos");
  if (limit) params.set("mas", String(limit));
  const text = params.toString();
  return text ? `/avisos?${text}` : "/avisos";
}

// Los avisos de la persona: casos que le asignaron, consultas de un sector, consumo, etc. Sin leer primero.
export default async function AvisosPage({ searchParams }: PageProps<"/avisos">) {
  await connection();
  const profile = await getCurrentProfile();
  const query = await searchParams;
  const all = first(query.ver) === "todos";
  const requested = Number(first(query.mas));
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, 300) : NOTIFICATIONS_PAGE_SIZE;

  const { items, hasMore, failed } = await listNotifications({ userClient: await createClient(), userId: profile.id, onlyUnread: !all, limit });
  const hasUnread = items.some((notice) => notice.read_at === null);

  // Agrupados por día (en horario de Argentina): "Hoy", "Ayer" o la fecha. Vienen del más nuevo al más viejo.
  const now = new Date();
  const groups: Array<{ key: string; heading: string; items: typeof items }> = [];
  for (const notice of items) {
    const key = dayKeyOf(notice.created_at).replace(/\D/g, "-");
    const last = groups.at(-1);
    if (last && last.key === key) last.items.push(notice);
    else groups.push({ key, heading: dayHeading(notice.created_at, now), items: [notice] });
  }

  return (
    <main className="flex flex-1 flex-col">
      <LiveRefresh organizationId={profile.organizationId} />
      <PageHeader
        title="Avisos"
        description="Lo que necesita tu atención: casos asignados, consultas a tu sector, límites de consumo."
        actions={
          // Solo si hay algo para marcar: con todo leído el botón no hace nada.
          hasUnread ? (
            <form action={markNoticesRead}>
              <button type="submit" className="btn-secondary">
                Marcar todos como leídos
              </button>
            </form>
          ) : null
        }
      >
        <LinkTabs
          label="Qué avisos mostrar"
          items={[
            { href: avisosHref(false), label: "Sin leer", active: !all },
            { href: avisosHref(true), label: "Todos", active: all },
          ]}
        />
      </PageHeader>

      {failed ? (
        <ErrorBanner>No se pudieron cargar los avisos. Probá recargar la página.</ErrorBanner>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BellIcon className="size-5" />}
          title={all ? "Todavía no tenés avisos" : "No tenés avisos sin leer"}
          description={all ? "Cuando haya algo para vos, aparece acá." : "Estás al día."}
          action={
            all ? null : (
              <Link href={avisosHref(true)} className="btn-secondary">
                Ver todos los avisos
              </Link>
            )
          }
        />
      ) : (
        <>
          {groups.map((group) => (
            <section key={group.key} aria-labelledby={`dia-${group.key}`}>
              <h2 id={`dia-${group.key}`} className="eyebrow border-b border-line px-4 pt-5 pb-2 sm:px-6">
                {group.heading}
              </h2>
              <ul className="divide-y divide-line">
                {group.items.map((notice) => {
                  const href = noticeTarget(notice);
                  const unread = notice.read_at === null;
                  const kind = NOTICE_KINDS[notice.type] ?? DEFAULT_KIND;
                  const body = (
                    <div className="min-w-0 flex-1">
                      <p className={`text-sm ${unread ? "font-semibold" : "font-medium text-muted"}`}>{notice.title}</p>
                      {notice.body ? <p className="mt-0.5 text-sm text-muted">{notice.body}</p> : null}
                    </div>
                  );
                  return (
                    <li
                      key={notice.id}
                      className={`flex items-start gap-3 border-l-2 px-4 py-3 transition hover:bg-zinc-100/80 sm:px-6 dark:hover:bg-zinc-900 ${unread ? "border-accent bg-accent-soft/30" : "border-transparent"}`}
                    >
                      {/* El tipo de aviso, de un vistazo. Decorativo: el título ya dice de qué se trata. */}
                      <span className={`grid size-9 shrink-0 place-items-center rounded-xl ${kind.chip}`} aria-hidden="true">
                        {kind.icon}
                      </span>
                      {/* Texto para el lector de pantalla: un aria-label en un span vacío no se anuncia. */}
                      {unread ? <span className="sr-only">Sin leer</span> : null}
                      {href ? (
                        <Link href={href} className="flex min-w-0 flex-1 items-start gap-3 hover:underline">
                          {body}
                        </Link>
                      ) : (
                        body
                      )}
                      <div className="flex shrink-0 flex-col items-end gap-1.5">
                        <time className="font-mono text-xs text-muted" dateTime={notice.created_at} title={dateTime(notice.created_at)}>
                          {timeOnly(notice.created_at)}
                        </time>
                        {unread ? (
                          <form action={markNoticeRead.bind(null, notice.id)}>
                            <button type="submit" className="text-xs text-accent underline-offset-2 hover:underline">
                              Marcar leído
                            </button>
                          </form>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
          {hasMore ? (
            <div className="flex justify-center p-4">
              <Link href={avisosHref(all, limit + NOTIFICATIONS_PAGE_SIZE)} scroll={false} className="btn-secondary">
                Ver más avisos
              </Link>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
