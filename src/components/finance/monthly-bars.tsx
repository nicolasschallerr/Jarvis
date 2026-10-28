"use client";

import { useState } from "react";

import { formatMoney, formatMoneyShort, type MonthTotals } from "@/lib/finance/summary";

const monthName = new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: "UTC" });
const monthLong = new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric", timeZone: "UTC" });
const asDate = (month: string) => new Date(`${month}-01T00:00:00Z`);

// Ingresos y egresos por mes, en barras lado a lado (el verde suma, el frambuesa resta). Al pasar el mouse o tocar
// una columna se ven los montos y el resultado. La tabla oculta da los mismos datos a los lectores de pantalla.
export function MonthlyBars({ months }: { months: MonthTotals[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...months.flatMap((month) => [month.ingresos, month.egresos]));
  const current = hover === null ? null : months[hover];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-success" aria-hidden="true" /> Ingresos
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-agent-finance" aria-hidden="true" /> Egresos
        </span>
        <span className="ml-auto min-h-4 tabular-nums text-foreground">
          {current ? (
            <>
              <span className="font-semibold first-letter:uppercase">{monthLong.format(asDate(current.mes))}</span>: resultado{" "}
              <span className={current.resultado >= 0 ? "text-success" : "text-danger"}>{formatMoney(current.resultado)}</span>
            </>
          ) : (
            "Tocá un mes para ver el detalle"
          )}
        </span>
      </div>

      <div className="flex h-48 items-end gap-2 sm:gap-4" aria-hidden="true" onPointerLeave={() => setHover(null)}>
        {months.map((month, index) => (
          <div
            key={month.mes}
            onPointerEnter={() => setHover(index)}
            onClick={() => setHover(index)}
            className={`group flex h-full min-w-0 flex-1 cursor-default flex-col justify-end rounded-lg px-0.5 transition-colors ${hover === index ? "bg-zinc-100 dark:bg-zinc-800/60" : ""}`}
          >
            <div className="flex flex-1 items-end justify-center gap-1">
              <span
                className="grow-y w-full max-w-5 rounded-t-md bg-success transition-[height] duration-500"
                style={{ height: `${(month.ingresos / max) * 100}%`, animationDelay: `${index * 0.05}s` }}
                title={`Ingresos ${formatMoney(month.ingresos)}`}
              />
              <span
                className="grow-y w-full max-w-5 rounded-t-md bg-agent-finance transition-[height] duration-500"
                style={{ height: `${(month.egresos / max) * 100}%`, animationDelay: `${index * 0.05 + 0.03}s` }}
                title={`Egresos ${formatMoney(month.egresos)}`}
              />
            </div>
            <span className="mt-1.5 truncate text-center text-xs text-muted capitalize">{monthName.format(asDate(month.mes)).replace(".", "")}</span>
            <span className={`truncate text-center text-[11px] font-medium tabular-nums ${month.resultado >= 0 ? "text-success" : "text-danger"}`}>
              {formatMoneyShort(month.resultado)}
            </span>
          </div>
        ))}
      </div>

      <table className="sr-only">
        <caption>Ingresos y egresos por mes</caption>
        <thead>
          <tr>
            <th scope="col">Mes</th>
            <th scope="col">Ingresos</th>
            <th scope="col">Egresos</th>
            <th scope="col">Resultado</th>
          </tr>
        </thead>
        <tbody>
          {months.map((month) => (
            <tr key={month.mes}>
              <th scope="row">{monthLong.format(asDate(month.mes))}</th>
              <td>{formatMoney(month.ingresos)}</td>
              <td>{formatMoney(month.egresos)}</td>
              <td>{formatMoney(month.resultado)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
