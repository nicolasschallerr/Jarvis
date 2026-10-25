import { connection } from "next/server";

import { EmptyState, NoAccess } from "@/components/ui/empty-state";
import { ChartIcon } from "@/components/ui/icons";
import { LinkTabs } from "@/components/ui/link-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentProfile } from "@/lib/auth/profile";
import { STATUS_LABELS } from "@/lib/crm/format";
import { durationLabel, getReport, REPORT_RANGES, reportDaysFrom, type Count, type DailyPoint } from "@/lib/reports/summary";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Reportes" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

const number = new Intl.NumberFormat("es-AR");
const dayFormat = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });

function Tile({ value, label, hint }: { value: string; label: string; hint?: string }) {
  return (
    <div className="card flex flex-col gap-1 p-4">
      <span className="font-mono text-2xl font-semibold">{value}</span>
      <span className="text-sm font-medium">{label}</span>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

// Barras por día. Decorativas: los números están en las tarjetas y en las tablas.
function Bars({ points, series, label }: { points: DailyPoint[]; series: Array<{ key: keyof DailyPoint; color: string; name: string }>; label: string }) {
  const max = Math.max(1, ...points.flatMap((point) => series.map((item) => Number(point[item.key]))));
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{label}</h3>
        <ul className="flex gap-3 text-xs text-muted">
          {series.map((item) => (
            <li key={item.name} className="flex items-center gap-1.5">
              <span className={`size-2 rounded-full ${item.color}`} aria-hidden="true" />
              {item.name}
            </li>
          ))}
        </ul>
      </div>
      <div className="flex h-32 items-end gap-[3px]" aria-hidden="true">
        {points.map((point) => (
          <div key={point.day} className="flex h-full min-w-0 flex-1 items-end gap-px" title={`${dayFormat.format(new Date(`${point.day}T00:00:00Z`))}: ${series.map((item) => `${item.name} ${point[item.key]}`).join(" · ")}`}>
            {series.map((item) => (
              <div key={item.name} className={`min-h-[2px] flex-1 rounded-t-sm ${item.color}`} style={{ height: `${Math.max(2, Math.round((Number(point[item.key]) / max) * 100))}%` }} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex justify-between font-mono text-[11px] text-muted" aria-hidden="true">
        <span>{points[0] ? dayFormat.format(new Date(`${points[0].day}T00:00:00Z`)) : ""}</span>
        <span>{points.at(-1) ? dayFormat.format(new Date(`${points.at(-1)?.day}T00:00:00Z`)) : ""}</span>
      </div>
    </div>
  );
}

function CountTable({ title, rows }: { title: string; rows: Count[] }) {
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
              <div className="flex justify-between gap-2 text-sm">
                <span className="truncate">{row.name}</span>
                <span className="font-mono text-xs text-muted">{number.format(row.count)}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true">
                <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round((row.count / max) * 100)}%` }} />
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

  return (
    <main className="flex flex-1 flex-col">
      <PageHeader title="Reportes" description="Cómo viene la atención: cuánto llega, qué tan rápido se responde y cómo van los casos.">
        <LinkTabs label="Período" items={REPORT_RANGES.map((range) => ({ href: `/reportes?dias=${range}`, label: `Últimos ${range} días`, active: range === days }))} />
      </PageHeader>

      {failed || !report ? (
        <p role="alert" className="p-6 text-sm text-danger">
          No se pudo calcular el reporte. Probá recargar la página.
        </p>
      ) : report.messagesIn === 0 && report.casesCreated === 0 && report.messagesOutAgent === 0 ? (
        <EmptyState icon={<ChartIcon className="size-6" />} title="Todavía no hay movimiento en este período" description="Cuando lleguen conversaciones y se abran casos, los números aparecen acá." />
      ) : (
        <div className="flex flex-col gap-6 p-4 sm:p-6">
          <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile value={number.format(report.conversationsNew)} label="Conversaciones nuevas" hint={`${number.format(report.messagesIn)} mensajes recibidos`} />
            <Tile
              value={durationLabel(report.responseMedianSeconds)}
              label="Primera respuesta (mediana)"
              hint={report.responseP90Seconds === null ? undefined : `9 de cada 10 en menos de ${durationLabel(report.responseP90Seconds)}`}
            />
            <Tile
              value={answeredShare === null ? "—" : `${answeredShare}%`}
              label="Respondido por el agente"
              hint={`${number.format(report.answeredByAgent)} el agente · ${number.format(report.answeredByOperator)} el equipo`}
            />
            <Tile value={durationLabel(report.resolutionMedianHours === null ? null : report.resolutionMedianHours * 3600)} label="Tiempo de resolución (mediana)" hint={`${number.format(report.casesResolved)} casos resueltos`} />
          </section>

          <section aria-label="Tiempos de respuesta" className="grid gap-3 sm:grid-cols-3">
            <Tile value={durationLabel(report.responseMedianSecondsAgent)} label="Respuesta del agente" hint="mediana" />
            <Tile value={durationLabel(report.responseMedianSecondsOperator)} label="Respuesta del equipo" hint="mediana, cuando responde una persona" />
            <Tile
              value={number.format(Math.max(0, report.turnsTotal - report.turnsAnswered))}
              label="Consultas sin respuesta todavía"
              hint={`de ${number.format(report.turnsTotal)} consultas del período`}
            />
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Bars
              points={report.daily}
              label="Mensajes por día"
              series={[
                { key: "inbound", color: "bg-agent-sinapsis", name: "Recibidos" },
                { key: "outbound", color: "bg-accent", name: "Enviados" },
              ]}
            />
            <Bars
              points={report.daily}
              label="Casos por día"
              series={[
                { key: "casesCreated", color: "bg-info", name: "Abiertos" },
                { key: "casesResolved", color: "bg-success", name: "Resueltos" },
              ]}
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <CountTable title="Casos abiertos por estado" rows={Object.entries(report.openByStatus).map(([status, count]) => ({ name: STATUS_LABELS[status] ?? status, count }))} />
            <CountTable title="Casos abiertos por sector" rows={report.openBySector} />
            <CountTable title="Casos abiertos por persona" rows={report.openByAssignee} />
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
