import { connection } from "next/server";
import Link from "next/link";

import { NoAccess } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
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
  const { range, days, totals, failed } = await getConsumption({
    userClient: await createClient(),
    requestedMonth: first(query.mes),
  });

  const maxCredits = Math.max(1, ...days.map((day) => day.credits));
  const costNote =
    totals.callsWithoutCost === 0
      ? null
      : totals.costUsd === 0
        ? "Sin precios configurados: el costo no se calcula."
        : `Parcial: ${number.format(totals.callsWithoutCost)} llamadas sin precio no se incluyen.`;

  const tiles = [
    { label: "Créditos", value: number.format(totals.credits), hint: "conversaciones de 24 h abiertas" },
    {
      label: "Conversaciones",
      value: number.format(totals.windows),
      hint: `${number.format(totals.windowsByContact)} del asociado · ${number.format(totals.windowsByBusiness)} de la organización`,
    },
    {
      label: "Llamadas a IA",
      value: number.format(totals.aiCalls),
      hint: totals.aiErrors > 0 ? `${number.format(totals.aiErrors)} con error` : "sin errores",
    },
    {
      label: "Tokens",
      value: number.format(totals.inputTokens + totals.outputTokens),
      hint: `${number.format(totals.inputTokens)} de entrada · ${number.format(totals.outputTokens)} de salida`,
    },
    { label: "Costo estimado de IA", value: totals.costUsd > 0 ? usd.format(totals.costUsd) : "—", hint: costNote ?? "según los precios configurados" },
  ];

  // La tabla muestra solo los días con movimiento; el gráfico, el mes entero.
  const activeDays = days.filter((day) => day.credits > 0 || day.ai_calls > 0);

  return (
    <main className="flex flex-1 flex-col">
      <PageHeader
        title={`Consumo · ${monthLabel(range.month)}`}
        description={<>Un crédito es una conversación de 24 h con un contacto. {range.isCurrent ? "Mes en curso, hasta hoy." : null}</>}
        actions={
          <nav aria-label="Meses" className="flex gap-2">
            <Link href={`/consumo?mes=${range.previous}`} className="btn-secondary !px-3 !py-1.5 text-sm">
              ← {monthLabel(range.previous)}
            </Link>
            {range.next ? (
              <Link href={`/consumo?mes=${range.next}`} className="btn-secondary !px-3 !py-1.5 text-sm">
                {monthLabel(range.next)} →
              </Link>
            ) : null}
          </nav>
        }
      />
      <div className="flex flex-col gap-6 p-4 sm:p-6">

      {failed ? (
        <p role="alert" className="text-sm text-danger">
          No se pudo cargar el consumo. Probá recargar la página.
        </p>
      ) : null}

      <section aria-label="Resumen" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.label} className="card flex flex-col gap-1 p-4">
            <span className="font-display text-2xl font-semibold">{tile.value}</span>
            <span className="text-sm font-medium">{tile.label}</span>
            <span className="text-xs text-muted">{tile.hint}</span>
          </div>
        ))}
      </section>

      <section aria-labelledby="por-dia" className="flex flex-col gap-3">
        <h2 id="por-dia" className="text-sm font-semibold uppercase tracking-wide text-muted">
          Créditos por día
        </h2>
        {/* Gráfico del mes: decorativo, los números están en la tabla de abajo. */}
        <div className="card flex h-36 items-end gap-[3px] px-4 pt-4 pb-3" aria-hidden="true">
          {days.map((day) => (
            <div
              key={day.day}
              title={`${capitalizeFirst(dayName.format(new Date(`${day.day}T00:00:00Z`)))}: ${number.format(day.credits)} créditos`}
              className={`flex-1 rounded-t-sm ${day.credits > 0 ? "bg-agent-jarvis" : "bg-line"}`}
              style={{ height: `${Math.max(3, Math.round((day.credits / maxCredits) * 100))}%` }}
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
    </main>
  );
}
