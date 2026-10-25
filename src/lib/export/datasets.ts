import type { SupabaseClient } from "@supabase/supabase-js";

import { actorLabel, describeAudit, listAudit } from "@/lib/audit/list";
import { getConsumption } from "@/lib/crm/consumption";
import { listContacts } from "@/lib/crm/contact-directory";
import { channelLabel, PRIORITY_LABELS, STATUS_LABELS } from "@/lib/crm/format";
import type { Database } from "@/lib/supabase/database.types";

import { toCsv, type CsvCell } from "./csv";

// Exportaciones a CSV (ADR-035). Todo se lee con la sesión de quien exporta, así que RLS limita a su organización.
// Los datos personales (contactos) y el registro de auditoría son solo del superadmin; casos y consumo, también de
// consulta y reportes. El operador no exporta: ve lo suyo en pantalla.

export const EXPORT_MAX_ROWS = 5000;

export const EXPORT_TYPES = ["casos", "contactos", "consumo", "auditoria"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

type Role = "superadmin" | "operator" | "viewer";

const ALLOWED: Record<ExportType, Role[]> = {
  casos: ["superadmin", "viewer"],
  contactos: ["superadmin"],
  consumo: ["superadmin", "viewer"],
  auditoria: ["superadmin"],
};

export function isExportType(value: string): value is ExportType {
  return (EXPORT_TYPES as readonly string[]).includes(value);
}

export function canExport(role: Role, type: ExportType): boolean {
  return ALLOWED[type].includes(role);
}

export type ExportResult = { csv: string; rows: number; truncated: boolean };

// Fecha y hora en la zona de Argentina, "2026-10-25 14:03" (se ordena bien en una planilla).
const dateFormat = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/Argentina/Buenos_Aires",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function exportDate(iso: string | null | undefined): string {
  return iso ? dateFormat.format(new Date(iso)) : "";
}

type Client = SupabaseClient<Database>;

export async function casesCsv(userClient: Client): Promise<ExportResult> {
  const { data, error } = await userClient
    .from("cases")
    .select("title, status, priority, opened_at, resolved_at, updated_at, contacts(display_name), sectors(name), assignee:profiles!cases_assigned_to_fkey(full_name)")
    .order("opened_at", { ascending: false })
    .limit(EXPORT_MAX_ROWS + 1);
  if (error) throw new Error(`No se pudieron leer los casos: ${error.message}`);

  const rows = (data ?? []).slice(0, EXPORT_MAX_ROWS);
  return {
    csv: toCsv(
      ["Título", "Estado", "Prioridad", "Sector", "Asignado a", "Contacto", "Abierto", "Resuelto", "Última actividad"],
      rows.map((row) => [
        row.title ?? "",
        STATUS_LABELS[row.status] ?? row.status,
        PRIORITY_LABELS[row.priority] ?? row.priority,
        row.sectors?.name ?? "",
        row.assignee?.full_name ?? "",
        row.contacts?.display_name ?? "",
        exportDate(row.opened_at),
        exportDate(row.resolved_at),
        exportDate(row.updated_at),
      ]),
    ),
    rows: rows.length,
    truncated: (data?.length ?? 0) > EXPORT_MAX_ROWS,
  };
}

export async function contactsCsv(userClient: Client): Promise<ExportResult> {
  const { items, hasMore, failed } = await listContacts({ userClient, search: "", limit: EXPORT_MAX_ROWS });
  if (failed) throw new Error("No se pudieron leer los contactos");

  return {
    csv: toCsv(
      ["Nombre", "Documento", "Localidad", "Canales", "Conversaciones", "Último mensaje"],
      items.map((contact) => [
        contact.displayName ?? "",
        contact.documentNumber ?? "",
        contact.locality ?? "",
        contact.channels.map((channel) => `${channelLabel(channel.channelType)} ${channel.identifier}`).join("; "),
        contact.conversations,
        exportDate(contact.lastMessageAt),
      ]),
    ),
    rows: items.length,
    truncated: hasMore,
  };
}

export async function consumptionCsv(userClient: Client, month: string | undefined): Promise<ExportResult> {
  const { range, days, totals, failed } = await getConsumption({ userClient, requestedMonth: month });
  if (failed) throw new Error("No se pudo leer el consumo");

  const rows: CsvCell[][] = days.map((day) => [
    day.day,
    day.credits,
    day.ai_calls,
    Number(day.input_tokens),
    Number(day.output_tokens),
    Number(day.cost_usd),
  ]);
  rows.push(["Total " + range.month, totals.credits, totals.aiCalls, totals.inputTokens, totals.outputTokens, totals.costUsd]);

  return {
    csv: toCsv(["Día", "Créditos", "Llamadas a IA", "Tokens de entrada", "Tokens de salida", "Costo estimado (USD)"], rows),
    rows: days.length,
    truncated: false,
  };
}

export async function auditCsv(userClient: Client): Promise<ExportResult> {
  const { items, hasMore, names, failed } = await listAudit({ userClient, group: "todo", limit: EXPORT_MAX_ROWS });
  if (failed) throw new Error("No se pudo leer el registro de auditoría");

  return {
    csv: toCsv(
      ["Fecha", "Quién", "Qué pasó", "Acción"],
      items.map((item) => [exportDate(item.createdAt), actorLabel(item, names), describeAudit(item, names), item.action]),
    ),
    rows: items.length,
    truncated: hasMore,
  };
}
