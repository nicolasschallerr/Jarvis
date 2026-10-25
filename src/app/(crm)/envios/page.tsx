import Link from "next/link";
import { connection } from "next/server";

import { Badge, type Tone } from "@/components/ui/badge";
import { EmptyState, NoAccess } from "@/components/ui/empty-state";
import { SendIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { BROADCAST_STATUS_LABELS } from "@/lib/broadcasts/rules";
import { getCurrentProfile } from "@/lib/auth/profile";
import { dateTime } from "@/lib/crm/format";
import { createClient } from "@/lib/supabase/server";

import { LiveRefresh } from "../live-refresh";

export const metadata = { title: "Envíos" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

const TONES: Record<string, Tone> = { draft: "neutral", scheduled: "info", sending: "accent", done: "success", cancelled: "warning" };
const number = new Intl.NumberFormat("es-AR");

// Envíos masivos con plantillas aprobadas: solo a quien aceptó recibir mensajes (ADR-038). Los crea y programa el
// superadmin porque le escriben a mucha gente y cada conversación se cobra.
export default async function EnviosPage() {
  await connection();
  const profile = await getCurrentProfile();
  if (profile.role !== "superadmin") return <NoAccess title="Envíos" reason="Solo un superadministrador puede crear y programar envíos masivos." />;

  const supabase = await createClient();
  const [{ data: broadcasts, error }, { data: stats }] = await Promise.all([
    supabase.from("broadcasts").select("id, name, status, scheduled_at, finished_at, created_at, message_templates(name)").order("created_at", { ascending: false }).limit(50),
    supabase.rpc("broadcast_stats"),
  ]);
  const statsById = new Map((stats ?? []).map((row) => [row.broadcast_id, row]));

  return (
    <main className="flex flex-1 flex-col">
      <LiveRefresh organizationId={profile.organizationId} />
      <PageHeader
        title="Envíos masivos"
        description="Mensajes con plantillas aprobadas, solo a contactos que aceptaron recibirlos."
        actions={
          <Link href="/envios/nuevo" className="btn-primary">
            Nuevo envío
          </Link>
        }
      />

      {error ? (
        <p role="alert" className="p-6 text-sm text-danger">
          No se pudieron cargar los envíos. Probá recargar la página.
        </p>
      ) : (broadcasts ?? []).length === 0 ? (
        <EmptyState
          icon={<SendIcon className="size-6" />}
          title="Todavía no hay envíos"
          description="Elegí una plantilla aprobada, filtrá a quién llega y revisá el mensaje antes de enviarlo."
          action={
            <Link href="/envios/nuevo" className="btn-primary">
              Crear el primero
            </Link>
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {(broadcasts ?? []).map((broadcast) => {
            const row = statsById.get(broadcast.id);
            const sent = Number(row?.sent ?? 0);
            const failed = Number(row?.failed ?? 0);
            const queued = Number(row?.queued ?? 0);
            const total = sent + failed + queued;
            return (
              <li key={broadcast.id}>
                <Link href={`/envios/${broadcast.id}`} className="flex flex-col gap-2 px-4 py-3.5 transition hover:bg-zinc-100/80 sm:px-6 dark:hover:bg-zinc-900">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{broadcast.name}</p>
                    <Badge tone={TONES[broadcast.status] ?? "neutral"} dot>
                      {BROADCAST_STATUS_LABELS[broadcast.status] ?? broadcast.status}
                    </Badge>
                    <span className="ml-auto text-xs text-muted">
                      {broadcast.status === "scheduled" && broadcast.scheduled_at ? `Sale ${dateTime(broadcast.scheduled_at)}` : dateTime(broadcast.finished_at ?? broadcast.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-muted">
                    Plantilla {broadcast.message_templates?.name ?? "—"}
                    {total > 0 ? ` · ${number.format(sent)} enviados de ${number.format(total)}${failed > 0 ? ` · ${number.format(failed)} sin enviar` : ""}` : ""}
                  </p>
                  {total > 0 ? (
                    <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" aria-hidden="true">
                      <div className="h-full rounded-full bg-success" style={{ width: `${Math.round((sent / total) * 100)}%` }} />
                    </div>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
