import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

// Bandeja de conversaciones: filtros, búsqueda y paginación. Todo se lee con la sesión del usuario (RLS) desde la
// vista conversation_summaries.

export const INBOX_FILTERS = ["todas", "esperando", "mias", "sin-asignar", "ia-pausada"] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const INBOX_PAGE_SIZE = 50;
const MAX_LIMIT = 500;

// Canales por los que se puede filtrar la bandeja.
export const INBOX_CHANNELS = ["whatsapp", "instagram", "messenger", "telegram"] as const;
export type InboxChannel = (typeof INBOX_CHANNELS)[number];

export type InboxQuery = {
  filter: InboxFilter;
  channel: InboxChannel | null;
  search: string;
  limit: number;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Lee los parámetros de la URL con valores por defecto seguros.
export function inboxQueryFrom(params: Record<string, string | string[] | undefined>): InboxQuery {
  const filter = first(params.filtro);
  const channel = first(params.canal);
  const limit = Number(first(params.ver));
  return {
    filter: (INBOX_FILTERS as readonly string[]).includes(filter ?? "") ? (filter as InboxFilter) : "todas",
    channel: (INBOX_CHANNELS as readonly string[]).includes(channel ?? "") ? (channel as InboxChannel) : null,
    search: (first(params.q) ?? "").trim().slice(0, 80),
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : INBOX_PAGE_SIZE,
  };
}

// Texto de búsqueda seguro para un filtro `or` de PostgREST: sin los caracteres que tienen significado ahí.
export function searchTerm(search: string): string {
  return search.replace(/[,()*%\\:"]/g, " ").replace(/\s+/g, " ").trim();
}

type FilterSpec = { filters: Array<[column: string, operator: string, value: string]>; or?: string };

// Qué condiciones aplica cada pestaña. Se describen como datos para usarlas igual en la lista y en los contadores.
export function filterSpec(filter: InboxFilter, userId: string): FilterSpec {
  switch (filter) {
    case "esperando":
      return { filters: [["last_direction", "eq", "inbound"]] };
    case "mias":
      return { filters: [], or: `assigned_to.eq.${userId},case_assigned_to.eq.${userId}` };
    case "sin-asignar":
      return { filters: [["assigned_to", "is", "null"], ["case_assigned_to", "is", "null"]] };
    case "ia-pausada":
      return { filters: [["ai_enabled", "eq", "false"]] };
    default:
      return { filters: [] };
  }
}

export async function listInbox(params: { userClient: SupabaseClient<Database>; userId: string; query: InboxQuery }) {
  const { userClient, userId, query } = params;

  let list = userClient
    .from("conversation_summaries")
    .select(
      "id, contact_name, contact_document, channel_type, last_body, last_type, last_direction, last_sender, last_message_at, ai_enabled, case_status, case_priority, case_assigned_to",
    )
    .order("last_message_at", { ascending: false, nullsFirst: false })
    // Uno de más para saber si hay otra página.
    .limit(query.limit + 1);

  const spec = filterSpec(query.filter, userId);
  for (const [column, operator, value] of spec.filters) list = list.filter(column, operator, value);
  if (spec.or) list = list.or(spec.or);
  if (query.channel) list = list.eq("channel_type", query.channel);

  const term = searchTerm(query.search);
  if (term) {
    const digits = term.replace(/\D/g, "");
    list = digits.length >= 4 ? list.or(`contact_name.ilike.%${term}%,contact_document.ilike.%${digits}%`) : list.ilike("contact_name", `%${term}%`);
  }

  // La lista y cuántas hay en cada pestaña (sin búsqueda ni canal: son el mapa general de la bandeja), a la vez. Los
  // cinco conteos son una sola consulta (función de la base).
  const [{ data, error }, countsResult] = await Promise.all([list, userClient.rpc("inbox_counts", { p_user_id: userId })]);
  const rows = data ?? [];
  const numbers = (countsResult.data ?? {}) as Record<string, number>;
  const counts = Object.fromEntries(INBOX_FILTERS.map((filter) => [filter, numbers[filter] ?? 0])) as Record<InboxFilter, number>;

  return {
    items: rows.slice(0, query.limit),
    hasMore: rows.length > query.limit,
    counts,
    failed: Boolean(error || countsResult.error),
  };
}

// Quién escribió lo último, para el adelanto de la bandeja.
export function lastSenderPrefix(sender: string | null, direction: string | null, agentName = "Agente"): string {
  if (direction !== "outbound") return "";
  if (sender === "agent") return `${agentName}: `;
  if (sender === "operator") return "Equipo: ";
  return "";
}
