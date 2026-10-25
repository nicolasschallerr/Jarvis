import Link from "next/link";
import { connection } from "next/server";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ContactsIcon, SearchIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentProfile } from "@/lib/auth/profile";
import { CONTACTS_PAGE_SIZE, contactQueryFrom, listContacts } from "@/lib/crm/contact-directory";
import { channelLabel, shortDate } from "@/lib/crm/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Contactos" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

function contactsHref(search: string, limit?: number): string {
  const params = new URLSearchParams();
  if (search) params.set("q", search);
  if (limit) params.set("ver", String(limit));
  const text = params.toString();
  return text ? `/contactos?${text}` : "/contactos";
}

export default async function ContactosPage({ searchParams }: PageProps<"/contactos">) {
  // Página por pedido: lee la sesión y la hora actual (ver la nota de `instant` en el layout del CRM).
  await connection();
  await getCurrentProfile();
  const query = contactQueryFrom(await searchParams);
  const { items, hasMore, failed } = await listContacts({ userClient: await createClient(), ...query });
  const now = new Date();

  return (
    <main className="flex flex-1 flex-col">
      <PageHeader
        title="Contactos"
        description="Las personas que escribieron por algún canal, con su ficha y todo su historial."
        actions={
          <form action="/contactos" className="relative w-full sm:w-80" role="search">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              name="q"
              defaultValue={query.search}
              placeholder="Nombre, documento o teléfono"
              aria-label="Buscar contactos por nombre, documento o teléfono"
              className="field w-full !pl-9"
            />
          </form>
        }
      />

      {failed ? (
        <p role="alert" className="m-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger sm:m-6">
          No se pudieron cargar los contactos. Probá recargar la página.
        </p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={<ContactsIcon className="size-5" />}
          title={query.search ? "No encontramos contactos con esa búsqueda" : "Todavía no hay contactos"}
          description={query.search ? "Probá con otra parte del nombre, el documento sin puntos o el teléfono." : "Cada persona que escribe por un canal queda registrada acá."}
          action={
            query.search ? (
              <Link href="/contactos" className="btn-secondary">
                Ver todos
              </Link>
            ) : null
          }
        />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {items.map((contact) => (
              <li key={contact.id}>
                <Link href={`/contactos/${contact.id}`} className="flex items-start gap-3 px-4 py-3.5 transition hover:bg-zinc-100/80 sm:px-6 dark:hover:bg-zinc-900">
                  <Avatar name={contact.displayName} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{contact.displayName || "Sin nombre"}</p>
                    <p className="truncate text-sm text-muted">
                      {[contact.documentNumber ? `Doc. ${contact.documentNumber}` : null, contact.locality].filter(Boolean).join(" · ") || "Sin datos de ficha"}
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {contact.channels.map((channel) => (
                        <Badge key={`${channel.channelType}:${channel.identifier}`}>{channelLabel(channel.channelType)}</Badge>
                      ))}
                      <Badge tone="info">
                        {contact.conversations === 1 ? "1 conversación" : `${contact.conversations} conversaciones`}
                      </Badge>
                    </div>
                  </div>
                  <time className="shrink-0 text-xs text-muted" dateTime={contact.lastMessageAt ?? undefined}>
                    {shortDate(contact.lastMessageAt, now)}
                  </time>
                </Link>
              </li>
            ))}
          </ul>
          {hasMore ? (
            <div className="flex justify-center p-4">
              <Link href={contactsHref(query.search, query.limit + CONTACTS_PAGE_SIZE)} className="btn-secondary" scroll={false}>
                Ver más contactos
              </Link>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
