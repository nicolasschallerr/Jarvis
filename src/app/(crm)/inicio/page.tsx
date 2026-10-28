import { connection } from "next/server";
import Link from "next/link";

import { AgentCard, AgentEmblem, StatusDot, agentStatus, byAgentOrder, toAgentKind, type AgentView } from "@/components/agents/agent-card";
import { ActivityChart } from "@/components/overview/activity-chart";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Avatar } from "@/components/ui/avatar";
import { PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { AlertIcon, ArrowRightIcon, CaseIcon, ChatIcon, InboxIcon } from "@/components/ui/icons";
import { LogoMark } from "@/components/ui/logo";
import { WelcomeGate } from "@/components/welcome/welcome-gate";
import { getCurrentProfile } from "@/lib/auth/profile";
import { capitalizeFirst, channelLabel, messagePreview, shortDate, STATUS_LABELS } from "@/lib/crm/format";
import { greetingFor, longDate } from "@/lib/crm/greeting";
import { getHomeSummary } from "@/lib/crm/home";
import { getUnreadNotifications, noticeTarget } from "@/lib/crm/notifications";
import { dayKey, welcomeLine } from "@/lib/crm/welcome";
import { durationLabel, getReport } from "@/lib/reports/summary";
import { createClient } from "@/lib/supabase/server";

import { markNoticesRead } from "../avisos-actions";
import { LiveRefresh } from "../live-refresh";
import { ModuleMap, type ModuleMetric } from "@/components/overview/module-map";
import { sectionsFor } from "../sections";

export const metadata = { title: "Panorama" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

// Días de actividad que muestra el Panorama.
const ACTIVITY_DAYS = 14;

type Tile = { label: string; value: number; href: string; hint: string; icon: React.ReactNode; alert?: boolean };

const OPEN_STATUSES = [
  { key: "new", color: "bg-info" },
  { key: "in_progress", color: "bg-accent" },
  { key: "waiting_contact", color: "bg-warning" },
  { key: "waiting_area", color: "bg-agent-sinapsis" },
] as const;

const number = new Intl.NumberFormat("es-AR");

// Escalonado de entrada: cada bloque aparece un poco después del anterior.
const stagger = (index: number) => ({ animationDelay: `${index * 0.06}s` });

// El Panorama: la primera pantalla del CRM. De arriba hacia abajo: el saludo con el estado de los agentes, lo que hay
// que atender ahora, cómo viene la actividad, los avisos y las listas personales, y el mapa de todo lo que se puede
// hacer. Son números reales de la base, leídos con la sesión de quien mira (RLS).
export default async function InicioPage({ searchParams }: PageProps<"/inicio">) {
  // Página por pedido: lee la sesión y la hora actual (ver la nota de `instant` en el layout del CRM).
  await connection();
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const [summary, notices, activity, catalog] = await Promise.all([
    getHomeSummary({ userClient: supabase, userId: profile.id }),
    getUnreadNotifications({ userClient: supabase, userId: profile.id }),
    getReport({ userClient: supabase, days: ACTIVITY_DAYS }),
    supabase.from("catalog_items").select("id", { count: "exact", head: true }).eq("is_available", true),
  ]);
  const report = activity.report;

  const query = await searchParams;
  const playWelcome = query.bienvenida === "1";

  const now = new Date();
  const firstName = profile.fullName.trim().split(/\s+/)[0] ?? "";

  // Solo los agentes visibles del equipo; la base tiene otros tipos internos.
  const agents: AgentView[] = summary.agents.flatMap((agent) => {
    const kind = toAgentKind(agent.kind);
    return kind ? [{ kind, name: agent.name, tagline: agent.tagline, status: agent.status as AgentView["status"], isEnabled: agent.is_enabled }] : [];
  }).sort((a, b) => byAgentOrder(a.kind, b.kind));

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

  const answeredShare = report && report.turnsAnswered > 0 ? Math.round((report.answeredByAgent / report.turnsAnswered) * 100) : null;
  const openCases = OPEN_STATUSES.map((status) => ({
    ...status,
    label: STATUS_LABELS[status.key] ?? status.key,
    count: report?.openByStatus[status.key] ?? 0,
  }));
  const openTotal = openCases.reduce((total, status) => total + status.count, 0);
  const moduleGroups = sectionsFor(profile.role, Boolean(catalog.count));
  // El dato en vivo que muestra cada tarjeta del mapa. Solo hay donde hay algo que contar.
  const moduleMetrics: Record<string, ModuleMetric | undefined> = {
    "/conversaciones":
      summary.counts.awaitingReply > 0
        ? { text: `${summary.counts.awaitingReply} esperando respuesta`, tone: "warning" }
        : { text: "Al día", tone: "success" },
    "/casos":
      summary.counts.urgentCases > 0
        ? { text: `${openTotal} abiertos · ${summary.counts.urgentCases} urgente${summary.counts.urgentCases === 1 ? "" : "s"}`, tone: "danger" }
        : { text: `${openTotal} abiertos`, tone: "info" },
    "/avisos": notices.unread > 0 ? { text: `${notices.unread} sin leer`, tone: "warning" } : undefined,
    "/stock": catalog.count ? { text: `${number.format(catalog.count)} productos`, tone: "accent" } : undefined,
  };

  return (
    <main className="flex flex-1 flex-col gap-6 p-4 sm:p-6 lg:p-8">
      <WelcomeGate
        play={playWelcome}
        todayKey={dayKey(now)}
        greeting={greetingFor(now)}
        firstName={firstName}
        agents={agents.map((agent) => ({
          kind: agent.kind,
          name: agent.name,
          status: agent.status,
          line: welcomeLine(agent.kind, summary.counts, catalog.count ?? 0),
        }))}
      />
      <LiveRefresh organizationId={profile.organizationId} agents />

      {/* Saludo: la fecha, el estado general y los agentes en vivo. */}
      <header className="rise-in relative overflow-hidden rounded-2xl border border-line bg-surface p-5 sm:p-7">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true">
          <div
            className="aurora absolute -top-32 -right-24 size-96 rounded-full blur-3xl"
            style={{ background: "radial-gradient(closest-side, var(--glow), transparent)" }}
          />
          <div
            className="aurora absolute -bottom-40 left-1/3 size-80 rounded-full blur-3xl"
            style={{
              background: "radial-gradient(closest-side, color-mix(in srgb, var(--agent-sinapsis) 14%, transparent), transparent)",
              animationDelay: "-8s",
            }}
          />
          <LogoMark animated className="absolute -right-8 -bottom-12 size-52 opacity-10" title="" />
        </div>

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-col gap-1.5">
            <p className="eyebrow">
              {capitalizeFirst(longDate(now))} · {profile.organizationName}
            </p>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
              {greetingFor(now)}, {firstName}
            </h1>
            <p className="max-w-xl text-sm text-muted">
              {summary.counts.awaitingReply === 0
                ? "No hay conversaciones esperando respuesta. Todo al día."
                : `${summary.counts.awaitingReply === 1 ? "Hay 1 conversación" : `Hay ${summary.counts.awaitingReply} conversaciones`} esperando respuesta.`}
              {summary.counts.urgentCases > 0
                ? ` ${summary.counts.urgentCases === 1 ? "1 caso urgente" : `${summary.counts.urgentCases} casos urgentes`} sin resolver.`
                : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link href="/conversaciones" className="btn-primary gap-2">
                Ir a la bandeja <ArrowRightIcon />
              </Link>
              <Link href="/casos" className="btn-secondary !px-4 !py-2">
                Ver casos
              </Link>
            </div>
          </div>

          {agents.length > 0 ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-2" aria-label="Estado de los agentes">
              {agents.map((agent) => {
                const status = agentStatus(agent);
                return (
                  <li key={agent.kind} className="flex items-center gap-3 rounded-xl border border-line bg-background/60 py-1.5 pr-4 pl-1.5 backdrop-blur">
                    <AgentEmblem kind={agent.kind} name={agent.name} tone={status.tone} className="size-10" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold leading-tight">{agent.name}</p>
                      <p className="flex items-center gap-1.5 text-xs text-muted">
                        <StatusDot tone={status.tone} /> {status.label}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      </header>

      {summary.failed || activity.failed ? (
        <p role="alert" className="text-sm text-danger">
          Algunos datos no se pudieron cargar. Probá recargar la página.
        </p>
      ) : null}

      {/* Lo que hay que atender ahora. */}
      <section aria-labelledby="ahora" className="flex flex-col gap-3">
        <h2 id="ahora" className="eyebrow">
          Para atender ahora
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((tile, index) => (
            <div key={tile.label} className="rise-in" style={stagger(index + 1)}>
              <Link
                href={tile.href}
                className={`card spotlight group h-full flex flex-col gap-1 p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md ${tile.alert ? "border-danger/40" : "hover:border-accent/40"}`}
              >
                <span className="flex items-center justify-between">
                  <AnimatedNumber value={tile.value} className={`font-mono text-3xl font-semibold ${tile.alert ? "text-danger" : ""}`} />
                  <span
                    className={`grid size-9 place-items-center rounded-xl transition duration-200 group-hover:scale-110 group-hover:rotate-6 ${tile.alert ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent"}`}
                    aria-hidden="true"
                  >
                    {tile.icon}
                  </span>
                </span>
                <span className="text-sm font-medium">{tile.label}</span>
                <span className="flex items-center justify-between text-xs text-muted">
                  {tile.hint}
                  <span className="-translate-x-1 opacity-0 transition duration-200 group-hover:translate-x-0 group-hover:opacity-100" aria-hidden="true">
                    <ArrowRightIcon className="size-3.5" />
                  </span>
                </span>
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* Cómo viene la actividad. */}
      {report ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <section aria-labelledby="actividad" className="card rise-in flex flex-col gap-5 p-5 lg:col-span-2" style={stagger(5)}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="actividad" className="text-sm font-semibold">
                Actividad de los últimos {ACTIVITY_DAYS} días
              </h2>
              {profile.role !== "operator" ? (
                <Link href="/reportes" className="text-xs text-accent underline-offset-2 hover:underline">
                  Ver reportes
                </Link>
              ) : null}
            </div>
            <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Metric label="Conversaciones nuevas" value={<AnimatedNumber value={report.conversationsNew} />} />
              <Metric label="Mensajes recibidos" value={<AnimatedNumber value={report.messagesIn} />} />
              <Metric label="Respondido por el agente" value={answeredShare === null ? "—" : <AnimatedNumber value={answeredShare} suffix="%" />} />
              <Metric label="Primera respuesta" value={durationLabel(report.responseMedianSeconds)} hint="mediana" />
            </dl>
            <ActivityChart points={report.daily.map((point) => ({ day: point.day, inbound: point.inbound, outbound: point.outbound }))} />
          </section>

          <section aria-labelledby="abiertos" className="card rise-in flex flex-col gap-5 p-5" style={stagger(6)}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="abiertos" className="text-sm font-semibold">
                Casos abiertos
              </h2>
              <Link href="/casos?vista=all" className="text-xs text-accent underline-offset-2 hover:underline">
                Ver tablero
              </Link>
            </div>
            <AnimatedNumber value={openTotal} className="font-mono text-4xl font-semibold" />
            {/* Barra apilada: la proporción de cada estado. Los números están en la lista de abajo. */}
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true">
              {openCases
                .filter((status) => status.count > 0)
                .map((status) => (
                  <span key={status.key} className={`grow-x h-full ${status.color}`} style={{ width: `${(status.count / Math.max(1, openTotal)) * 100}%` }} />
                ))}
            </div>
            <ul className="flex flex-col gap-2.5">
              {openCases.map((status) => (
                <li key={status.key} className="flex items-center gap-2 text-sm">
                  <span className={`size-2 rounded-full ${status.color}`} aria-hidden="true" />
                  <span className="flex-1 text-muted">{status.label}</span>
                  <span className="font-mono font-medium">{number.format(status.count)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-auto border-t border-line pt-3 text-xs text-muted">
              {number.format(report.casesCreated)} abiertos y {number.format(report.casesResolved)} resueltos en {ACTIVITY_DAYS} días.
            </p>
          </section>
        </div>
      ) : null}

      {notices.unread > 0 ? (
        <section aria-labelledby="avisos" className="rise-in flex flex-col gap-3" style={stagger(7)}>
          <div className="flex items-center justify-between gap-3">
            <h2 id="avisos" className="eyebrow">
              Avisos ({notices.unread})
            </h2>
            <Link href="/avisos" className="ml-auto text-xs text-accent underline-offset-2 hover:underline">
              Ver todos
            </Link>
            <form action={markNoticesRead}>
              <button type="submit" className="btn-secondary !px-2 !py-1 text-xs">
                Marcar como leídos
              </button>
            </form>
          </div>
          <ul className="card divide-y divide-line overflow-hidden">
            {notices.items.map((notice) => {
              const body = (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{notice.title}</p>
                  <p className="truncate text-sm text-muted">{notice.body}</p>
                </div>
              );
              const href = noticeTarget(notice);
              return (
                <li key={notice.id}>
                  {href ? (
                    <Link href={href} className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/60">
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

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section aria-labelledby="esperando" className="rise-in flex flex-col gap-3" style={stagger(8)}>
          <div className="flex items-center justify-between">
            <h2 id="esperando" className="eyebrow">
              Esperando respuesta
            </h2>
            <Link href="/conversaciones?filtro=esperando" className="text-xs text-accent underline-offset-2 hover:underline">
              Ver todas
            </Link>
          </div>
          {summary.awaitingList.length === 0 ? (
            <p className="card p-4 text-sm text-muted">No hay conversaciones esperando respuesta.</p>
          ) : (
            <ul className="card divide-y divide-line overflow-hidden">
              {summary.awaitingList.map((item) => (
                <li key={item.id}>
                  <Link
                    href={`/conversaciones/${item.id}`}
                    className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                  >
                    <Avatar name={item.contact_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.contact_name || "Sin nombre"} <span className="font-normal text-muted">· {channelLabel(item.channel_type ?? "")}</span>
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

        <section aria-labelledby="mios" className="rise-in flex flex-col gap-3" style={stagger(9)}>
          <div className="flex items-center justify-between">
            <h2 id="mios" className="eyebrow">
              Mis casos
            </h2>
            <Link href="/casos?vista=mine" className="text-xs text-accent underline-offset-2 hover:underline">
              Ver todos
            </Link>
          </div>
          {summary.myCases.length === 0 ? (
            <p className="card p-4 text-sm text-muted">No tenés casos abiertos asignados.</p>
          ) : (
            <ul className="card divide-y divide-line overflow-hidden">
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
                      <Link
                        href={`/conversaciones/${item.conversation_id}`}
                        className="flex items-start gap-3 px-4 py-3 transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800/60"
                      >
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

      <section aria-labelledby="agentes" className="flex flex-col gap-3">
        <h2 id="agentes" className="eyebrow">
          Tu equipo de agentes
        </h2>
        {agents.length === 0 ? (
          <p className="card p-4 text-sm text-muted">
            Todavía no hay agentes configurados. Se cargan con la sección <code>agentes</code> del archivo de configuración del cliente.
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {agents.map((agent, index) => (
              <div key={agent.kind} className="rise-in" style={stagger(10 + index)}>
                <AgentCard agent={agent} />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* El mapa del CRM: cada sección con lo que hace. Se muestran las que la persona puede usar. */}
      <section aria-labelledby="todo" className="flex flex-col gap-4">
        <h2 id="todo" className="eyebrow">
          Explorá Orbita
        </h2>
        <ModuleMap groups={moduleGroups} metrics={moduleMetrics} />
      </section>
    </main>
  );
}

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="order-2 text-xs text-muted">
        {label}
        {hint ? ` (${hint})` : ""}
      </dt>
      <dd className="order-1 font-mono text-2xl font-semibold">{value}</dd>
    </div>
  );
}
