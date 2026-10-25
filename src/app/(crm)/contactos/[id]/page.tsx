import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";

import { Avatar } from "@/components/ui/avatar";
import { Badge, PriorityBadge, StatusBadge } from "@/components/ui/badge";
import { ArrowLeftIcon } from "@/components/ui/icons";
import { getCurrentProfile } from "@/lib/auth/profile";
import { getContactHistory } from "@/lib/crm/contact-directory";
import { channelLabel, dateTime, messagePreview, shortDate } from "@/lib/crm/format";
import { getAgentNames } from "@/lib/crm/agent-names";
import { lastSenderPrefix } from "@/lib/crm/inbox";
import { createClient } from "@/lib/supabase/server";

import { ContactForm } from "../../conversaciones/[id]/contact-form";

export const metadata = { title: "Contacto" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

// Ficha de un contacto con su historial en todos los canales. Para editar la ficha o responder se entra a una
// conversación (ahí están los formularios); esta página es para ver a la persona completa de un vistazo.
export default async function ContactoPage({ params }: PageProps<"/contactos/[id]">) {
  await connection();
  const profile = await getCurrentProfile();
  const { id } = await params;

  const history = await getContactHistory({ userClient: await createClient(), contactId: id });
  if (!history) notFound();
  // Una ficha unida a otra ya no existe por separado: se muestra la que quedó.
  if (history.contact.merged_into) redirect(`/contactos/${history.contact.merged_into}`);

  const { contact, conversations, cases } = history;
  const agentName = (await getAgentNames()).attention;
  const now = new Date();
  const name = contact.display_name || "Sin nombre";
  const openCases = cases.filter((item) => item.status !== "resolved");

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex flex-wrap items-center gap-4 border-b border-line px-4 pt-5 pb-4 sm:px-6">
        <Link href="/contactos" className="btn-secondary !p-2" aria-label="Volver a los contactos">
          <ArrowLeftIcon />
        </Link>
        <Avatar name={name} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-2xl font-semibold tracking-tight">{name}</h1>
          <p className="text-sm text-muted">
            {[contact.document_number ? `Doc. ${contact.document_number}` : null, contact.locality, `Contacto desde ${dateTime(contact.created_at)}`]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </header>

      <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="conversaciones" className="flex flex-col gap-3">
            <h2 id="conversaciones" className="text-sm font-semibold tracking-wide text-muted uppercase">
              Conversaciones ({conversations.length})
            </h2>
            {conversations.length === 0 ? (
              <p className="card p-4 text-sm text-muted">Todavía no tiene conversaciones.</p>
            ) : (
              <ul className="card divide-y divide-line">
                {conversations.map((conversation) => (
                  <li key={conversation.id}>
                    <Link href={`/conversaciones/${conversation.id}`} className="flex items-start gap-3 px-4 py-3 transition hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge>{channelLabel(conversation.channel_type ?? "")}</Badge>
                          {conversation.channel_name ? <span className="text-xs text-muted">{conversation.channel_name}</span> : null}
                          {!conversation.ai_enabled ? <Badge tone="warning">IA en pausa</Badge> : null}
                        </div>
                        <p className="mt-1 truncate text-sm">
                          {lastSenderPrefix(conversation.last_sender, conversation.last_direction, agentName)}
                          {messagePreview(conversation.last_body, conversation.last_type) || "Sin mensajes"}
                        </p>
                      </div>
                      <time className="shrink-0 text-xs text-muted" dateTime={conversation.last_message_at ?? undefined}>
                        {shortDate(conversation.last_message_at, now)}
                      </time>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="casos" className="flex flex-col gap-3">
            <h2 id="casos" className="text-sm font-semibold tracking-wide text-muted uppercase">
              Casos ({cases.length}
              {openCases.length === 1 ? " · 1 abierto" : openCases.length > 1 ? ` · ${openCases.length} abiertos` : ""})
            </h2>
            {cases.length === 0 ? (
              <p className="card p-4 text-sm text-muted">No tiene casos.</p>
            ) : (
              <ul className="card divide-y divide-line">
                {cases.map((item) => {
                  const body = (
                    <>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{item.title ?? "Caso sin título"}</p>
                        <p className="truncate text-xs text-muted">
                          {item.sectors?.name ?? "Sin sector"} · Abierto el {dateTime(item.opened_at)}
                          {item.resolved_at ? ` · Resuelto el ${dateTime(item.resolved_at)}` : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                        <StatusBadge status={item.status} />
                        {item.priority === "high" || item.priority === "urgent" ? <PriorityBadge priority={item.priority} /> : null}
                      </div>
                    </>
                  );
                  return (
                    <li key={item.id}>
                      {item.conversation_id ? (
                        <Link href={`/conversaciones/${item.conversation_id}`} className="flex items-start gap-3 px-4 py-3 transition hover:bg-zinc-100/80 dark:hover:bg-zinc-800/60">
                          {body}
                        </Link>
                      ) : (
                        <div className="flex items-start gap-3 px-4 py-3">{body}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <aside className="flex flex-col gap-4">
          <section aria-labelledby="ficha" className="card flex flex-col gap-3 p-4 text-sm">
            <h2 id="ficha" className="font-semibold">
              Ficha
            </h2>
            <ContactForm
              contactId={contact.id}
              conversationId=""
              canEdit={profile.role !== "viewer"}
              values={{
                displayName: contact.display_name ?? "",
                documentNumber: contact.document_number ?? "",
                locality: contact.locality ?? "",
                notes: contact.notes ?? "",
              }}
            />
            <p className="text-xs text-muted">
              Envíos: {contact.opted_out_at ? "no quiere recibir" : contact.opted_in_at ? "aceptó recibir" : "sin registrar"}
            </p>
          </section>

          <section aria-labelledby="canales" className="card flex flex-col gap-2 p-4 text-sm">
            <h2 id="canales" className="font-semibold">
              Canales
            </h2>
            <ul className="flex flex-col gap-1.5">
              {contact.contact_identities.map((identity) => (
                <li key={`${identity.channel_type}:${identity.identifier}`} className="flex items-center justify-between gap-2">
                  <Badge>{channelLabel(identity.channel_type)}</Badge>
                  <span className="truncate font-mono text-xs text-muted">{identity.identifier}</span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </main>
  );
}
