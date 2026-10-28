import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import type { AgentTool } from "@/lib/agent/loop";
import { ROW_LIMIT } from "@/lib/analytics/tools";
import type { Database } from "@/lib/supabase/database.types";

import { byCategory, monthBounds, monthlyTotals, pending, periodTotals, toMovement, type Movement } from "./summary";

// Herramientas del agente financiero (ADR-049). SOLO LECTURA, como las del analítico: leen los movimientos con la
// sesión de quien pregunta (RLS: superadmin y consulta) y hacen las cuentas con las mismas funciones que la página.

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "usá el formato AAAA-MM-DD");

export type FinanceContext = { userClient: SupabaseClient<Database>; today: string };

export async function loadMovements(client: SupabaseClient<Database>): Promise<{ movements: Movement[]; partial: boolean; error: string | null }> {
  const { data, error } = await client
    .from("finance_movements")
    .select("kind, category, description, counterparty, amount, occurred_on, due_on, status")
    .order("occurred_on", { ascending: false })
    .limit(ROW_LIMIT);
  if (error) return { movements: [], partial: false, error: error.message };
  return { movements: (data ?? []).map(toMovement), partial: (data ?? []).length >= ROW_LIMIT, error: null };
}

const rangeProperties = {
  desde: { type: "string", description: "Primer día, AAAA-MM-DD (incluido). Por defecto, el primero del mes de 'hasta'." },
  hasta: { type: "string", description: "Último día, AAAA-MM-DD (incluido). Por defecto, hoy." },
};
const rangeSchema = z.object({ desde: DATE.optional(), hasta: DATE.optional() });
const categorySchema = rangeSchema.extend({ tipo: z.enum(["ingresos", "egresos"]) });
const monthsSchema = z.object({ meses: z.number().int().min(1).max(12).default(6) });
const pendingSchema = z.object({ tipo: z.enum(["por_cobrar", "por_pagar"]), solo_vencidos: z.boolean().default(false) });

function output(data: Record<string, unknown>, partial: boolean): { output: string } {
  return { output: JSON.stringify(partial ? { ...data, aviso: `Se leyeron solo ${ROW_LIMIT} movimientos: los totales pueden ser parciales.` } : data) };
}

function failure(error: string | z.ZodError): { output: string; isError: true } {
  const message = typeof error === "string" ? error : error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  return { output: `No se pudo consultar: ${message}`, isError: true };
}

export function createFinanceTools(context: FinanceContext): AgentTool[] {
  const range = (input: { desde?: string; hasta?: string }) => {
    const to = input.hasta ?? context.today;
    return { from: input.desde ?? monthBounds(to).from, to };
  };

  return [
    {
      name: "resumen_financiero",
      description:
        "Ingresos cobrados, egresos pagados, resultado y margen de un período (criterio de caja). Sirve para 'cómo venimos este mes', 'cuánto ganamos', 'cuánto gastamos'.",
      inputSchema: { type: "object", properties: rangeProperties },
      async run(input) {
        const parsed = rangeSchema.safeParse(input ?? {});
        if (!parsed.success) return failure(parsed.error);
        const { movements, partial, error } = await loadMovements(context.userClient);
        if (error) return failure(error);
        const { from, to } = range(parsed.data);
        return output({ desde: from, hasta: to, moneda: "ARS", ...periodTotals(movements, from, to) }, partial);
      },
    },
    {
      name: "por_categoria",
      description: "Ingresos o egresos de un período desglosados por categoría (ventas online, proveedores, sueldos...), con su porcentaje del total.",
      inputSchema: {
        type: "object",
        properties: { tipo: { type: "string", enum: ["ingresos", "egresos"] }, ...rangeProperties },
        required: ["tipo"],
      },
      async run(input) {
        const parsed = categorySchema.safeParse(input);
        if (!parsed.success) return failure(parsed.error);
        const { movements, partial, error } = await loadMovements(context.userClient);
        if (error) return failure(error);
        const { from, to } = range(parsed.data);
        const kind = parsed.data.tipo === "ingresos" ? "income" : "expense";
        return output({ desde: from, hasta: to, tipo: parsed.data.tipo, moneda: "ARS", categorias: byCategory(movements, kind, from, to) }, partial);
      },
    },
    {
      name: "evolucion_mensual",
      description: "Ingresos, egresos y resultado de cada uno de los últimos meses (incluido el actual). Sirve para tendencias y comparar meses.",
      inputSchema: { type: "object", properties: { meses: { type: "integer", description: "Cuántos meses, de 1 a 12. Por defecto 6." } } },
      async run(input) {
        const parsed = monthsSchema.safeParse(input ?? {});
        if (!parsed.success) return failure(parsed.error);
        const { movements, partial, error } = await loadMovements(context.userClient);
        if (error) return failure(error);
        return output({ moneda: "ARS", nota: "El mes actual está en curso.", meses: monthlyTotals(movements, context.today, parsed.data.meses) }, partial);
      },
    },
    {
      name: "pendientes",
      description:
        "Lo que falta cobrar (por_cobrar) o pagar (por_pagar): total, cuánto está vencido y cada partida con su contraparte, vencimiento y días de atraso.",
      inputSchema: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["por_cobrar", "por_pagar"] },
          solo_vencidos: { type: "boolean", description: "true para traer solo lo vencido." },
        },
        required: ["tipo"],
      },
      async run(input) {
        const parsed = pendingSchema.safeParse(input);
        if (!parsed.success) return failure(parsed.error);
        const { movements, partial, error } = await loadMovements(context.userClient);
        if (error) return failure(error);
        const summary = pending(movements, parsed.data.tipo === "por_cobrar" ? "income" : "expense", context.today);
        const items = parsed.data.solo_vencidos ? summary.items.filter((item) => item.vencido) : summary.items;
        return output({ hoy: context.today, moneda: "ARS", total: summary.total, vencido: summary.vencido, cantidad: summary.cantidad, partidas: items.slice(0, 30) }, partial);
      },
    },
  ];
}
