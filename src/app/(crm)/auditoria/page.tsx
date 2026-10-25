import Link from "next/link";
import { connection } from "next/server";

import { Avatar } from "@/components/ui/avatar";
import { EmptyState, NoAccess } from "@/components/ui/empty-state";
import { LockIcon } from "@/components/ui/icons";
import { LinkTabs } from "@/components/ui/link-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { actorLabel, AUDIT_GROUPS, AUDIT_PAGE_SIZE, auditQueryFrom, describeAudit, listAudit, type AuditItem } from "@/lib/audit/list";
import { getCurrentProfile } from "@/lib/auth/profile";
import { dateTime } from "@/lib/crm/format";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Auditoría" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

function auditHref(group: string, limit?: number): string {
  const params = new URLSearchParams();
  if (group !== "todo") params.set("tipo", group);
  if (limit) params.set("ver", String(limit));
  const text = params.toString();
  return text ? `/auditoria?${text}` : "/auditoria";
}

// A dónde lleva el registro, si la cosa todavía existe y tiene pantalla.
function targetOf(item: AuditItem): string | null {
  if (!item.entityId) return null;
  if (item.entityType === "contact") return `/contactos/${item.entityId}`;
  if (item.entityType === "conversation") return `/conversaciones/${item.entityId}`;
  return null;
}

// Quién hizo qué y cuándo (Ley 25.326: registro de acciones sobre datos personales). Solo el superadmin lo ve; la
// base lo garantiza con RLS, esto es solo la pantalla.
export default async function AuditoriaPage({ searchParams }: PageProps<"/auditoria">) {
  await connection();
  const profile = await getCurrentProfile();
  if (profile.role !== "superadmin") {
    return <NoAccess title="Auditoría" reason="Solo un superadministrador puede ver el registro de auditoría." />;
  }

  const query = auditQueryFrom(await searchParams);
  const { items, hasMore, names, failed } = await listAudit({ userClient: await createClient(), ...query });

  return (
    <main className="flex flex-1 flex-col">
      <PageHeader
        title="Auditoría"
        description="Quién hizo qué, y cuándo. Incluye los cambios en fichas, quién toma o devuelve una conversación, canales, agentes, personas y exportaciones."
        actions={
          <a href="/exportar/auditoria" className="btn-secondary" download>
            Exportar CSV
          </a>
        }
      >
        <LinkTabs
          label="Tipo de movimiento"
          items={AUDIT_GROUPS.map((group) => ({ href: auditHref(group.key), label: group.label, active: query.group === group.key }))}
        />
      </PageHeader>

      {failed ? (
        <p role="alert" className="p-6 text-sm text-danger">
          No se pudo cargar el registro. Probá recargar la página.
        </p>
      ) : items.length === 0 ? (
        <EmptyState icon={<LockIcon className="size-5" />} title="Todavía no hay movimientos de este tipo" description="Cuando alguien cambie algo, queda registrado acá." />
      ) : (
        <>
          <ul className="divide-y divide-line">
            {items.map((item) => {
              const actor = actorLabel(item, names);
              const target = targetOf(item);
              return (
                <li key={item.id} className="flex items-start gap-3 px-4 py-3 sm:px-6">
                  <Avatar name={actor} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-medium">{actor}</span> · {describeAudit(item, names)}
                    </p>
                    <p className="font-mono text-xs text-muted">{item.action}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1 text-xs text-muted">
                    <time dateTime={item.createdAt}>{dateTime(item.createdAt)}</time>
                    {target ? (
                      <Link href={target} className="text-accent underline-offset-2 hover:underline">
                        Ver
                      </Link>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
          {hasMore ? (
            <div className="flex justify-center p-4">
              <Link href={auditHref(query.group, query.limit + AUDIT_PAGE_SIZE)} scroll={false} className="btn-secondary">
                Ver más movimientos
              </Link>
            </div>
          ) : null}
        </>
      )}
    </main>
  );
}
