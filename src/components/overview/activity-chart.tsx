"use client";

import { useId, useState } from "react";

export type ActivityPoint = { day: string; inbound: number; outbound: number };

// Una serie del gráfico: qué campo del punto dibuja, cómo se llama y de qué color va (un color CSS, ej. "var(--accent)").
export type ChartSeries<P extends { day: string }> = { key: Exclude<keyof P, "day"> & string; name: string; color: string };

// Por defecto, los mensajes del Panorama: recibidos y enviados.
const MESSAGE_SERIES: ChartSeries<ActivityPoint>[] = [
  { key: "inbound", name: "Recibidos", color: "var(--agent-sinapsis)" },
  { key: "outbound", name: "Enviados", color: "var(--accent)" },
];

const W = 600;
const H = 180;
const PAD = { top: 12, bottom: 4 };

const dayLabel = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const shortDay = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

// Datos por día: una línea con su área por serie, que se dibujan al aparecer. Al pasar el mouse (o el dedo) una línea
// vertical marca el día y una ficha muestra los números. La tabla de abajo (oculta a la vista) da los mismos datos, con
// todas las series, a los lectores de pantalla. Sin `series` dibuja los mensajes recibidos y enviados (el Panorama).
export function ActivityChart<P extends { day: string }>({ points, series, caption = "Mensajes por día" }: { points: P[]; series?: ChartSeries<P>[]; caption?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  // Ids únicos por gráfico: con dos en la misma página, los degradados no se pisan.
  const uid = useId();
  const lines = (series ?? MESSAGE_SERIES) as unknown as ChartSeries<P>[];
  const value = (point: P, key: string) => Number((point as Record<string, unknown>)[key]) || 0;

  const max = Math.max(1, ...points.flatMap((point) => lines.map((item) => value(point, item.key))));
  const step = points.length > 1 ? W / (points.length - 1) : W;
  const x = (index: number) => index * step;
  const y = (amount: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - amount / max);

  const line = (key: string) => points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(value(point, key))}`).join(" ");
  const area = (key: string) => `${line(key)} L${x(points.length - 1)},${H} L0,${H} Z`;
  const gradientId = (key: string) => `area-${uid.replace(/:/g, "")}-${key}`;

  function pick(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    setHover(Math.max(0, Math.min(points.length - 1, Math.round(ratio * (points.length - 1)))));
  }

  const current = hover === null ? null : points[hover];

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-4 text-xs text-muted">
        {lines.map((item) => (
          <li key={item.key} className="flex items-center gap-1.5">
            <span className="h-0.5 w-3 rounded-full" style={{ background: item.color }} aria-hidden="true" />
            {item.name}
          </li>
        ))}
      </ul>

      <div className="relative h-44 touch-none" onPointerMove={pick} onPointerLeave={() => setHover(null)} aria-hidden="true">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
          <defs>
            {lines.map((item) => (
              <linearGradient key={item.key} id={gradientId(item.key)} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={item.color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={item.color} stopOpacity="0" />
              </linearGradient>
            ))}
          </defs>
          {[0.25, 0.5, 0.75].map((ratio) => (
            <line key={ratio} x1="0" x2={W} y1={PAD.top + (H - PAD.top) * ratio} y2={PAD.top + (H - PAD.top) * ratio} className="stroke-line" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1="0" x2={W} y1={H} y2={H} className="stroke-line" vectorEffect="non-scaling-stroke" />
          {lines.map((item) => (
            <path key={`a-${item.key}`} d={area(item.key)} fill={`url(#${gradientId(item.key)})`} className="fade-in" />
          ))}
          {lines.map((item) => (
            <path
              key={`l-${item.key}`}
              d={line(item.key)}
              fill="none"
              stroke={item.color}
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
          ? lines.map((item) => (
              <span
                key={item.key}
                className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface"
                style={{ left: `${(x(hover) / W) * 100}%`, top: `${(y(value(current, item.key)) / H) * 100}%`, background: item.color }}
              />
            ))
          : null}

        {current && hover !== null ? (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
            style={{ left: `${(x(hover) / W) * 100}%`, transform: `translateX(${hover > points.length / 2 ? "calc(-100% - 12px)" : "12px"})` }}
          >
            <p className="mb-1 font-semibold first-letter:uppercase">{dayLabel.format(asDate(current.day))}</p>
            {lines.map((item) => (
              <p key={item.key} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-1.5 text-muted">
                  <span className="size-2 rounded-full" style={{ background: item.color }} />
                  {item.name}
                </span>
                <span className="font-mono font-semibold">{value(current, item.key)}</span>
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
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">Día</th>
            {lines.map((item) => (
              <th key={item.key} scope="col">
                {item.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.day}>
              <th scope="row">{dayLabel.format(asDate(point.day))}</th>
              {lines.map((item) => (
                <td key={item.key}>{value(point, item.key)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
