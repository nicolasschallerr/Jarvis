import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

import { searchTerm } from "./inbox";

export const CONTACTS_PAGE_SIZE = 50;
const MAX_LIMIT = 500;

type Client = SupabaseClient<Database>;

export type ContactListItem = {
  id: string;
  displayName: string | null;
  documentNumber: string | null;
  locality: string | null;
  channels: Array<{ channelType: string; identifier: string }>;
  conversations: number;
  lastMessageAt: string | null;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function contactQueryFrom(params: Record<string, string | string[] | undefined>): { search: string; limit: number } {
  const limit = Number(first(params.ver));
  return {
    search: (first(params.q) ?? "").trim().slice(0, 80),
    limit: Number.isInteger(limit) && limit > 0 ? Math.min(limit, MAX_LIMIT) : CONTACTS_PAGE_SIZE,
  };
}

// Directorio de contactos de la organización (RLS limita a la propia). Se busca por nombre, documento o
// identificador de canal (teléfono, usuario). Las fichas unidas a otra no aparecen: viven en la que quedó.
export async function listContacts(params: { userClient: Client; search: string; limit: number }): Promise<{
  items: ContactListItem[];
  hasMore: boolean;
  failed: boolean;
}> {
  let query = params.userClient
    .from("contacts")
    .select("id, display_name, document_number, locality, updated_at, contact_identities(channel_type, identifier), conversations(last_message_at)")
    .is("merged_into", null);

  const term = searchTerm(params.search);
  if (term) {
    const digits = term.replace(/\D/g, "");
    const { data: identities } = await params.userClient
      .from("contact_identities")
      .select("contact_id")
      .ilike("identifier", `%${digits.length >= 3 ? digits : term}%`)
      .limit(100);
    const conditions = [`display_name.ilike.%${term}%`];
    if (digits.length >= 3) conditions.push(`document_number.ilike.%${digits}%`);
    const ids = [...new Set((identities ?? []).map((identity) => identity.contact_id))];
    if (ids.length) conditions.push(`id.in.(${ids.join(",")})`);
    query = query.or(conditions.join(","));
  }

  // Se pide uno más para saber si hay otra página.
  // Orden alfabético, como una agenda; los que no tienen nombre, al final.
  const { data, error } = await query
    .order("display_name", { ascending: true, nullsFirst: false })
    .order("id")
    .limit(params.limit + 1);
  if (error) return { items: [], hasMore: false, failed: true };

  const rows = data ?? [];
  const items = rows.slice(0, params.limit).map((row) => {
    const times = row.conversations.map((conversation) => conversation.last_message_at).filter((value): value is string => !!value);
    return {
      id: row.id,
      displayName: row.display_name,
      documentNumber: row.document_number,
      locality: row.locality,
      channels: row.contact_identities.map((identity) => ({ channelType: identity.channel_type, identifier: identity.identifier })),
      conversations: row.conversations.length,
      lastMessageAt: times.sort().at(-1) ?? null,
    };
  });

  return { items, hasMore: rows.length > params.limit, failed: false };
}

// Todo lo de un contacto en todos los canales: su ficha, sus conversaciones y sus casos.
export async function getContactHistory(params: { userClient: Client; contactId: string }) {
  const { data: contact } = await params.userClient
    .from("contacts")
    .select("id, display_name, document_number, locality, notes, opted_in_at, opted_out_at, created_at, merged_into, contact_identities(channel_type, identifier)")
    .eq("id", params.contactId)
    .maybeSingle();
  if (!contact) return null;

  const [{ data: conversations }, { data: cases }] = await Promise.all([
    params.userClient
      .from("conversation_summaries")
      .select("id, channel_type, channel_name, last_body, last_type, last_sender, last_direction, last_message_at, ai_enabled")
      .eq("contact_id", params.contactId)
      .order("last_message_at", { ascending: false, nullsFirst: false }),
    params.userClient
      .from("cases")
      .select("id, title, status, priority, opened_at, resolved_at, conversation_id, sectors(name)")
      .eq("contact_id", params.contactId)
      .order("opened_at", { ascending: false })
      .limit(50),
  ]);

  return { contact, conversations: conversations ?? [], cases: cases ?? [] };
}
