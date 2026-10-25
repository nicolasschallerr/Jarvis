import { connection } from "next/server";
import Link from "next/link";

import { AgentCard, type AgentView } from "@/components/agents/agent-card";
import { getCurrentProfile } from "@/lib/auth/profile";
import { Avatar } from "@/components/ui/avatar";
import { AlertIcon, CaseIcon, ChatIcon, InboxIcon } from "@/components/ui/icons";
import { LogoMark } from "@/components/ui/logo";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { capitalizeFirst, channelLabel, messagePreview, shortDate } from "@/lib/crm/format";
import { WelcomeGate } from "@/components/welcome/welcome-gate";
import { greetingFor, longDate } from "@/lib/crm/greeting";
import { getHomeSummary } from "@/lib/crm/home";
import { getUnreadNotifications } from "@/lib/crm/notifications";
import { dayKey, welcomeLine } from "@/lib/crm/welcome";
import { createClient } from "@/lib/supabase/server";

import { markNoticesRead } from "../avisos-actions";
import { LiveRefresh } from "../live-refresh";

type Tile = { label: string; value: number; href: string; hint: string; icon: React.ReactNode; alert?: boolean };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

export default async function InicioPage({ searchParams }: PageProps<"/inicio">) {
  // Página por pedido: lee la sesión y la hora actual (ver la nota de `instant` en el layout del CRM).
  await connection();
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const [summary, notices] = await Promise.all([
    getHomeSummary({ userClient: supabase, userId: profile.id }),
    getUnreadNotifications({ userClient: supabase, userId: profile.id }),
  ]);

  const query = await searchParams;
  const playWelcome = query.bienvenida === "1";

  const now = new Date();
  const firstName = profile.fullName.trim().split(/\s+/)[0] ?? "";

  const agents: AgentView[] = summary.agents.map((agent) => ({
    kind: agent.kind === "analytic" ? "analytic" : "attention",
    name: agent.name,
    tagline: agent.tagline,
    status: agent.status as AgentView["status"],
    isEnabled: agent.is_enabled,
  }));

  const tiles: Tile[] = [
    { label: "Esperando respuesta", value: summary.counts.awaitingReply, href: "/conversaciones?filtro=esperando", hint: "conversaciones", icon: <ChatIcon /> },
    { label: "Mis casos abiertos", value: summary.counts.myOpenCases, href: "/casos?vista=mine", hint: "asignados a vos", icon: <CaseIcon /> },
    { label: "Casos sin asignar", value: summary.counts.unassignedCases, href: "/casos?vista=unassigned", hint: "nadie los tomó", icon: <InboxIcon /> },
    {
      label: "Casos urgentes",
      value: summary.counts.urgentCases,
      href: "/casos?vista=all&prioridad=urgent",
      hint: "abiertos",
      icon: <AlertIcon />,
      alert: summary.counts.urgentCases > 0,
    },
  ];

  return (
    <main className="flex flex-1 flex-col gap-8 p-4 sm:p-6">
      <WelcomeGate
        play={playWelcome}
        todayKey={dayKey(now)}
        greeting={greetingFor(now)}
        firstName={firstName}
        agents={agents.map((agent) => ({
          kind: agent.kind,
          name: agent.name,
          status: agent.status,
          line: welcomeLine(agent.kind, summary.counts),
        }))}
      />
      <LiveRefresh organizationId={profile.organizationId} agents />

      <header className="rise-in relative flex flex-col gap-1 overflow-hidden rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <div
          className="pointer-events-none absolute -top-24 -right-16 size-72 rounded-full blur-3xl"
          style={{ background: "radial-gradient(closest-side, var(--glow), transparent)" }}
          aria-hidden="true"
        />
        <LogoMark animated className="pointer-events-none absolute -right-6 -bottom-10 size-44 opacity-15" title="" />
        <p className="eyebrow relative">{capitalizeFirst(longDate(now))} · {profile.organizationName}</p>
        <h1 className="relative text-3xl font-bold tracking-tight sm:text-4xl">
          {greetingFor(now)}, {firstName}
        </h1>
        <p className="relative text-sm text-muted">
          {summary.counts.awaitingReply === 0
            ? "No hay conversaciones esperando respuesta. Todo al día."
            : `${summary.counts.awaitingReply === 1 ? "Hay 1 conversación" : `Hay ${summary.counts.awaitingReply} conversaciones`} esperando respuesta.`}
        </p>
      </header>

      {summary.failed ? (
        <p role="alert" className="text-sm text-danger">
          Algunos datos no se pudieron cargar. Probá recargar la página.
        </p>
      ) : null}

      {notices.unread > 0 ? (
        <section aria-labelledby="avisos" className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h2 id="avisos" className="eyebrow">
              Avisos ({notices.unread})
            </h2>
            <form action={markNoticesRead}>
              <button type="submit" className="btn-secondary !px-2 !py-1 text-xs">
                Marcar como leídos
              </button>
            </form>
          </div>
          <ul className="card divide-y divide-line">
            {notices.items.map((notice) => {
              const body = (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{notice.title}</p>
                  <p className="truncate text-sm text-muted">{notice.body}</p>
                </div>
              );
              const conversationId = notice.cases?.conversation_id;
              return (
                <li key={notice.id}>
                  {conversationId ? (
                    <Link href={`/conversaciones/${conversationId}`} className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-100 dark:hover:bg-zinc-800/60">
                      {body}
                      <time className="shrink-0 text-xs text-muted" dateTime={notice.created_at}>
                        {shortDate(notice.created_at, now)}
                      </time>
                    </Link>
                  ) : (
                    <div className="flex items-start gap-3 px-4 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="agentes" className="flex flex-col gap-3">
        <h2 id="agentes" className="eyebrow">
          Tu equipo de agentes
        </h2>
        {agents.length === 0 ? (
          <p className="card p-4 text-sm text-muted">
            Todavía no hay agentes configurados. Se cargan con la sección <code>agentes</code> del archivo de configuración del cliente.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {agents.map((agent, index) => (
              <AgentCard key={agent.kind} agent={agent} blinkDelay={index * 1.7} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="resumen" className="flex flex-col gap-3">
        <h2 id="resumen" className="eyebrow">
          Cómo está todo
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((tile) => (
            <Link
              key={tile.label}
              href={tile.href}
              className="card group flex flex-col gap-1 p-4 transition duration-200 hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md"
            >
              <span className="flex items-center justify-between">
                <span className={`font-mono text-3xl font-semibold ${tile.alert ? "text-danger" : ""}`}>{tile.value}</span>
                <span
                  className={`grid size-8 place-items-center rounded-lg transition group-hover:scale-110 ${tile.alert ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"}`}
                  aria-hidden="true"
                >
                  {tile.icon}
                </span>
              </span>
              <span className="text-sm font-medium">{tile.label}</span>
              <span className="text-xs text-muted">{tile.hint}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="esperando" className="flex flex-col gap-3">
          <h2 id="esperando" className="eyebrow">
            Esperando respuesta
          </h2>
          {summary.awaitingList.length === 0 ? (
            <p className="card p-4 text-sm text-muted">No hay conversaciones esperando respuesta.</p>
          ) : (
            <ul className="card divide-y divide-line">
              {summary.awaitingList.map((item) => (
                <li key={item.id}>
                  <Link href={`/conversaciones/${item.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-100 dark:hover:bg-zinc-800/60">
                    <Avatar name={item.contact_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.contact_name || "Sin nombre"}{" "}
                        <span className="font-normal text-muted">· {channelLabel(item.channel_type ?? "")}</span>
                      </p>
                      <p className="truncate text-sm text-muted">{messagePreview(item.last_body, item.last_type)}</p>
                    </div>
                    <time className="shrink-0 text-xs text-muted" dateTime={item.last_message_at ?? undefined}>
                      {shortDate(item.last_message_at, now)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="mios" className="flex flex-col gap-3">
          <h2 id="mios" className="eyebrow">
            Mis casos
          </h2>
          {summary.myCases.length === 0 ? (
            <p className="card p-4 text-sm text-muted">No tenés casos abiertos asignados.</p>
          ) : (
            <ul className="card divide-y divide-line">
              {summary.myCases.map((item) => {
                const body = (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="truncate text-sm text-muted">{item.contacts?.display_name || "Sin nombre"}</p>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        <StatusBadge status={item.status} />
                        {item.priority === "high" || item.priority === "urgent" ? <PriorityBadge priority={item.priority} /> : null}
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
                      <Link href={`/conversaciones/${item.conversation_id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-100 dark:hover:bg-zinc-800/60">
                        {body}
                      </Link>
                    ) : (
                      <div className="flex items-start gap-3 px-4 py-3">{body}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
