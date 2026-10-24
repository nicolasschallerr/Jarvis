import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

const DEFAULT_TIME_ZONE = "America/Argentina/Buenos_Aires";
const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

// La fecha de hoy (AAAA-MM-DD) en la zona horaria de la organización, no en la del servidor.
export function todayIn(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export type MonthRange = {
  // AAAA-MM del mes que se muestra.
  month: string;
  // Primer y último día que se consulta (el último, hasta hoy si es el mes en curso).
  from: string;
  to: string;
  // Meses vecinos para navegar; el siguiente es null si ya es el mes en curso.
  previous: string;
  next: string | null;
  isCurrent: boolean;
};

function shiftMonth(month: string, delta: number): string {
  const match = MONTH_PATTERN.exec(month);
  const total = Number(match?.[1]) * 12 + (Number(match?.[2]) - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

function lastDayOf(month: string): string {
  const match = MONTH_PATTERN.exec(month);
  const day = new Date(Date.UTC(Number(match?.[1]), Number(match?.[2]), 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, "0")}`;
}

// El mes a mostrar: el pedido si es válido y no es futuro, y si no el mes en curso. Para el mes en curso la
// consulta llega hasta hoy.
export function resolveMonth(requested: string | undefined, today: string): MonthRange {
  const currentMonth = today.slice(0, 7);
  const month = requested && MONTH_PATTERN.test(requested) && requested <= currentMonth ? requested : currentMonth;
  const isCurrent = month === currentMonth;

  return {
    month,
    from: `${month}-01`,
    to: isCurrent ? today : lastDayOf(month),
    previous: shiftMonth(month, -1),
    next: isCurrent ? null : shiftMonth(month, 1),
    isCurrent,
  };
}

export type ConsumptionDay = Database["public"]["Functions"]["consumption_by_day"]["Returns"][number];

export type ConsumptionTotals = {
  credits: number;
  windows: number;
  windowsByContact: number;
  windowsByBusiness: number;
  aiCalls: number;
  aiErrors: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  // Llamadas de IA sin costo calculado (el cliente no configuró los precios): el costo total las deja afuera.
  callsWithoutCost: number;
};

export function totalsOf(days: ConsumptionDay[]): ConsumptionTotals {
  const totals: ConsumptionTotals = {
    credits: 0,
    windows: 0,
    windowsByContact: 0,
    windowsByBusiness: 0,
    aiCalls: 0,
    aiErrors: 0,
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    callsWithoutCost: 0,
  };

  for (const day of days) {
    totals.credits += day.credits;
    totals.windows += day.windows;
    totals.windowsByContact += day.windows_by_contact;
    totals.windowsByBusiness += day.windows_by_business;
    totals.aiCalls += day.ai_calls;
    totals.aiErrors += day.ai_errors;
    totals.inputTokens += Number(day.input_tokens);
    totals.outputTokens += Number(day.output_tokens);
    totals.costUsd += Number(day.cost_usd);
    totals.callsWithoutCost += day.calls_without_cost;
  }
  return totals;
}

// Consumo de un mes, día por día, y sus totales. Se lee con la sesión del usuario: RLS decide qué ve.
export async function getConsumption(params: {
  userClient: SupabaseClient<Database>;
  requestedMonth: string | undefined;
  now?: Date;
}) {
  const { data: organization } = await params.userClient.from("organizations").select("timezone").maybeSingle();
  const timeZone = organization?.timezone ?? DEFAULT_TIME_ZONE;
  const range = resolveMonth(params.requestedMonth, todayIn(timeZone, params.now ?? new Date()));

  const { data, error } = await params.userClient.rpc("consumption_by_day", { p_from: range.from, p_to: range.to });
  const days = data ?? [];

  return { range, timeZone, days, totals: totalsOf(days), failed: Boolean(error) };
}
