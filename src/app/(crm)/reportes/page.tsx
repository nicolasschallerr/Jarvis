import { connection } from "next/server";

import { ActivityChart } from "@/components/overview/activity-chart";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState, NoAccess } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { BotIcon, ChartIcon, ChatIcon, CheckIcon, GaugeIcon, InboxIcon, TeamIcon } from "@/components/ui/icons";
import { LinkTabs } from "@/components/ui/link-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { getCurrentProfile } from "@/lib/auth/profile";
import { STATUS_LABELS } from "@/lib/crm/format";
import { durationLabel, getReport, REPORT_RANGES, reportDaysFrom, type Count } from "@/lib/reports/summary";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Reportes" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

const number = new Intl.NumberFormat("es-AR");

// Color de la barra según qué significa el estado: nuevo (info), en curso (accent), esperando (warning), resuelto (success).
const STATUS_BAR: Record<string, string> = {
  new: "bg-info",
  in_progress: "bg-accent",
  waiting_contact: "bg-warning",
  waiting_area: "bg-warning",
  resolved: "bg-success",
};

// Filas con barra proporcional. `color` pinta cada barra por lo que significa (si no, accent) y `people` antepone el
// avatar de la persona a su nombre.
function CountTable({ title, rows, people = false }: { title: string; rows: Array<Count & { color?: string }>; people?: boolean }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <section className="card flex flex-col gap-3 p-4" aria-label={title}>
      <h3 className="text-sm font-semibold">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted">No hay casos abiertos.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li key={row.name} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  {people ? <Avatar name={row.name} size="sm" /> : null}
                  <span className="truncate">{row.name}</span>
                </span>
                <span className="font-mono text-xs text-muted">{number.format(row.count)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true">
                <div className={`grow-x h-full rounded-full ${row.color ?? "bg-accent"}`} style={{ width: `${Math.round((row.count / max) * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// Cómo viene la gestión: volumen, rapidez de respuesta (agente y equipo), casos y carga de trabajo. Todo se calcula en
// la base con la sesión de quien mira. Para superadmin y consulta y reportes (el operador ve lo suyo en su Inicio).
export default async function ReportesPage({ searchParams }: PageProps<"/reportes">) {
  await connection();
  const profile = await getCurrentProfile();
  if (profile.role === "operator") {
    return <NoAccess title="Reportes" reason="Solo el superadministrador y los usuarios de consulta y reportes pueden ver los reportes." />;
  }

  const days = reportDaysFrom((await searchParams).dias);
  const { report, failed } = await getReport({ userClient: await createClient(), days });

  const answeredShare = report && report.turnsAnswered > 0 ? Math.round((report.answeredByAgent / report.turnsAnswered) * 100) : null;
  const pending = report ? Math.max(0, report.turnsTotal - report.turnsAnswered) : 0;

  return (
    <main className="flex flex-1 flex-col">
      <PageHeader title="Reportes" description="Cómo viene la atención: cuánto llega, qué tan rápido se responde y cómo van los casos.">
        <LinkTabs label="Período" items={REPORT_RANGES.map((range) => ({ href: `/reportes?dias=${range}`, label: `Últimos ${range} días`, active: range === days }))} />
      </PageHeader>

      {failed || !report ? (
        <ErrorBanner>No se pudo calcular el reporte. Probá recargar la página.</ErrorBanner>
      ) : report.messagesIn === 0 && report.casesCreated === 0 && report.messagesOutAgent === 0 ? (
        <EmptyState icon={<ChartIcon className="size-6" />} title="Todavía no hay movimiento en este período" description="Cuando lleguen conversaciones y se abran casos, los números aparecen acá." />
      ) : (
        <div className="flex flex-col gap-6 p-4 sm:p-6">
          {/* Los números cuentan hasta su valor; las duraciones ("1 min 20 s") van como texto. */}
          <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile index={0} icon={<ChatIcon className="size-4" />} tone="accent" value={report.conversationsNew} label="Conversaciones nuevas" hint={`${number.format(report.messagesIn)} mensajes recibidos`} />
            <StatTile
              index={1}
              icon={<GaugeIcon className="size-4" />}
              tone="info"
              value={durationLabel(report.responseMedianSeconds)}
              label="Primera respuesta (mediana)"
              hint={report.responseP90Seconds === null ? undefined : `9 de cada 10 en menos de ${durationLabel(report.responseP90Seconds)}`}
            />
            <StatTile
              index={2}
              icon={<BotIcon className="size-4" />}
              tone="accent"
              value={answeredShare === null ? "—" : answeredShare}
              suffix="%"
              label="Respondido por el agente"
              hint={`${number.format(report.answeredByAgent)} el agente · ${number.format(report.answeredByOperator)} el equipo`}
            />
            <StatTile
              index={3}
              icon={<CheckIcon className="size-4" />}
              tone="success"
              value={durationLabel(report.resolutionMedianHours === null ? null : report.resolutionMedianHours * 3600)}
              label="Tiempo de resolución (mediana)"
              hint={`${number.format(report.casesResolved)} casos resueltos`}
            />
          </section>

          <section aria-label="Tiempos de respuesta" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatTile index={4} icon={<BotIcon className="size-4" />} tone="info" value={durationLabel(report.responseMedianSecondsAgent)} label="Respuesta del agente" hint="mediana" />
            <StatTile index={5} icon={<TeamIcon className="size-4" />} tone="info" value={durationLabel(report.responseMedianSecondsOperator)} label="Respuesta del equipo" hint="mediana, cuando responde una persona" />
            <StatTile
              index={6}
              icon={<InboxIcon className="size-4" />}
              tone={pending > 0 ? "warning" : "success"}
              value={pending}
              label="Consultas sin respuesta todavía"
              hint={`de ${number.format(report.turnsTotal)} consultas del período`}
            />
          </section>

          {/* Cada gráfico lleva su tabla oculta a la vista: el lector de pantalla también recibe los números de cada día. */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <section aria-labelledby="mensajes-por-dia" className="card flex flex-col gap-3 p-4">
              <h3 id="mensajes-por-dia" className="text-sm font-semibold">
                Mensajes por día
              </h3>
              <ActivityChart
                points={report.daily}
                caption="Mensajes por día"
                series={[
                  { key: "inbound", name: "Recibidos", color: "var(--agent-sinapsis)" },
                  { key: "outbound", name: "Enviados", color: "var(--accent)" },
                ]}
              />
            </section>
            <section aria-labelledby="casos-por-dia" className="card flex flex-col gap-3 p-4">
              <h3 id="casos-por-dia" className="text-sm font-semibold">
                Casos por día
              </h3>
              <ActivityChart
                points={report.daily}
                caption="Casos por día"
                series={[
                  { key: "casesCreated", name: "Abiertos", color: "var(--info)" },
                  { key: "casesResolved", name: "Resueltos", color: "var(--success)" },
                ]}
              />
            </section>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <CountTable
              title="Casos abiertos por estado"
              rows={Object.entries(report.openByStatus).map(([status, count]) => ({ name: STATUS_LABELS[status] ?? status, count, color: STATUS_BAR[status] }))}
            />
            <CountTable title="Casos abiertos por sector" rows={report.openBySector} />
            <CountTable title="Casos abiertos por persona" rows={report.openByAssignee} people />
          </div>

          <p className="text-xs text-muted">
            Del {report.from} al {report.to}, en el horario de la organización. La primera respuesta se mide desde que el contacto escribe hasta el primer mensaje que le
            contesta (del agente o de una persona).
          </p>
        </div>
      )}
    </main>
  );
}
