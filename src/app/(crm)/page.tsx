import Link from "next/link";

import { AgentCard, type AgentView } from "@/components/agents/agent-card";
import { getCurrentProfile } from "@/lib/auth/profile";
import { channelLabel, messagePreview, PRIORITY_LABELS, shortDate, STATUS_LABELS } from "@/lib/crm/format";
import { WelcomeGate } from "@/components/welcome/welcome-gate";
import { greetingFor, longDate } from "@/lib/crm/greeting";
import { getHomeSummary } from "@/lib/crm/home";
import { dayKey, welcomeLine } from "@/lib/crm/welcome";
import { createClient } from "@/lib/supabase/server";

import { LiveRefresh } from "./live-refresh";

type Tile = { label: string; value: number; href: string; hint: string };

export default async function InicioPage({ searchParams }: PageProps<"/">) {
  const profile = await getCurrentProfile();
  const supabase = await createClient();
  const summary = await getHomeSummary({ userClient: supabase, userId: profile.id });

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
    { label: "Esperando respuesta", value: summary.counts.awaitingReply, href: "/conversaciones", hint: "conversaciones" },
    { label: "Mis casos abiertos", value: summary.counts.myOpenCases, href: "/casos?vista=mine", hint: "asignados a vos" },
    { label: "Casos sin asignar", value: summary.counts.unassignedCases, href: "/casos?vista=unassigned", hint: "nadie los tomó" },
    { label: "Casos urgentes", value: summary.counts.urgentCases, href: "/casos?vista=all", hint: "abiertos" },
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
      <LiveRefresh organizationId={profile.organizationId} />

      <header>
        <p className="text-sm capitalize text-zinc-600 dark:text-zinc-400">{longDate(now)}</p>
        <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
          {greetingFor(now)}, {firstName}
        </h1>
      </header>

      {summary.failed ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          Algunos datos no se pudieron cargar. Probá recargar la página.
        </p>
      ) : null}

      <section aria-labelledby="agentes" className="flex flex-col gap-3">
        <h2 id="agentes" className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Tu equipo de agentes
        </h2>
        {agents.length === 0 ? (
          <p className="card p-4 text-sm text-zinc-600 dark:text-zinc-400">
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
        <h2 id="resumen" className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
          Cómo está todo
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {tiles.map((tile) => (
            <Link
              key={tile.label}
              href={tile.href}
              className="card flex flex-col gap-1 p-4 transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className="font-display text-3xl font-semibold">{tile.value}</span>
              <span className="text-sm font-medium">{tile.label}</span>
              <span className="text-xs text-zinc-600 dark:text-zinc-400">{tile.hint}</span>
            </Link>
          ))}
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="esperando" className="flex flex-col gap-3">
          <h2 id="esperando" className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Esperando respuesta
          </h2>
          {summary.awaitingList.length === 0 ? (
            <p className="card p-4 text-sm text-zinc-600 dark:text-zinc-400">No hay conversaciones esperando respuesta.</p>
          ) : (
            <ul className="card divide-y divide-zinc-200 dark:divide-zinc-800">
              {summary.awaitingList.map((item) => (
                <li key={item.id}>
                  <Link href={`/conversaciones/${item.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-zinc-100 dark:hover:bg-zinc-800/60">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {item.contact_name || "Sin nombre"}{" "}
                        <span className="font-normal text-zinc-600 dark:text-zinc-400">· {channelLabel(item.channel_type ?? "")}</span>
                      </p>
                      <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">{messagePreview(item.last_body, item.last_type)}</p>
                    </div>
                    <time className="shrink-0 text-xs text-zinc-600 dark:text-zinc-400" dateTime={item.last_message_at ?? undefined}>
                      {shortDate(item.last_message_at, now)}
                    </time>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="mios" className="flex flex-col gap-3">
          <h2 id="mios" className="text-sm font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
            Mis casos
          </h2>
          {summary.myCases.length === 0 ? (
            <p className="card p-4 text-sm text-zinc-600 dark:text-zinc-400">No tenés casos abiertos asignados.</p>
          ) : (
            <ul className="card divide-y divide-zinc-200 dark:divide-zinc-800">
              {summary.myCases.map((item) => {
                const body = (
                  <>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{item.title}</p>
                      <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">
                        {item.contacts?.display_name || "Sin nombre"} · {STATUS_LABELS[item.status]} · Prioridad{" "}
                        {PRIORITY_LABELS[item.priority]?.toLowerCase()}
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
