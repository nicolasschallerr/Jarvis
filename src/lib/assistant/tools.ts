import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createCatalogTools } from "@/lib/agent/catalog-tools";
import type { AgentTool } from "@/lib/agent/loop";
import { createAnalystTools, ROW_LIMIT, zonedMidnight } from "@/lib/analytics/tools";
import { createSupabaseCatalog } from "@/lib/catalog/source";
import { normalize } from "@/lib/catalog/search";
import { createFinanceTools, loadMovements } from "@/lib/finance/tools";
import { monthBounds } from "@/lib/finance/summary";
import type { Database } from "@/lib/supabase/database.types";

// Herramientas del Asistente de la empresa (ADR-050): todas las del analítico, las del financiero y la búsqueda del
// catálogo, más búsquedas con filtros (monto, texto, fechas) sobre movimientos y casos. Todas son de SOLO LECTURA con
// la sesión de quien pregunta: el Asistente ve exactamente lo que esa persona puede ver.

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "usá el formato AAAA-MM-DD");

export type AssistantContext = { userClient: SupabaseClient<Database>; organizationId: string; timeZone: string; today: string };

function output(data: Record<string, unknown>): { output: string } {
  return { output: JSON.stringify(data) };
}

function failure(error: string | z.ZodError): { output: string; isError: true } {
  const message = typeof error === "string" ? error : error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
  return { output: `No se pudo consultar: ${message}`, isError: true };
}

const contains = (haystack: Array<string | null>, needle: string) => {
  const target = normalize(needle);
  return haystack.some((value) => normalize(value).includes(target));
};

const movementsSchema = z.object({
  tipo: z.enum(["ingresos", "egresos", "todos"]).default("todos"),
  texto: z.string().max(80).optional(),
  monto_min: z.number().nonnegative().optional(),
  monto_max: z.number().nonnegative().optional(),
  desde: DATE.optional(),
  hasta: DATE.optional(),
  estado: z.enum(["cobrados_o_pagados", "pendientes", "vencidos", "todos"]).default("todos"),
});

const casesSchema = z.object({
  texto: z.string().max(80).optional(),
  estado: z.enum(["abiertos", "resueltos", "todos"]).default("todos"),
  sector: z.string().max(80).optional(),
  desde: DATE.optional(),
  hasta: DATE.optional(),
});

const contactsSchema = z.object({ desde: DATE.optional(), hasta: DATE.optional() });

const STATUS_LABEL: Record<string, string> = {
  new: "nuevo",
  in_progress: "en curso",
  waiting_contact: "esperando al contacto",
  waiting_area: "esperando al área",
  resolved: "resuelto",
};

export function createAssistantTools(context: AssistantContext): AgentTool[] {
  const { userClient, today, timeZone } = context;

  const searchMovements: AgentTool = {
    name: "buscar_movimientos",
    description:
      "Busca movimientos financieros con filtros: tipo (ingresos/egresos), texto en la categoría, descripción o contraparte (ej. 'préstamo', 'sueldos', un proveedor), rango de monto, fechas y estado. Devuelve cuántos son, el total y las partidas. Sirve para 'cuántos préstamos de 2 millones hicimos este mes', 'cuánto le pagamos a X'. Para un monto exacto usá monto_min y monto_max iguales.",
    inputSchema: {
      type: "object",
      properties: {
        tipo: { type: "string", enum: ["ingresos", "egresos", "todos"] },
        texto: { type: "string", description: "Palabra a buscar en categoría, descripción o contraparte." },
        monto_min: { type: "number", description: "Monto mínimo en pesos (incluido)." },
        monto_max: { type: "number", description: "Monto máximo en pesos (incluido)." },
        desde: { type: "string", description: "Primer día, AAAA-MM-DD. Por defecto, el primero del mes de 'hasta'." },
        hasta: { type: "string", description: "Último día, AAAA-MM-DD. Por defecto, hoy." },
        estado: { type: "string", enum: ["cobrados_o_pagados", "pendientes", "vencidos", "todos"] },
      },
    },
    async run(input) {
      const parsed = movementsSchema.safeParse(input ?? {});
      if (!parsed.success) return failure(parsed.error);
      const filters = parsed.data;
      const { movements, partial, error } = await loadMovements(userClient);
      if (error) return failure(error);
      const to = filters.hasta ?? today;
      const from = filters.desde ?? monthBounds(to).from;

      const found = movements.filter((movement) => {
        if (filters.tipo === "ingresos" && movement.kind !== "income") return false;
        if (filters.tipo === "egresos" && movement.kind !== "expense") return false;
        if (filters.monto_min !== undefined && movement.amount < filters.monto_min) return false;
        if (filters.monto_max !== undefined && movement.amount > filters.monto_max) return false;
        if (filters.texto && !contains([movement.category, movement.description, movement.counterparty], filters.texto)) return false;
        if (filters.estado === "cobrados_o_pagados" && movement.status !== "paid") return false;
        if (filters.estado === "pendientes" && movement.status !== "pending") return false;
        if (filters.estado === "vencidos" && !(movement.status === "pending" && movement.dueOn && movement.dueOn < today)) return false;
        // Lo pendiente se ubica por su vencimiento; lo cobrado o pagado, por su fecha.
        const day = movement.status === "pending" ? (movement.dueOn ?? movement.occurredOn) : movement.occurredOn;
        return day >= from && day <= to;
      });
      const total = found.reduce((sum, movement) => sum + movement.amount, 0);

      return output({
        desde: from,
        hasta: to,
        moneda: "ARS",
        cantidad: found.length,
        total: Math.round(total),
        promedio: found.length ? Math.round(total / found.length) : 0,
        partidas: found.slice(0, 25).map((movement) => ({
          fecha: movement.occurredOn,
          tipo: movement.kind === "income" ? "ingreso" : "egreso",
          categoria: movement.category,
          descripcion: movement.description,
          contraparte: movement.counterparty,
          monto: movement.amount,
          estado: movement.status === "paid" ? "cobrado/pagado" : `pendiente (vence ${movement.dueOn})`,
        })),
        ...(found.length > 25 ? { nota: `Se muestran 25 de ${found.length} partidas; la cantidad y el total son de todas.` } : {}),
        ...(partial ? { aviso: `Se leyeron solo ${ROW_LIMIT} movimientos: los resultados pueden ser parciales.` } : {}),
      });
    },
  };

  const searchCases: AgentTool = {
    name: "buscar_casos",
    description:
      "Busca casos por texto en el título o el resumen (ej. 'garantía', 'crédito', 'envío'), estado, sector y fecha de apertura. Devuelve cuántos son, cómo se reparten por estado y los títulos. No trae datos personales de los contactos.",
    inputSchema: {
      type: "object",
      properties: {
        texto: { type: "string", description: "Palabra a buscar en el título o el resumen del caso." },
        estado: { type: "string", enum: ["abiertos", "resueltos", "todos"] },
        sector: { type: "string", description: "Nombre del sector (o parte)." },
        desde: { type: "string", description: "Primer día de apertura, AAAA-MM-DD. Sin fechas, busca en todos los casos." },
        hasta: { type: "string", description: "Último día de apertura, AAAA-MM-DD." },
      },
    },
    async run(input) {
      const parsed = casesSchema.safeParse(input ?? {});
      if (!parsed.success) return failure(parsed.error);
      const filters = parsed.data;

      let query = userClient.from("cases").select("title, summary, status, priority, sector_id, opened_at, resolved_at").order("opened_at", { ascending: false }).limit(ROW_LIMIT);
      if (filters.estado === "abiertos") query = query.neq("status", "resolved");
      if (filters.estado === "resueltos") query = query.eq("status", "resolved");
      if (filters.desde) query = query.gte("opened_at", zonedMidnight(filters.desde, timeZone).toISOString());
      if (filters.hasta) {
        const next = new Date(`${filters.hasta}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        query = query.lt("opened_at", zonedMidnight(next.toISOString().slice(0, 10), timeZone).toISOString());
      }
      const [{ data, error }, { data: sectors }] = await Promise.all([query, userClient.from("sectors").select("id, name")]);
      if (error) return failure(error.message);

      const sectorName = new Map((sectors ?? []).map((sector) => [sector.id, sector.name]));
      const found = (data ?? []).filter((row) => {
        if (filters.texto && !contains([row.title, row.summary], filters.texto)) return false;
        if (filters.sector && !contains([row.sector_id ? (sectorName.get(row.sector_id) ?? null) : null], filters.sector)) return false;
        return true;
      });
      const byStatus = new Map<string, number>();
      for (const row of found) byStatus.set(STATUS_LABEL[row.status] ?? row.status, (byStatus.get(STATUS_LABEL[row.status] ?? row.status) ?? 0) + 1);

      return output({
        cantidad: found.length,
        por_estado: Object.fromEntries(byStatus),
        casos: found.slice(0, 20).map((row) => ({
          titulo: row.title,
          estado: STATUS_LABEL[row.status] ?? row.status,
          prioridad: row.priority,
          sector: row.sector_id ? (sectorName.get(row.sector_id) ?? "Sector desconocido") : "Sin sector",
          abierto: row.opened_at.slice(0, 10),
        })),
        ...(found.length > 20 ? { nota: `Se muestran 20 de ${found.length} casos.` } : {}),
        ...((data ?? []).length >= ROW_LIMIT ? { aviso: `Se leyeron solo ${ROW_LIMIT} casos: los resultados pueden ser parciales.` } : {}),
      });
    },
  };

  const countContacts: AgentTool = {
    name: "contar_contactos",
    description: "Cuántos contactos tiene la organización y cuántos se sumaron en un período. Solo cantidades, nunca datos personales.",
    inputSchema: {
      type: "object",
      properties: { desde: { type: "string", description: "AAAA-MM-DD" }, hasta: { type: "string", description: "AAAA-MM-DD" } },
    },
    async run(input) {
      const parsed = contactsSchema.safeParse(input ?? {});
      if (!parsed.success) return failure(parsed.error);
      const to = parsed.data.hasta ?? today;
      const from = parsed.data.desde ?? monthBounds(to).from;
      const next = new Date(`${to}T00:00:00Z`);
      next.setUTCDate(next.getUTCDate() + 1);
      const [all, recent] = await Promise.all([
        userClient.from("contacts").select("id", { count: "exact", head: true }).is("merged_into", null),
        userClient
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .is("merged_into", null)
          .gte("created_at", zonedMidnight(from, timeZone).toISOString())
          .lt("created_at", zonedMidnight(next.toISOString().slice(0, 10), timeZone).toISOString()),
      ]);
      if (all.error || recent.error) return failure((all.error ?? recent.error)?.message ?? "error");
      return output({ total: all.count ?? 0, nuevos: recent.count ?? 0, desde: from, hasta: to });
    },
  };

  return [
    ...createAnalystTools({ userClient, timeZone, today }),
    ...createFinanceTools({ userClient, today }),
    ...createCatalogTools(createSupabaseCatalog(userClient, context.organizationId), { label: "catálogo" }),
    searchMovements,
    searchCases,
    countContacts,
  ];
}
