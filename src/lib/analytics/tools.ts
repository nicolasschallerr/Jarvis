import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { AgentTool } from "@/lib/agent/loop";
import { totalsOf } from "@/lib/crm/consumption";
import type { Database } from "@/lib/supabase/database.types";

// Herramientas del agente analítico. Son de SOLO LECTURA por construcción: cada una hace un `select` con la
// sesión de quien pregunta (RLS decide qué ve) y ninguna recibe SQL del modelo. Devuelven números y nombres de
// sectores, unidades o personas del equipo; nunca datos personales de asociados (nombres, documentos, mensajes).

// Tope de filas que se leen por consulta. Coincide con el máximo que devuelve la API de la base
// (supabase/config.toml, max_rows = 1000): pedir más no trae más. Si se alcanza, la respuesta lo avisa para no
// presentar un recuento parcial como si fuera total.
export const ROW_LIMIT = 1000;

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "usá el formato AAAA-MM-DD");

export type AnalystContext = {
  userClient: SupabaseClient<Database>;
  timeZone: string;
  // Hoy (AAAA-MM-DD) en la zona horaria de la organización.
  today: string;
};

// Medianoche de una fecha en la zona horaria de la organización, como instante UTC.
export function zonedMidnight(date: string, timeZone: string): Date {
  const utc = new Date(`${date}T00:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(utc);
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asLocal = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(utc.getTime() - (asLocal - utc.getTime()));
}

function dayLabel(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

// Rango [desde, hasta] (ambos días incluidos) como instantes. Por defecto, desde el primero del mes hasta hoy.
function rangeOf(input: { desde?: string; hasta?: string }, context: AnalystContext): { from: string; to: string; fromDate: string; toDate: string } {
  const toDate = input.hasta ?? context.today;
  const fromDate = input.desde ?? `${toDate.slice(0, 7)}-01`;
  const nextDay = new Date(`${toDate}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  return {
    fromDate,
    toDate,
    from: zonedMidnight(fromDate, context.timeZone).toISOString(),
    to: zonedMidnight(nextDay.toISOString().slice(0, 10), context.timeZone).toISOString(),
  };
}

function count<T>(items: T[], key: (item: T) => string): Array<{ grupo: string; total: number }> {
  const totals = new Map<string, number>();
  for (const item of items) totals.set(key(item), (totals.get(key(item)) ?? 0) + 1);
  return [...totals.entries()].map(([grupo, total]) => ({ grupo, total })).sort((a, b) => b.total - a.total || a.grupo.localeCompare(b.grupo, "es"));
}

function hours(from: string, to: string): number {
  return (new Date(to).getTime() - new Date(from).getTime()) / 3_600_000;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? (sorted[middle] ?? null) : (((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

async function names(client: SupabaseClient<Database>, table: "sectors" | "business_units"): Promise<Map<string, string>> {
  const { data } = await client.from(table).select("id, name");
  return new Map((data ?? []).map((row) => [row.id, row.name]));
}

async function staffNames(client: SupabaseClient<Database>): Promise<Map<string, string>> {
  const { data } = await client.from("profiles").select("id, full_name");
  return new Map((data ?? []).map((row) => [row.id, row.full_name]));
}

const dateRangeProperties = {
  desde: { type: "string", description: "Primer día, AAAA-MM-DD (incluido). Por defecto, el primero del mes de 'hasta'." },
  hasta: { type: "string", description: "Último día, AAAA-MM-DD (incluido). Por defecto, hoy." },
};

function output(data: Record<string, unknown>): { output: string } {
  return { output: JSON.stringify(data) };
}

function failure(error: { message: string } | z.ZodError): { output: string; isError: true } {
  const message = "issues" in error ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") : error.message;
  return { output: `No se pudo consultar: ${message}`, isError: true };
}

const casesSchema = z.object({
  agrupar_por: z.enum(["estado", "sector", "prioridad", "unidad", "asignado", "dia_de_apertura"]),
  desde: DATE.optional(),
  hasta: DATE.optional(),
  solo_abiertos: z.boolean().default(false),
});

const rangeSchema = z.object({ desde: DATE.optional(), hasta: DATE.optional() });

export function createAnalystTools(context: AnalystContext): AgentTool[] {
  const { userClient } = context;

  return [
    {
      name: "contar_casos",
      description:
        "Cuenta los casos abiertos en un período (por fecha de apertura) agrupados por estado, sector, prioridad, unidad de negocio, persona asignada o día. Sirve para 'cuántos casos hay', 'cuáles sectores tienen más', 'cuántos sin asignar'.",
      inputSchema: {
        type: "object",
        properties: {
          agrupar_por: { type: "string", enum: ["estado", "sector", "prioridad", "unidad", "asignado", "dia_de_apertura"] },
          ...dateRangeProperties,
          solo_abiertos: { type: "boolean", description: "true para contar solo los casos que todavía no se resolvieron." },
        },
        required: ["agrupar_por"],
      },
      async run(input) {
        const parsed = casesSchema.safeParse(input);
        if (!parsed.success) return failure(parsed.error);
        const range = rangeOf(parsed.data, context);

        let query = userClient
          .from("cases")
          .select("status, priority, sector_id, unit_id, assigned_to, opened_at")
          .gte("opened_at", range.from)
          .lt("opened_at", range.to)
          .limit(ROW_LIMIT);
        if (parsed.data.solo_abiertos) query = query.neq("status", "resolved");
        const { data, error } = await query;
        if (error) return failure(error);

        const rows = data ?? [];
        const [sectors, units, staff] = await Promise.all([names(userClient, "sectors"), names(userClient, "business_units"), staffNames(userClient)]);

        const key = (row: (typeof rows)[number]): string => {
          switch (parsed.data.agrupar_por) {
            case "estado":
              return row.status;
            case "prioridad":
              return row.priority;
            case "sector":
              return row.sector_id ? (sectors.get(row.sector_id) ?? "Sector desconocido") : "Sin sector";
            case "unidad":
              return row.unit_id ? (units.get(row.unit_id) ?? "Unidad desconocida") : "Sin unidad";
            case "asignado":
              return row.assigned_to ? (staff.get(row.assigned_to) ?? "Persona desconocida") : "Sin asignar";
            case "dia_de_apertura":
              return dayLabel(row.opened_at, context.timeZone);
          }
        };

        return output({
          desde: range.fromDate,
          hasta: range.toDate,
          total: rows.length,
          grupos: count(rows, key),
          ...(rows.length >= ROW_LIMIT ? { aviso: `Se leyeron solo ${ROW_LIMIT} casos: el total puede ser mayor.` } : {}),
        });
      },
    },
    {
      name: "tiempos_de_resolucion",
      description:
        "Calcula cuánto tardaron en resolverse los casos que se resolvieron en un período: promedio y mediana en horas, en total y por sector.",
      inputSchema: { type: "object", properties: dateRangeProperties },
      async run(input) {
        const parsed = rangeSchema.safeParse(input);
        if (!parsed.success) return failure(parsed.error);
        const range = rangeOf(parsed.data, context);

        const { data, error } = await userClient
          .from("cases")
          .select("opened_at, resolved_at, sector_id")
          .eq("status", "resolved")
          .gte("resolved_at", range.from)
          .lt("resolved_at", range.to)
          .limit(ROW_LIMIT);
        if (error) return failure(error);

        const sectors = await names(userClient, "sectors");
        const rows = (data ?? []).filter((row): row is typeof row & { resolved_at: string } => row.resolved_at !== null);
        const all = rows.map((row) => hours(row.opened_at, row.resolved_at));

        const bySector = new Map<string, number[]>();
        for (const row of rows) {
          const name = row.sector_id ? (sectors.get(row.sector_id) ?? "Sector desconocido") : "Sin sector";
          bySector.set(name, [...(bySector.get(name) ?? []), hours(row.opened_at, row.resolved_at)]);
        }

        const average = (values: number[]) => (values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null);

        return output({
          desde: range.fromDate,
          hasta: range.toDate,
          resueltos: rows.length,
          promedio_horas: average(all),
          mediana_horas: median(all) === null ? null : round(median(all) ?? 0),
          por_sector: [...bySector.entries()]
            .map(([sector, values]) => ({ sector, resueltos: values.length, promedio_horas: average(values) }))
            .sort((a, b) => b.resueltos - a.resueltos),
          ...(rows.length >= ROW_LIMIT ? { aviso: `Se leyeron solo ${ROW_LIMIT} casos: los valores pueden variar.` } : {}),
        });
      },
    },
    {
      name: "contar_conversaciones",
      description:
        "Cuenta las conversaciones que hay hoy: total, por canal, cuántas esperan una respuesta del equipo y cuántas tienen una ventana de 24 h abierta. Es una foto del momento, no un histórico.",
      inputSchema: { type: "object", properties: {} },
      async run() {
        const { data, error } = await userClient.from("conversation_summaries").select("channel_type, last_direction, window_open").limit(ROW_LIMIT);
        if (error) return failure(error);

        const rows = data ?? [];
        return output({
          total: rows.length,
          por_canal: count(rows, (row) => row.channel_type ?? "desconocido"),
          esperando_respuesta_del_equipo: rows.filter((row) => row.last_direction === "inbound").length,
          con_ventana_abierta: rows.filter((row) => row.window_open).length,
          ...(rows.length >= ROW_LIMIT ? { aviso: `Se leyeron solo ${ROW_LIMIT} conversaciones.` } : {}),
        });
      },
    },
    {
      name: "consultas_al_area",
      description:
        "Resume las consultas que el agente de atención le hizo a los sectores en un período: cuántas, cuántas siguen pendientes y cuánto tardó cada sector en responder (promedio en horas).",
      inputSchema: { type: "object", properties: dateRangeProperties },
      async run(input) {
        const parsed = rangeSchema.safeParse(input);
        if (!parsed.success) return failure(parsed.error);
        const range = rangeOf(parsed.data, context);

        const { data, error } = await userClient
          .from("area_queries")
          .select("sector_id, status, created_at, answered_at")
          .gte("created_at", range.from)
          .lt("created_at", range.to)
          .limit(ROW_LIMIT);
        if (error) return failure(error);

        const sectors = await names(userClient, "sectors");
        const rows = data ?? [];
        const grouped = new Map<string, typeof rows>();
        for (const row of rows) {
          const name = sectors.get(row.sector_id) ?? "Sector desconocido";
          grouped.set(name, [...(grouped.get(name) ?? []), row]);
        }

        return output({
          desde: range.fromDate,
          hasta: range.toDate,
          total: rows.length,
          ...(rows.length >= ROW_LIMIT ? { aviso: `Se leyeron solo ${ROW_LIMIT} consultas: el total puede ser mayor.` } : {}),
          por_sector: [...grouped.entries()]
            .map(([sector, items]) => {
              const waits = items.filter((item) => item.answered_at !== null).map((item) => hours(item.created_at, item.answered_at ?? item.created_at));
              return {
                sector,
                consultas: items.length,
                pendientes: items.filter((item) => item.status === "pending").length,
                respondidas: waits.length,
                promedio_horas_hasta_responder: waits.length ? round(waits.reduce((sum, value) => sum + value, 0) / waits.length) : null,
              };
            })
            .sort((a, b) => b.consultas - a.consultas),
        });
      },
    },
    {
      name: "resumen_de_consumo",
      description:
        "Resume el consumo de un período (máximo 93 días): créditos usados (conversaciones de 24 h), llamadas a la IA, tokens y costo estimado en dólares si hay precios configurados.",
      inputSchema: { type: "object", properties: dateRangeProperties },
      async run(input) {
        const parsed = rangeSchema.safeParse(input);
        if (!parsed.success) return failure(parsed.error);
        const range = rangeOf(parsed.data, context);

        const { data, error } = await userClient.rpc("consumption_by_day", { p_from: range.fromDate, p_to: range.toDate });
        if (error) return failure(error);
        if (!data || data.length === 0) return failure({ message: "El período tiene que tener entre 1 y 93 días." });

        const totals = totalsOf(data);
        return output({
          desde: range.fromDate,
          hasta: range.toDate,
          dias: data.length,
          creditos: totals.credits,
          conversaciones_iniciadas_por_el_asociado: totals.windowsByContact,
          conversaciones_iniciadas_por_la_organizacion: totals.windowsByBusiness,
          llamadas_a_ia: totals.aiCalls,
          llamadas_a_ia_con_error: totals.aiErrors,
          tokens_de_entrada: totals.inputTokens,
          tokens_de_salida: totals.outputTokens,
          costo_estimado_usd: totals.costUsd,
          llamadas_sin_precio: totals.callsWithoutCost,
        });
      },
    },
  ];
}
