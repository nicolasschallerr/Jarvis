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
