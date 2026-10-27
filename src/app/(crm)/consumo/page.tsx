import { connection } from "next/server";
import Link from "next/link";

import { NoAccess } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ArrowLeftIcon, ArrowRightIcon, BotIcon, ChartIcon, ChatIcon, GaugeIcon, SparkIcon } from "@/components/ui/icons";
import { LimitsCard } from "./limits-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile, type StatTone } from "@/components/ui/stat-tile";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getConsumption } from "@/lib/crm/consumption";
import { capitalizeFirst } from "@/lib/crm/format";
import { createClient } from "@/lib/supabase/server";

const number = new Intl.NumberFormat("es-AR");
const usd = new Intl.NumberFormat("es-AR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const monthName = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
const dayName = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", timeZone: "UTC" });

function monthLabel(month: string): string {
  return capitalizeFirst(monthName.format(new Date(`${month}-01T00:00:00Z`)));
}

export const metadata = { title: "Consumo" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

export default async function ConsumoPage({ searchParams }: PageProps<"/consumo">) {
  // Página por pedido: lee la sesión y la hora actual (ver la nota de `instant` en el layout del CRM).
  await connection();
  const profile = await getCurrentProfile();

  // El consumo es de la administración: superadmin y consulta y reportes. Los operadores no ven el gasto en IA.
  if (profile.role === "operator") {
    return <NoAccess title="Consumo" reason="Solo el superadministrador y los usuarios de consulta y reportes pueden ver el consumo." />;
  }

  const query = await searchParams;
  const supabase = await createClient();
  // El consumo del mes y los límites de la organización, a la vez.
  const [{ range, days, totals, failed }, { data: organization }] = await Promise.all([
    getConsumption({ userClient: supabase, requestedMonth: first(query.mes) }),
    supabase.from("organizations").select("monthly_credit_limit, monthly_cost_limit_usd, usage_alert_percent").maybeSingle(),
  ]);
  const limits = {
    credits: organization?.monthly_credit_limit ?? null,
    costUsd: organization?.monthly_cost_limit_usd === null || organization?.monthly_cost_limit_usd === undefined ? null : Number(organization.monthly_cost_limit_usd),
    alertPercent: organization?.usage_alert_percent ?? 80,
  };

  const maxCredits = Math.max(1, ...days.map((day) => day.credits));
  const costNote =
    totals.callsWithoutCost === 0
      ? null
      : totals.costUsd === 0
        ? "Sin precios configurados: el costo no se calcula."
        : `Parcial: ${number.format(totals.callsWithoutCost)} llamadas sin precio no se incluyen.`;

  const tiles: Array<{ label: string; value: number | string; hint: string; icon: React.ReactNode; tone: StatTone }> = [
    { label: "Créditos", value: totals.credits, hint: "conversaciones de 24 h abiertas", icon: <GaugeIcon className="size-4" />, tone: "accent" },
    {
      label: "Conversaciones",
      value: totals.windows,
      hint: `${number.format(totals.windowsByContact)} del asociado · ${number.format(totals.windowsByBusiness)} de la organización`,
      icon: <ChatIcon className="size-4" />,
      tone: "info",
    },
    {
      label: "Llamadas a IA",
      value: totals.aiCalls,
      hint: totals.aiErrors > 0 ? `${number.format(totals.aiErrors)} con error` : "sin errores",
      icon: <SparkIcon className="size-4" />,
      tone: totals.aiErrors > 0 ? "warning" : "success",
    },
    {
      label: "Tokens",
      value: totals.inputTokens + totals.outputTokens,
      hint: `${number.format(totals.inputTokens)} de entrada · ${number.format(totals.outputTokens)} de salida`,
      icon: <BotIcon className="size-4" />,
      tone: "accent",
    },
    // El costo va como texto: el formato de moneda (con decimales) no se anima.
    { label: "Costo estimado de IA", value: totals.costUsd > 0 ? usd.format(totals.costUsd) : "—", hint: costNote ?? "según los precios configurados", icon: <ChartIcon className="size-4" />, tone: "info" },
  ];

  // La tabla muestra solo los días con movimiento; el gráfico, el mes entero.
  const activeDays = days.filter((day) => day.credits > 0 || day.ai_calls > 0);
  // En el mes en curso, el último día consultado es hoy: su barra se resalta.
  const today = range.isCurrent ? range.to : null;

  return (
    <main className="flex flex-1 flex-col">
      <PageHeader
        title={`Consumo · ${monthLabel(range.month)}`}
        description={<>Un crédito es una conversación de 24 h con un contacto. {range.isCurrent ? "Mes en curso, hasta hoy." : null}</>}
        actions={
          <>
            {/* En el celular queda solo el ícono; el nombre accesible sigue siendo "Exportar CSV". */}
            <a href={`/exportar/consumo?mes=${range.month}`} className="btn-secondary gap-1.5 !px-3 !py-1.5 text-sm" aria-label="Exportar CSV" title="Exportar CSV" download>
              <ArrowRightIcon className="size-4 rotate-90" />
              <span className="hidden sm:inline">Exportar CSV</span>
            </a>
            <nav aria-label="Meses" className="flex items-center gap-1 rounded-lg border border-zinc-300 bg-surface p-0.5 dark:border-zinc-700">
              <Link
                href={`/consumo?mes=${range.previous}`}
                aria-label={`Mes anterior: ${monthLabel(range.previous)}`}
                className="grid size-7 place-items-center rounded-md transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <ArrowLeftIcon className="size-4" />
              </Link>
              <span className="min-w-28 px-1 text-center text-sm font-medium">{monthLabel(range.month)}</span>
              {range.next ? (
                <Link
                  href={`/consumo?mes=${range.next}`}
                  aria-label={`Mes siguiente: ${monthLabel(range.next)}`}
                  className="grid size-7 place-items-center rounded-md transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
                >
                  <ArrowRightIcon className="size-4" />
                </Link>
              ) : (
                // Mes en curso: no hay siguiente. Se deja el lugar para que el control no cambie de ancho.
                <span className="grid size-7 place-items-center text-muted opacity-40" aria-hidden="true">
                  <ArrowRightIcon className="size-4" />
                </span>
              )}
            </nav>
          </>
        }
      />

      {/* Si la carga falló no se muestran tarjetas en cero ni un gráfico vacío: parecería que no hubo consumo. */}
      {failed ? (
        <ErrorBanner>No se pudo cargar el consumo. Probá recargar la página.</ErrorBanner>
      ) : (
      <div className="flex flex-col gap-6 p-4 sm:p-6">

      <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map((tile, index) => (
          <StatTile key={tile.label} index={index} label={tile.label} value={tile.value} hint={tile.hint} icon={tile.icon} tone={tile.tone} />
        ))}
      </section>

      <LimitsCard limits={limits} used={{ credits: totals.credits, costUsd: totals.costUsd }} canEdit={profile.role === "superadmin"} />

      <section aria-labelledby="por-dia" className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="por-dia" className="text-sm font-semibold uppercase tracking-wide text-muted">
            Créditos por día
          </h2>
          {today ? (
            <span className="flex items-center gap-1.5 text-xs text-muted" aria-hidden="true">
              <span className="size-2 rounded-full bg-accent" />
              Hoy
            </span>
          ) : null}
        </div>
        {/* Gráfico del mes: decorativo, los números están en la tabla de abajo. Las barras entran escalonadas. */}
        <div className="card flex h-36 items-end gap-[3px] px-4 pt-4 pb-3" aria-hidden="true">
          {days.map((day, index) => (
            <div
              key={day.day}
              title={`${capitalizeFirst(dayName.format(new Date(`${day.day}T00:00:00Z`)))}: ${number.format(day.credits)} créditos`}
              className={`rise-in flex-1 rounded-t-sm ${day.day === today ? "bg-accent" : day.credits > 0 ? "bg-accent/35" : "bg-line"}`}
              style={{ height: `${Math.max(3, Math.round((day.credits / maxCredits) * 100))}%`, animationDelay: `${index * 0.015}s` }}
            />
          ))}
        </div>
      </section>

      <section aria-labelledby="detalle" className="flex flex-col gap-3">
        <h2 id="detalle" className="text-sm font-semibold uppercase tracking-wide text-muted">
          Días con movimiento
        </h2>
        {activeDays.length === 0 ? (
          <p className="card p-4 text-sm text-muted">Todavía no hubo conversaciones ni llamadas a la IA este mes.</p>
        ) : (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th scope="col" className="px-4 py-2 font-medium">Día</th>
                <th scope="col" className="px-4 py-2 font-medium">Créditos</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Llamadas a IA</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Tokens</th>
                <th scope="col" className="px-4 py-2 text-right font-medium">Costo</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {activeDays.map((day) => (
                <tr key={day.day}>
                  <th scope="row" className="px-4 py-2 text-left font-normal">{capitalizeFirst(dayName.format(new Date(`${day.day}T00:00:00Z`)))}</th>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2">
                      <span className="w-8 shrink-0 text-right tabular-nums">{number.format(day.credits)}</span>
                      <span
                        aria-hidden="true"
                        className="h-2 rounded-full bg-agent-jarvis"
                        style={{ width: `${Math.round((day.credits / maxCredits) * 100)}%`, minWidth: day.credits > 0 ? "0.25rem" : 0 }}
                      />
                    </div>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">{number.format(day.ai_calls)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{number.format(Number(day.input_tokens) + Number(day.output_tokens))}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{Number(day.cost_usd) > 0 ? usd.format(Number(day.cost_usd)) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </section>
      </div>
      )}
    </main>
  );
}
