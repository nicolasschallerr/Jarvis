import type { SupabaseClient } from "@supabase/supabase-js";

import { ROLE_LABELS } from "@/lib/team/roles";
import type { Database } from "@/lib/supabase/database.types";

export const AUDIT_PAGE_SIZE = 50;
const MAX_LIMIT = 500;

// Grupos del filtro: el prefijo de la acción ("contact.updated" → contact).
export const AUDIT_GROUPS = [
  { key: "todo", label: "Todo" },
  { key: "contact", label: "Contactos" },
  { key: "person", label: "Personas" },
  { key: "conversation", label: "Conversaciones" },
  { key: "channel", label: "Canales" },
  { key: "agent", label: "Agentes" },
  { key: "sector", label: "Sectores" },
  { key: "template", label: "Plantillas" },
  { key: "usage", label: "Consumo" },
  { key: "broadcast", label: "Envíos" },
  { key: "export", label: "Exportaciones" },
] as const;

export type AuditGroup = (typeof AUDIT_GROUPS)[number]["key"];

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function auditQueryFrom(params: Record<string, string | string[] | undefined>): { group: AuditGroup; limit: number } {
  const group = first(params.tipo);
  const limit = Number(first(params.ver));
  return {
    group: AUDIT_GROUPS.some((item) => item.key === group) ? (group as AuditGroup) : "todo",
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : AUDIT_PAGE_SIZE,
  };
}

export type AuditItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  data: Record<string, unknown>;
  createdAt: string;
  actorId: string | null;
};

// Lectura con la sesión de quien mira: RLS deja el registro solo al superadmin de la organización.
export async function listAudit(params: { userClient: SupabaseClient<Database>; group: AuditGroup; limit: number }) {
  let query = params.userClient
    .from("audit_log")
    .select("id, action, entity_type, entity_id, data, created_at, actor_profile_id")
    .order("created_at", { ascending: false })
    .limit(params.limit + 1);
  if (params.group !== "todo") query = query.like("action", `${params.group}.%`);

  const { data, error } = await query;
  const rows = data ?? [];
  const items: AuditItem[] = rows.slice(0, params.limit).map((row) => ({
    id: row.id,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    data: row.data && typeof row.data === "object" && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {},
    createdAt: row.created_at,
    actorId: row.actor_profile_id,
  }));

  // Nombres de quienes actuaron (y de las personas a las que se refiere una acción).
  const ids = new Set<string>();
  for (const item of items) {
    if (item.actorId) ids.add(item.actorId);
    const target = item.data.profile_id;
    if (typeof target === "string") ids.add(target);
  }
  const { data: people } = ids.size ? await params.userClient.from("profiles").select("id, full_name").in("id", [...ids]) : { data: [] };

  return {
    items,
    hasMore: rows.length > params.limit,
    names: new Map((people ?? []).map((person) => [person.id, person.full_name])),
    failed: Boolean(error),
  };
}

const CONTACT_FIELDS: Record<string, string> = {
  display_name: "nombre",
  document_number: "documento",
  locality: "localidad",
  notes: "notas",
  client_record_id: "id del cliente",
  opted_in_at: "consentimiento (alta)",
  opted_out_at: "consentimiento (baja)",
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

// Frase en español de lo que pasó, sin datos personales. El actor ("Fulano", "Agente" o "Sistema") va aparte.
export function describeAudit(item: Pick<AuditItem, "action" | "data">, names: Map<string, string>): string {
  const { data } = item;
  const person = (id: unknown) => (typeof id === "string" ? (names.get(id) ?? "una persona") : "una persona");

  switch (item.action) {
    case "contact.updated": {
      const fields = Array.isArray(data.fields) ? data.fields.map((field) => CONTACT_FIELDS[String(field)] ?? String(field)) : [];
      return `Editó la ficha de un contacto${fields.length ? ` (${fields.join(", ")})` : ""}`;
    }
    case "contact.consent_given":
      return "Registró que un contacto aceptó recibir mensajes";
    case "contact.consent_withdrawn":
      return "Registró que un contacto dejó de querer recibir mensajes";
    case "broadcast.created":
      return `Creó el envío masivo «${text(data.name)}»`;
    case "broadcast.scheduled":
      return `Programó el envío masivo «${text(data.name)}» para ${Number(data.audience ?? 0)} contactos`;
    case "broadcast.cancelled":
      return `Canceló el envío masivo «${text(data.name)}»`;
    case "contact.merged":
      return "Unió dos fichas de contacto";
    case "conversation.ai_toggled":
      return data.enabled === true ? "Devolvió una conversación al agente" : "Tomó una conversación (el agente se pausó)";
    case "conversation.assigned":
      return "Cambió la asignación de una conversación";
    case "channel.created":
      return `Creó el canal «${text(data.name)}» (${text(data.type)})`;
    case "channel.updated":
      return `Cambió el canal «${text(data.name)}»${data.is_active === false ? " (desactivado)" : ""}`;
    case "channel.deleted":
      return `Eliminó el canal «${text(data.name)}»`;
    case "agent.changed": {
      const fields = Array.isArray(data.fields) ? data.fields.map(String) : [];
      if (fields.includes("is_enabled")) return `${data.is_enabled === true ? "Encendió" : "Apagó"} a ${text(data.name)}`;
      return `Cambió el nombre o la frase de ${text(data.name)}`;
    }
    case "sector.member_added":
      return `Sumó a ${person(data.profile_id)} a un sector`;
    case "sector.member_removed":
      return `Quitó a ${person(data.profile_id)} de un sector`;
    case "sector.lead_changed":
      return `Cambió el rol de responsable de ${person(data.profile_id)} en un sector`;
    case "person.created":
      return `Sumó a ${text(data.name)} (${ROLE_LABELS[data.role as keyof typeof ROLE_LABELS] ?? text(data.role)})`;
    case "person.role_changed":
      return `Cambió el rol de ${text(data.name)}: ${ROLE_LABELS[data.from as keyof typeof ROLE_LABELS] ?? text(data.from)} → ${ROLE_LABELS[data.to as keyof typeof ROLE_LABELS] ?? text(data.to)}`;
    case "person.deactivated":
      return `Desactivó a ${text(data.name)}`;
    case "person.reactivated":
      return `Reactivó a ${text(data.name)}`;
    case "person.access_link":
      return `Generó un enlace de acceso para ${text(data.name)}`;
    case "usage.limits_changed":
      return "Cambió los límites de consumo del mes";
    case "template.synced":
      return `Sincronizó las plantillas con Meta (${Number(data.count ?? 0)})`;
    case "export.created":
      return `Exportó ${text(data.type)} (${Number(data.rows ?? 0)} filas)`;
    default:
      return item.action;
  }
}

// Quién lo hizo: una persona, el agente (un cambio de ficha hecho por él) o el sistema (sin sesión).
export function actorLabel(item: Pick<AuditItem, "actorId" | "data">, names: Map<string, string>): string {
  if (item.actorId) return names.get(item.actorId) ?? "Una persona";
  return item.data.actor === "agent" ? "Agente" : "Sistema";
}
