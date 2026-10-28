import { connection } from "next/server";

import { MonthlyBars } from "@/components/finance/monthly-bars";
import { Badge } from "@/components/ui/badge";
import { EmptyState, NoAccess } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ChartIcon, CoinIcon, InboxIcon, SendIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { StatTile } from "@/components/ui/stat-tile";
import { getCurrentProfile } from "@/lib/auth/profile";
import { todayIn } from "@/lib/crm/consumption";
import { loadMovements } from "@/lib/finance/tools";
import { byCategory, formatMoney, formatMoneyShort, monthBounds, monthlyTotals, pending, periodTotals } from "@/lib/finance/summary";
import { createClient } from "@/lib/supabase/server";

import { AnalystChat } from "../analitico/chat";
import { askFinanceAction } from "./actions";

export const metadata = { title: "Finanzas" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

const TOOL_LABELS: Record<string, string> = {
  resumen_financiero: "resumen del período",
  por_categoria: "categorías",
  evolucion_mensual: "evolución mensual",
  pendientes: "pendientes",
};

const EXAMPLES = [
  "¿Cómo venimos este mes comparado con el anterior?",
  "¿En qué gastamos más este trimestre?",
  "¿Quién nos debe y cuánto está vencido?",
  "¿Cuál fue el mejor mes de los últimos seis?",
];

const dueDate = new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", timeZone: "UTC" });

export default async function FinanzasPage() {
  await connection();
  const profile = await getCurrentProfile();

  if (profile.role === "operator") {
    return <NoAccess title="Finanzas" reason="Solo el superadministrador y los usuarios de consulta y reportes ven los números de la empresa." />;
  }

  const supabase = await createClient();
  const [{ data: agent }, { data: organization }, loaded] = await Promise.all([
    supabase.from("agents").select("name, is_enabled").eq("kind", "finance").maybeSingle(),
    supabase.from("organizations").select("timezone").maybeSingle(),
    loadMovements(supabase),
  ]);

  const today = todayIn(organization?.timezone ?? "America/Argentina/Buenos_Aires", new Date());
  const month = monthBounds(today);
  const totals = periodTotals(loaded.movements, month.from, today);
  const receivable = pending(loaded.movements, "income", today);
  const payable = pending(loaded.movements, "expense", today);
  const months = monthlyTotals(loaded.movements, today, 6);
  const expenses = byCategory(loaded.movements, "expense", month.from, today).slice(0, 6);
  const agentName = agent?.name ?? "Finanzas";

  return (
    <main className="flex flex-1 flex-col">
      <PageHeader title="Finanzas" description="Cómo vienen los números de la empresa: lo cobrado, lo pagado y lo que falta. Solo lectura." />

      <div className="flex flex-col gap-6 p-4 sm:p-6">
        {loaded.error ? <ErrorBanner>No se pudieron cargar los movimientos. Probá recargar la página.</ErrorBanner> : null}

        {!loaded.error && loaded.movements.length === 0 ? (
          <EmptyState
            icon={<CoinIcon className="size-6" />}
            title="Todavía no hay movimientos cargados"
            description="El equipo de Orbita AI conecta el sistema de gestión o la planilla de la empresa y los números aparecen acá."
          />
        ) : (
          <>
            <section aria-label="Este mes" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatTile label="Ingresos del mes" value={formatMoneyShort(totals.ingresos)} hint={formatMoney(totals.ingresos)} icon={<ChartIcon />} tone="success" index={0} />
              <StatTile label="Egresos del mes" value={formatMoneyShort(totals.egresos)} hint={formatMoney(totals.egresos)} icon={<SendIcon />} tone="warning" index={1} />
              <StatTile
                label="Resultado del mes"
                value={formatMoneyShort(totals.resultado)}
                hint={totals.margen === null ? "Sin ingresos todavía" : `Margen ${totals.margen.toLocaleString("es-AR")} %`}
                icon={<CoinIcon />}
                tone={totals.resultado >= 0 ? "accent" : "danger"}
                index={2}
              />
              <StatTile
                label="Por cobrar"
                value={formatMoneyShort(receivable.total)}
                hint={receivable.vencido > 0 ? `${formatMoneyShort(receivable.vencido)} vencido` : "Nada vencido"}
                icon={<InboxIcon />}
                tone={receivable.vencido > 0 ? "danger" : "info"}
                index={3}
              />
            </section>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <section className="card rise-in flex flex-col gap-4 p-4 sm:p-5" aria-labelledby="fin-meses">
                <div>
                  <h2 id="fin-meses" className="font-semibold">Últimos seis meses</h2>
                  <p className="text-sm text-muted">Lo cobrado contra lo pagado. El mes actual está en curso.</p>
                </div>
                <MonthlyBars months={months} />
              </section>

              <section className="card rise-in flex flex-col gap-3 p-4 sm:p-5" aria-labelledby="fin-gastos">
                <div>
                  <h2 id="fin-gastos" className="font-semibold">En qué se fue la plata este mes</h2>
                  <p className="text-sm text-muted">Egresos por categoría.</p>
                </div>
                {expenses.length === 0 ? (
                  <p className="text-sm text-muted">Todavía no hay egresos este mes.</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {expenses.map((item, index) => (
                      <li key={item.categoria} className="flex flex-col gap-1">
                        <span className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate">{item.categoria}</span>
                          <span className="shrink-0 font-mono tabular-nums">{formatMoneyShort(item.total)}</span>
                        </span>
                        <span className="h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden="true">
                          <span className="grow-x block h-full rounded-full bg-agent-finance" style={{ width: `${item.porcentaje}%`, animationDelay: `${index * 0.06}s` }} />
                        </span>
                        <span className="text-xs text-muted">{item.porcentaje.toLocaleString("es-AR")} % de los egresos</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {[
                { id: "fin-cobrar", title: "Por cobrar", empty: "No hay nada pendiente de cobro.", data: receivable },
                { id: "fin-pagar", title: "Por pagar", empty: "No hay pagos pendientes.", data: payable },
              ].map((block) => (
                <section key={block.id} className="card rise-in flex flex-col overflow-hidden" aria-labelledby={block.id}>
                  <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
                    <h2 id={block.id} className="font-semibold">
                      {block.title}
                    </h2>
                    <span className="font-mono text-sm tabular-nums">{formatMoney(block.data.total)}</span>
                  </div>
                  {block.data.items.length === 0 ? (
                    <p className="px-4 py-6 text-sm text-muted sm:px-5">{block.empty}</p>
                  ) : (
                    <ul className="divide-y divide-line">
                      {block.data.items.slice(0, 6).map((item, index) => (
                        <li key={`${item.descripcion}-${index}`} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{item.contraparte ?? item.descripcion}</p>
                            <p className="truncate text-xs text-muted">{item.descripcion}</p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="font-mono text-sm tabular-nums">{formatMoneyShort(item.monto)}</span>
                            {item.vencido ? (
                              <Badge tone="danger" dot>
                                Vencido hace {item.dias} {item.dias === 1 ? "día" : "días"}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted">Vence el {dueDate.format(new Date(`${item.vence}T00:00:00Z`))}</span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              ))}
            </div>
          </>
        )}

        <section className="flex flex-col gap-3" aria-labelledby="fin-agente">
          <div className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-xl bg-agent-finance/15 text-agent-finance" aria-hidden="true">
              <CoinIcon />
            </span>
            <h2 id="fin-agente" className="font-semibold">
              Preguntale a {agentName}
            </h2>
          </div>
          {!agent ? (
            <EmptyState icon={<CoinIcon className="size-6" />} title="Todavía no hay un agente financiero" description="Se crea con la organización; pedíselo al equipo de Orbita AI." />
          ) : !agent.is_enabled ? (
            <EmptyState icon={<CoinIcon className="size-6" />} title={`${agent.name} está apagado`} description="Un superadministrador lo puede encender desde la sección Agentes." />
          ) : (
            <AnalystChat
              agentName={agent.name}
              action={askFinanceAction}
              examples={EXAMPLES}
              toolLabels={TOOL_LABELS}
              intro={`Preguntale a ${agent.name} por los números de la empresa. Responde con los movimientos reales y no modifica nada.`}
            />
          )}
        </section>
      </div>
    </main>
  );
}
