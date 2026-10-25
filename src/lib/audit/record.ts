import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";

// Registra una acción hecha con el cliente de servicio (altas de personas, roles, enlaces de acceso, sincronización
// de plantillas, exportaciones). Las que una persona hace desde su sesión las registran disparadores de la base
// (ADR-035). Registrar es un efecto secundario: si falla no debe romper lo que la persona estaba haciendo, así que
// el error se anota en el registro del servidor y se sigue. Nunca va un dato personal en `data` (ni email ni contenido).
export async function recordAudit(
  admin: SupabaseClient<Database>,
  entry: { organizationId: string; actorId: string | null; action: string; entityType: string; entityId?: string | null; data?: Json },
): Promise<void> {
  const { error } = await admin.from("audit_log").insert({
    organization_id: entry.organizationId,
    actor_profile_id: entry.actorId,
    action: entry.action,
    entity_type: entry.entityType,
    entity_id: entry.entityId ?? null,
    data: entry.data ?? {},
  });
  if (error) console.error("auditoría:", error.message);
}
