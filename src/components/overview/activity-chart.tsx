"use client";

import { useState } from "react";

export type ActivityPoint = { day: string; inbound: number; outbound: number };

const SERIES = [
  { key: "inbound", name: "Recibidos", color: "var(--agent-sinapsis)" },
  { key: "outbound", name: "Enviados", color: "var(--accent)" },
] as const;

const W = 600;
const H = 180;
const PAD = { top: 12, bottom: 4 };

const dayLabel = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

// Mensajes por día: dos líneas con su área, que se dibujan al aparecer. Al pasar el mouse (o el dedo) una línea vertical
// marca el día y una ficha muestra los dos números. La tabla de abajo (oculta a la vista) da los mismos datos a los
// lectores de pantalla.
export function ActivityChart({ points }: { points: ActivityPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...points.flatMap((point) => [point.inbound, point.outbound]));
  const step = points.length > 1 ? W / (points.length - 1) : W;
  const x = (index: number) => index * step;
  const y = (value: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - value / max);

  const line = (key: "inbound" | "outbound") => points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point[key])}`).join(" ");
  const area = (key: "inbound" | "outbound") => `${line(key)} L${x(points.length - 1)},${H} L0,${H} Z`;

  function pick(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
  }

  const current = hover === null ? null : points[hover];

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex gap-4 text-xs text-muted">
        {SERIES.map((series) => (
          <li key={series.key} className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: series.color }} aria-hidden="true" />
            {series.name}
          </li>
        ))}
      </ul>

      <div className="relative h-44 touch-none" onPointerMove={pick} onPointerLeave={() => setHover(null)} aria-hidden="true">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          <defs>
            {SERIES.map((series) => (
              <linearGradient key={series.key} id={`area-${series.key}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={series.color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={series.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line key={ratio} x1="0" x2={W} y1={PAD.top + (H - PAD.top) * ratio} y2={PAD.top + (H - PAD.top) * ratio} className="stroke-line" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1="0" x2={W} y1={H} y2={H} className="stroke-line" vectorEffect="non-scaling-stroke" />
          {SERIES.map((series) => (
            <path key={`a-${series.key}`} d={area(series.key)} fill={`url(#area-${series.key})`} className="fade-in" />
          ))}
          {SERIES.map((series) => (
            <path
              key={`l-${series.key}`}
              d={line(series.key)}
              fill="none"
              stroke={series.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              pathLength={1}
              className="draw-line"
            />
          ))}
          {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1="0" y2={H} className="stroke-muted" strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null}
        </svg>

        {/* Los puntos van en HTML para que sean redondos aunque el gráfico se estire. */}
        {current && hover !== null
          ? SERIES.map((series) => (
              <span
                key={series.key}
                className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
                style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(current[series.key]) / H) * 100}%`, background: series.color }}
              />
            ))
          : null}

        {current && hover !== null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > points.length / 2 ? "calc(-100% - 12px)" : "12px"})` }}
          >
            <p className="mb-1 font-semibold first-letter:uppercase">{dayLabel.format(asDate(current.day))}</p>
            {SERIES.map((series) => (
              <p key={series.key} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-muted">
                  <span className="size-2 rounded-full" style={{ background: series.color }} />
                  {series.name}
                </span>
                <span className="font-mono font-semibold">{current[series.key]}</span>
              </p>
            ))}
          </div>
        ) : null}
      </div>

      <div className="flex justify-between font-mono text-[11px] text-muted" aria-hidden="true">
        <span>{points[0] ? shortDay.format(asDate(points[0].day)) : ""}</span>
        <span>{points.at(-1) ? shortDay.format(asDate(points.at(-1)?.day ?? "")) : ""}</span>
      </div>

      <table className="sr-only">
        <caption>Mensajes por día</caption>
        <thead>
          <tr>
            <th scope="col">Día</th>
            <th scope="col">Recibidos</th>
            <th scope="col">Enviados</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.day}>
              <th scope="row">{dayLabel.format(asDate(point.day))}</th>
              <td>{point.inbound}</td>
              <td>{point.outbound}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
