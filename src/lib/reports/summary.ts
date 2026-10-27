import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

// Reportes de gestión (ADR-037): lectura de la función `report_last_days` de la base, con la sesión de quien mira (RLS
// limita a su organización).

export const REPORT_RANGES = [7, 30, 90] as const;
export type ReportDays = (typeof REPORT_RANGES)[number];

export function reportDaysFrom(value: string | string[] | undefined): ReportDays {
  const text = Array.isArray(value) ? value[0] : value;
  return REPORT_RANGES.find((days) => String(days) === text) ?? 30;
}

export type DailyPoint = { day: string; inbound: number; outbound: number; casesCreated: number; casesResolved: number };
export type Count = { name: string; count: number };

export type Report = {
  from: string;
  to: string;
  conversationsNew: number;
  messagesIn: number;
  messagesOutAgent: number;
  messagesOutOperator: number;
  turnsTotal: number;
  turnsAnswered: number;
  responseMedianSeconds: number | null;
  responseP90Seconds: number | null;
  responseMedianSecondsAgent: number | null;
  responseMedianSecondsOperator: number | null;
  answeredByAgent: number;
  answeredByOperator: number;
  casesCreated: number;
  casesResolved: number;
  resolutionMedianHours: number | null;
  openByStatus: Record<string, number>;
  openBySector: Count[];
  openByAssignee: Count[];
  daily: DailyPoint[];
};

const num = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? value : Number(value) || 0);
const numOrNull = (value: unknown): number | null => (value === null || value === undefined || Number.isNaN(Number(value)) ? null : Number(value));
const counts = (value: unknown): Count[] =>
  Array.isArray(value) ? value.map((row) => ({ name: String((row as Record<string, unknown>).name ?? ""), count: num((row as Record<string, unknown>).count) })) : [];

// Convierte lo que devuelve la base (JSON) en un reporte tipado. Tolera campos que falten.
export function parseReport(raw: unknown): Report | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  return {
    from: String(r.from ?? ""),
    to: String(r.to ?? ""),
    conversationsNew: num(r.conversations_new),
    messagesIn: num(r.messages_in),
    messagesOutAgent: num(r.messages_out_agent),
    messagesOutOperator: num(r.messages_out_operator),
    turnsTotal: num(r.turns_total),
    turnsAnswered: num(r.turns_answered),
    responseMedianSeconds: numOrNull(r.response_median_seconds),
    responseP90Seconds: numOrNull(r.response_p90_seconds),
    responseMedianSecondsAgent: numOrNull(r.response_median_seconds_agent),
    responseMedianSecondsOperator: numOrNull(r.response_median_seconds_operator),
    answeredByAgent: num(r.answered_by_agent),
    answeredByOperator: num(r.answered_by_operator),
    casesCreated: num(r.cases_created),
    casesResolved: num(r.cases_resolved),
    resolutionMedianHours: numOrNull(r.resolution_median_hours),
    openByStatus: r.open_by_status && typeof r.open_by_status === "object" ? Object.fromEntries(Object.entries(r.open_by_status as Record<string, unknown>).map(([key, value]) => [key, num(value)])) : {},
    openBySector: counts(r.open_by_sector),
    openByAssignee: counts(r.open_by_assignee),
    daily: Array.isArray(r.daily)
      ? r.daily.map((row) => {
          const d = row as Record<string, unknown>;
          return { day: String(d.day ?? ""), inbound: num(d.inbound), outbound: num(d.outbound), casesCreated: num(d.cases_created), casesResolved: num(d.cases_resolved) };
        })
      : [],
  };
}

// `days` suele ser uno de REPORT_RANGES; el Panorama pide 14. La base lo limita a 1-90.
export async function getReport(params: { userClient: SupabaseClient<Database>; days: number }) {
  const { data, error } = await params.userClient.rpc("report_last_days", { p_days: params.days });
  return { report: parseReport(data), failed: Boolean(error) };
}

// "45 s", "12 min", "3 h 20 min", "2 d": para mostrar tiempos sin decimales raros.
export function durationLabel(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 90) return `${Math.max(1, Math.round(seconds))} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h${minutes % 60 >= 5 ? ` ${minutes % 60} min` : ""}`;
  return `${Math.round(hours / 24)} d`;
}
