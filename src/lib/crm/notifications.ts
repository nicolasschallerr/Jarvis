import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export const NOTIFICATION_LIST_SIZE = 5;

// Avisos sin leer de la persona que mira. RLS ya limita la tabla a las filas propias (el filtro por
// perfil acá es solo para que la intención se lea en el código).
export async function getUnreadNotifications(params: { userClient: SupabaseClient<Database>; userId: string }) {
  const { data, count, error } = await params.userClient
    .from("notifications")
    .select("id, type, title, body, created_at, cases(conversation_id)", { count: "exact" })
    .eq("profile_id", params.userId)
    .is("read_at", null)
    .order("created_at", { ascending: false })
    .limit(NOTIFICATION_LIST_SIZE);

  return { items: data ?? [], unread: count ?? 0, failed: Boolean(error) };
}

export const NOTIFICATIONS_PAGE_SIZE = 30;

// A dónde lleva un aviso: la conversación del caso o la pantalla que corresponde al tipo. Nada más (el aviso no
// trae direcciones: así no se puede armar un enlace a otro sitio).
export function noticeTarget(notice: { type: string; cases?: { conversation_id: string | null } | null }): string | null {
  const conversationId = notice.cases?.conversation_id;
  if (conversationId) return `/conversaciones/${conversationId}`;
  if (notice.type === "usage_limit") return "/consumo";
  return null;
}

// Todos los avisos de la persona (o solo los sin leer), del más nuevo al más viejo. Uno de más para saber si hay otra página.
export async function listNotifications(params: { userClient: SupabaseClient<Database>; userId: string; onlyUnread: boolean; limit: number }) {
  let query = params.userClient
    .from("notifications")
    .select("id, type, title, body, created_at, read_at, cases(conversation_id)")
    .eq("profile_id", params.userId)
    .order("created_at", { ascending: false })
    .limit(params.limit + 1);
  if (params.onlyUnread) query = query.is("read_at", null);

  const { data, error } = await query;
  const rows = data ?? [];
  return { items: rows.slice(0, params.limit), hasMore: rows.length > params.limit, failed: Boolean(error) };
}

// Marca un aviso como leído. RLS no deja tocar los de otra persona.
export async function markNotificationRead(params: { userClient: SupabaseClient<Database>; userId: string; id: string }): Promise<MarkReadResult> {
  const { error } = await params.userClient
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", params.id)
    .eq("profile_id", params.userId)
    .is("read_at", null);
  return error ? { ok: false, error: "No se pudo marcar el aviso como leído." } : { ok: true };
}

export type MarkReadResult = { ok: true } | { ok: false; error: string };

// Marca como leídos todos los avisos de la persona. RLS no deja tocar los de otra.
export async function markAllNotificationsRead(params: {
  userClient: SupabaseClient<Database>;
  userId: string;
}): Promise<MarkReadResult> {
  const { error } = await params.userClient
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("profile_id", params.userId)
    .is("read_at", null);

  if (error) return { ok: false, error: "No se pudieron marcar los avisos como leídos." };
  return { ok: true };
}

// Cuántos avisos sin leer tiene la persona (para el contador del menú).
export async function countUnreadNotifications(params: { userClient: SupabaseClient<Database>; userId: string }): Promise<number> {
  const { count } = await params.userClient
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("profile_id", params.userId)
    .is("read_at", null);
  return count ?? 0;
}
