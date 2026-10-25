import Link from "next/link";
import { connection } from "next/server";

import { EmptyState } from "@/components/ui/empty-state";
import { BellIcon } from "@/components/ui/icons";
import { LinkTabs } from "@/components/ui/link-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentProfile } from "@/lib/auth/profile";
import { dateTime } from "@/lib/crm/format";
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

  return (
    <main className="flex flex-1 flex-col">
      <LiveRefresh organizationId={profile.organizationId} />
      <PageHeader
        title="Avisos"
        description="Lo que necesita tu atención: casos asignados, consultas a tu sector, límites de consumo."
        actions={
          <form action={markNoticesRead}>
            <button type="submit" className="btn-secondary">
              Marcar todos como leídos
            </button>
          </form>
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
        <p role="alert" className="p-6 text-sm text-danger">
          No se pudieron cargar los avisos. Probá recargar la página.
        </p>
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
          <ul className="divide-y divide-line">
            {items.map((notice) => {
              const href = noticeTarget(notice);
              const unread = notice.read_at === null;
              const body = (
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${unread ? "font-semibold" : "font-medium text-muted"}`}>{notice.title}</p>
                  {notice.body ? <p className="mt-0.5 text-sm text-muted">{notice.body}</p> : null}
                </div>
              );
              return (
                <li key={notice.id} className="flex items-start gap-3 px-4 py-3 sm:px-6">
                  <span className={`mt-1.5 size-2 shrink-0 rounded-full ${unread ? "bg-accent" : "bg-transparent"}`} aria-label={unread ? "Sin leer" : undefined} />
                  {href ? (
                    <Link href={href} className="flex min-w-0 flex-1 items-start gap-3 hover:underline">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <time className="text-xs text-muted" dateTime={notice.created_at}>
                      {dateTime(notice.created_at)}
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
