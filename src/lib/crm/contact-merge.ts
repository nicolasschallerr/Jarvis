import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

export type DuplicateCandidate = {
  id: string;
  displayName: string | null;
  locality: string | null;
  identities: Array<{ channelType: string; identifier: string }>;
};

// Otros contactos con el mismo documento: suelen ser la misma persona escribiendo por otro canal. Solo
// cuenta lo que ya está confirmado en la ficha; no adivina por nombre. Se lee con la sesión del usuario (RLS).
export async function findDuplicateContacts(params: {
  userClient: SupabaseClient<Database>;
  contactId: string;
}): Promise<DuplicateCandidate[]> {
  const { data: current } = await params.userClient
    .from("contacts")
    .select("document_number")
    .eq("id", params.contactId)
    .maybeSingle();
  if (!current?.document_number) return [];

  const { data } = await params.userClient
    .from("contacts")
    .select("id, display_name, locality, contact_identities(channel_type, identifier)")
    .eq("document_number", current.document_number)
    .neq("id", params.contactId)
    .is("merged_into", null)
    .limit(10);

  return (data ?? []).map((row) => ({
    id: row.id,
    displayName: row.display_name,
    locality: row.locality,
    identities: row.contact_identities.map((identity) => ({ channelType: identity.channel_type, identifier: identity.identifier })),
  }));
}

export type MergeResult =
  | { ok: true; summary: { identitiesMoved: number; conversationsMoved: number; conversationsMerged: number; casesMoved: number } }
  | { ok: false; error: string };

// Mensajes de la base que se le muestran tal cual a la persona (están escritos para eso).
const SHOWN_AS_IS = [
  "Solo un superadministrador puede unir contactos",
  "Los dos contactos tienen un caso abierto en el mismo canal",
  "Uno de los contactos ya fue unido a otro",
  "No se puede unir un contacto consigo mismo",
];

// Une dos contactos: todo lo de `removeId` pasa a `keepId`. Solo superadmin; la función de la base lo exige de
// nuevo y hace todo en una transacción. No se puede deshacer.
export async function mergeContacts(params: {
  userClient: SupabaseClient<Database>;
  profile: { role: "superadmin" | "operator" | "viewer" };
  keepId: string;
  removeId: string;
}): Promise<MergeResult> {
  if (params.profile.role !== "superadmin") {
    return { ok: false, error: "Solo un superadministrador puede unir contactos." };
  }
  if (params.keepId === params.removeId) return { ok: false, error: "No se puede unir un contacto consigo mismo." };

  const { data, error } = await params.userClient.rpc("merge_contacts", { p_keep: params.keepId, p_remove: params.removeId });

  if (error) {
    const known = SHOWN_AS_IS.find((message) => error.message.includes(message));
    return { ok: false, error: known ? error.message : "No se pudieron unir los contactos. No se cambió nada." };
  }

  const summary = (data ?? {}) as Record<string, number>;
  return {
    ok: true,
    summary: {
      identitiesMoved: summary.identities_moved ?? 0,
      conversationsMoved: summary.conversations_moved ?? 0,
      conversationsMerged: summary.conversations_merged ?? 0,
      casesMoved: summary.cases_moved ?? 0,
    },
  };
}
