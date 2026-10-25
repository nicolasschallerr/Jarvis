import Link from "next/link";
import { connection } from "next/server";

import { Avatar } from "@/components/ui/avatar";
import { Badge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ChatIcon, PauseIcon, SearchIcon } from "@/components/ui/icons";
import { LinkTabs, SegmentedLinks } from "@/components/ui/link-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentProfile } from "@/lib/auth/profile";
import { channelLabel, messagePreview, shortDate, waitingTime } from "@/lib/crm/format";
import { getAgentNames } from "@/lib/crm/agent-names";
import { inboxQueryFrom, lastSenderPrefix, listInbox, type InboxFilter, type InboxQuery } from "@/lib/crm/inbox";
import { createClient } from "@/lib/supabase/server";

import { LiveRefresh } from "../live-refresh";

export const metadata = { title: "Conversaciones" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

const TAB_LABELS: Record<InboxFilter, string> = {
  todas: "Todas",
  esperando: "Esperando respuesta",
  mias: "Mías",
  "sin-asignar": "Sin asignar",
  "ia-pausada": "IA en pausa",
};

// Arma la URL de la bandeja conservando los demás parámetros.
function inboxHref(query: InboxQuery, changes: Partial<{ filtro: string; canal: string | null; q: string; ver: number }>): string {
  const params = new URLSearchParams();
  const filtro = changes.filtro ?? query.filter;
  const canal = changes.canal === undefined ? query.channel : changes.canal;
  const q = changes.q ?? query.search;
  if (filtro !== "todas") params.set("filtro", filtro);
  if (canal) params.set("canal", canal);
  if (q) params.set("q", q);
  if (changes.ver) params.set("ver", String(changes.ver));
  const text = params.toString();
  return text ? `/conversaciones?${text}` : "/conversaciones";
}

export default async function ConversacionesPage({ searchParams }: PageProps<"/conversaciones">) {
  // Página por pedido: lee la sesión y la hora actual (ver la nota de `instant` en el layout del CRM).
  await connection();
  const profile = await getCurrentProfile();
  const query = inboxQueryFrom(await searchParams);

  const [{ items, hasMore, counts, failed }, agentNames] = await Promise.all([
    listInbox({ userClient: await createClient(), userId: profile.id, query }),
    getAgentNames(),
  ]);
  const agentName = agentNames.attention;
  const now = new Date();
  const filtered = query.filter !== "todas" || query.channel !== null || query.search !== "";

  return (
    <main className="flex flex-1 flex-col">
      <LiveRefresh organizationId={profile.organizationId} />
      <PageHeader
        title="Conversaciones"
        description="Todo lo que escriben los asociados, en todos los canales."
        actions={
          <form action="/conversaciones" className="relative w-full sm:w-72" role="search">
            {query.filter !== "todas" ? <input type="hidden" name="filtro" value={query.filter} /> : null}
            {query.channel ? <input type="hidden" name="canal" value={query.channel} /> : null}
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              name="q"
              defaultValue={query.search}
              placeholder="Buscar por nombre o documento"
              aria-label="Buscar conversaciones por nombre o documento"
              className="field w-full !pl-9"
            />
          </form>
        }
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <LinkTabs
            label="Filtros de la bandeja"
            items={(Object.keys(TAB_LABELS) as InboxFilter[]).map((filter) => ({
              href: inboxHref(query, { filtro: filter }),
              label: TAB_LABELS[filter],
              active: query.filter === filter,
              count: counts[filter],
            }))}
          />
          <SegmentedLinks
            label="Canal"
            items={[
              { href: inboxHref(query, { canal: null }), label: "Todos", active: query.channel === null },
              { href: inboxHref(query, { canal: "whatsapp" }), label: "WhatsApp", active: query.channel === "whatsapp" },
              { href: inboxHref(query, { canal: "telegram" }), label: "Telegram", active: query.channel === "telegram" },
            ]}
          />
        </div>
      </PageHeader>

      {failed ? (
        <p role="alert" className="m-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger sm:m-6">
          No se pudieron cargar las conversaciones. Probá recargar la página.
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ChatIcon className="size-5" />}
          title={filtered ? "No hay conversaciones con estos filtros" : "Todavía no hay conversaciones"}
          description={filtered ? "Probá con otro filtro o buscá otro nombre." : "Cuando un asociado escriba por WhatsApp o Telegram, su conversación va a aparecer acá."}
          action={
            filtered ? (
              <Link href="/conversaciones" className="btn-secondary">
                Ver todas
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {items.map((conversation) => {
              const waiting = conversation.last_direction === "inbound";
              const wait = waiting ? waitingTime(conversation.last_message_at, now) : null;
              return (
                <li key={conversation.id}>
                  <Link
                    href={`/conversaciones/${conversation.id}`}
                    className="flex items-start gap-3 px-4 py-3.5 transition hover:bg-zinc-100/80 sm:px-6 dark:hover:bg-zinc-900"
                  >
                    <Avatar name={conversation.contact_name} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className={`truncate ${waiting ? "font-semibold" : "font-medium"}`}>{conversation.contact_name || "Sin nombre"}</p>
                        <span className="shrink-0 text-xs text-muted">{channelLabel(conversation.channel_type ?? "")}</span>
                      </div>
                      <p className={`truncate text-sm ${waiting ? "text-foreground" : "text-muted"}`}>
                        {lastSenderPrefix(conversation.last_sender, conversation.last_direction, agentName)}
                        {messagePreview(conversation.last_body, conversation.last_type)}
                      </p>
                      {conversation.case_status || !conversation.ai_enabled ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                          {conversation.case_status ? <StatusBadge status={conversation.case_status} /> : null}
                          {conversation.case_priority === "high" || conversation.case_priority === "urgent" ? (
                            <PriorityBadge priority={conversation.case_priority} />
                          ) : null}
                          {conversation.case_status && conversation.case_assigned_to === profile.id ? <Badge tone="accent">Asignado a vos</Badge> : null}
                          {!conversation.ai_enabled ? (
                            <Badge tone="warning" title={`Una persona del equipo tomó el chat: ${agentName} no responde`}>
                              <PauseIcon className="size-3" />
                              IA en pausa
                            </Badge>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <time className={`text-xs ${waiting ? "font-semibold text-accent" : "text-muted"}`} dateTime={conversation.last_message_at ?? undefined}>
                        {shortDate(conversation.last_message_at, now)}
                      </time>
                      {wait ? (
                        <Badge tone={wait.level === "critical" ? "danger" : wait.level === "late" ? "warning" : "accent"} title="Tiempo esperando respuesta">
                          <span className="sr-only">Esperando respuesta hace </span>
                          {wait.label}
                        </Badge>
                      ) : null}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
          {hasMore ? (
            <div className="flex justify-center p-4">
              <Link href={inboxHref(query, { ver: query.limit + 50 })} className="btn-secondary" scroll={false}>
                Ver más conversaciones
              </Link>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
