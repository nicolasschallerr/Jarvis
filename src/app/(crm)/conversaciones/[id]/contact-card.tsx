import { channelLabel, dateTime } from "@/lib/crm/format";
import { findDuplicateContacts } from "@/lib/crm/contact-merge";
import { createClient } from "@/lib/supabase/server";

import { ContactForm } from "./contact-form";
import { DuplicateContacts } from "./duplicate-contacts";

// Ficha del asociado: sus datos editables y, de solo lectura, por dónde escribe y su consentimiento.
// La lectura es abierta en la organización (ADR-016); editar lo permite RLS a superadmin y operadores.
export async function ContactCard({
  contactId,
  conversationId,
  canEdit,
  canMerge = false,
}: {
  contactId: string;
  conversationId: string;
  canEdit: boolean;
  // Unir contactos es solo del superadmin.
  canMerge?: boolean;
}) {
  const supabase = await createClient();

  const [{ data: contact }, { data: identities }] = await Promise.all([
    supabase
      .from("contacts")
      .select("display_name, document_number, locality, notes, opted_in_at, opted_out_at, client_record_id")
      .eq("id", contactId)
      .maybeSingle(),
    supabase.from("contact_identities").select("channel_type, identifier").eq("contact_id", contactId),
  ]);

  if (!contact) return null;

  const duplicates = canMerge ? await findDuplicateContacts({ userClient: supabase, contactId }) : [];

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">Asociado</h2>

      <ContactForm
        contactId={contactId}
        conversationId={conversationId}
        canEdit={canEdit}
        values={{
          displayName: contact.display_name ?? "",
          documentNumber: contact.document_number ?? "",
          locality: contact.locality ?? "",
          notes: contact.notes ?? "",
        }}
      />

      <dl className="flex flex-col gap-1 text-xs text-muted">
        {(identities ?? []).map((identity) => (
          <div key={`${identity.channel_type}-${identity.identifier}`} className="flex gap-1">
            <dt>{channelLabel(identity.channel_type)}:</dt>
            <dd>{identity.identifier}</dd>
          </div>
        ))}
        {contact.client_record_id ? (
          <div className="flex gap-1">
            <dt>Id en el sistema del cliente:</dt>
            <dd>{contact.client_record_id}</dd>
          </div>
        ) : null}
        <div className="flex gap-1">
          <dt>Consentimiento para envíos:</dt>
          <dd>
            {contact.opted_out_at
              ? `dio de baja el ${dateTime(contact.opted_out_at)}`
              : contact.opted_in_at
                ? `aceptó el ${dateTime(contact.opted_in_at)}`
                : "sin registrar"}
          </dd>
        </div>
      </dl>

      {canMerge ? <DuplicateContacts keepId={contactId} conversationId={conversationId} candidates={duplicates} /> : null}
    </section>
  );
}
