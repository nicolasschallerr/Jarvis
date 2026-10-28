// Cuentas del agente financiero y de la página Finanzas (ADR-049). Funciones puras sobre los movimientos: la página y
// las herramientas del agente usan las mismas, así el número que muestra la pantalla y el que dice el agente coinciden.
//
// Criterio de caja: un ingreso o egreso cuenta en el mes en que se cobró o se pagó ("paid"). Lo pendiente no suma al
// resultado: va aparte, como cuentas por cobrar (ingresos) o por pagar (egresos), y está vencido si su vencimiento ya
// pasó.

export type MovementKind = "income" | "expense";

export type Movement = {
  kind: MovementKind;
  category: string;
  description: string;
  counterparty: string | null;
  amount: number;
  occurredOn: string; // AAAA-MM-DD
  dueOn: string | null; // AAAA-MM-DD, solo pendientes
  status: "paid" | "pending";
};

export type MovementRow = {
  kind: string;
  category: string;
  description: string;
  counterparty: string | null;
  amount: number | string;
  occurred_on: string;
  due_on: string | null;
  status: string;
};

export function toMovement(row: MovementRow): Movement {
  return {
    kind: row.kind === "expense" ? "expense" : "income",
    category: row.category,
    description: row.description,
    counterparty: row.counterparty,
    amount: Number(row.amount) || 0,
    occurredOn: row.occurred_on,
    dueOn: row.due_on,
    status: row.status === "pending" ? "pending" : "paid",
  };
}

const inRange = (day: string, from: string, to: string) => day >= from && day <= to;
const round2 = (value: number) => Math.round(value * 100) / 100;

export type PeriodTotals = { ingresos: number; egresos: number; resultado: number; margen: number | null; movimientos: number };

// Lo cobrado y lo pagado entre `from` y `to` (ambos incluidos).
export function periodTotals(movements: Movement[], from: string, to: string): PeriodTotals {
  let ingresos = 0;
  let egresos = 0;
  let count = 0;
  for (const movement of movements) {
    if (movement.status !== "paid" || !inRange(movement.occurredOn, from, to)) continue;
    count += 1;
    if (movement.kind === "income") ingresos += movement.amount;
    else egresos += movement.amount;
  }
  const resultado = ingresos - egresos;
  return {
    ingresos: round2(ingresos),
    egresos: round2(egresos),
    resultado: round2(resultado),
    margen: ingresos > 0 ? Math.round((resultado / ingresos) * 1000) / 10 : null,
    movimientos: count,
  };
}

export type CategoryTotal = { categoria: string; total: number; porcentaje: number };

// Cobrado o pagado por categoría en el período, de mayor a menor.
export function byCategory(movements: Movement[], kind: MovementKind, from: string, to: string): CategoryTotal[] {
  const totals = new Map<string, number>();
  for (const movement of movements) {
    if (movement.kind !== kind || movement.status !== "paid" || !inRange(movement.occurredOn, from, to)) continue;
    totals.set(movement.category, (totals.get(movement.category) ?? 0) + movement.amount);
  }
  const sum = [...totals.values()].reduce((total, value) => total + value, 0);
  return [...totals.entries()]
    .map(([categoria, total]) => ({ categoria, total: round2(total), porcentaje: sum > 0 ? Math.round((total / sum) * 1000) / 10 : 0 }))
    .sort((a, b) => b.total - a.total || a.categoria.localeCompare(b.categoria, "es"));
}

export type MonthTotals = { mes: string; ingresos: number; egresos: number; resultado: number };

// Los últimos `months` meses hasta el de `today` (incluido), con cero en los meses sin movimientos.
export function monthlyTotals(movements: Movement[], today: string, months: number): MonthTotals[] {
  const keys: string[] = [];
  const [year, month] = today.split("-").map(Number) as [number, number];
  for (let offset = months - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(year, month - 1 - offset, 1));
    keys.push(date.toISOString().slice(0, 7));
  }
  const rows = new Map(keys.map((key) => [key, { mes: key, ingresos: 0, egresos: 0, resultado: 0 }]));
  for (const movement of movements) {
    if (movement.status !== "paid") continue;
    const row = rows.get(movement.occurredOn.slice(0, 7));
    if (!row) continue;
    if (movement.kind === "income") row.ingresos += movement.amount;
    else row.egresos += movement.amount;
  }
  return keys.map((key) => {
    const row = rows.get(key) as MonthTotals;
    return { mes: key, ingresos: round2(row.ingresos), egresos: round2(row.egresos), resultado: round2(row.ingresos - row.egresos) };
  });
}

export type PendingItem = {
  descripcion: string;
  contraparte: string | null;
  categoria: string;
  monto: number;
  vence: string;
  dias: number; // positivo: días de atraso; negativo: días que faltan
  vencido: boolean;
};

export type PendingSummary = { total: number; vencido: number; cantidad: number; items: PendingItem[] };

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

// Lo que falta cobrar (income) o pagar (expense): primero lo vencido, del más atrasado al menos; después lo que vence.
export function pending(movements: Movement[], kind: MovementKind, today: string): PendingSummary {
  const items = movements
    .filter((movement) => movement.kind === kind && movement.status === "pending" && movement.dueOn)
    .map((movement): PendingItem => {
      const dias = daysBetween(movement.dueOn as string, today);
      return {
        descripcion: movement.description,
        contraparte: movement.counterparty,
        categoria: movement.category,
        monto: round2(movement.amount),
        vence: movement.dueOn as string,
        dias,
        vencido: dias > 0,
      };
    })
    .sort((a, b) => b.dias - a.dias || b.monto - a.monto);
  return {
    total: round2(items.reduce((sum, item) => sum + item.monto, 0)),
    vencido: round2(items.filter((item) => item.vencido).reduce((sum, item) => sum + item.monto, 0)),
    cantidad: items.length,
    items,
  };
}

// Primer y último día del mes de `day`.
export function monthBounds(day: string): { from: string; to: string } {
  const [year, month] = day.split("-").map(Number) as [number, number];
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = day.slice(0, 7);
  return { from: `${prefix}-01`, to: `${prefix}-${String(last).padStart(2, "0")}` };
}

export function formatMoney(value: number): string {
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 }).format(value);
}

// "$ 18,5 M", "$ 950 mil": para los tiles, donde la cifra entera no entra.
export function formatMoneyShort(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}$ ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(abs / 1_000_000)} M`;
  if (abs >= 1_000) return `${sign}$ ${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 0 }).format(abs / 1_000)} mil`;
  return `${sign}$ ${Math.round(abs)}`;
}
