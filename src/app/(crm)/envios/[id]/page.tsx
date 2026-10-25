import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { Badge, type Tone } from "@/components/ui/badge";
import { NoAccess } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentProfile } from "@/lib/auth/profile";
import { BROADCAST_STATUS_LABELS, fixedValuesOf, isNameVariable, segmentOf } from "@/lib/broadcasts/rules";
import { dateTime } from "@/lib/crm/format";
import { createClient } from "@/lib/supabase/server";
import { renderTemplate, templateVariables } from "@/lib/whatsapp/templates";

import { LiveRefresh } from "../../live-refresh";
import { BroadcastControls } from "./controls";

export const metadata = { title: "Envío" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

const TONES: Record<string, Tone> = { draft: "neutral", scheduled: "info", sending: "accent", done: "success", cancelled: "warning" };
const number = new Intl.NumberFormat("es-AR");

export default async function EnvioPage({ params }: PageProps<"/envios/[id]">) {
  await connection();
  const profile = await getCurrentProfile();
  if (profile.role !== "superadmin") return <NoAccess title="Envío" reason="Solo un superadministrador puede ver los envíos masivos." />;
  const { id } = await params;

  const supabase = await createClient();
  const { data: broadcast } = await supabase
    .from("broadcasts")
    .select("id, name, status, segment, variables, scheduled_at, started_at, finished_at, created_at, message_templates(name, language, body)")
    .eq("id", id)
    .maybeSingle();
  if (!broadcast) notFound();

  const [{ data: stats }, { data: audience }, { data: failedRows }] = await Promise.all([
    supabase.rpc("broadcast_stats"),
    broadcast.status === "draft" || broadcast.status === "scheduled"
      ? supabase.rpc("broadcast_audience_count", { p_org: profile.organizationId, p_segment: broadcast.segment })
      : Promise.resolve({ data: null }),
    supabase.from("broadcast_recipients").select("contact_id, error, contacts(display_name)").eq("broadcast_id", id).eq("status", "failed").limit(50),
  ]);
  const row = (stats ?? []).find((item) => item.broadcast_id === id);
  const sent = Number(row?.sent ?? 0);
  const failed = Number(row?.failed ?? 0);
  const queued = Number(row?.queued ?? 0);
  const total = sent + failed + queued;

  const template = broadcast.message_templates;
  const fixed = fixedValuesOf(broadcast.variables);
  const preview = template ? renderTemplate(template.body, Object.fromEntries(templateVariables(template.body).map((key) => [key, isNameVariable(key) ? "Ana" : (fixed[key] ?? "")]))) : "";
  const segment = segmentOf(broadcast.segment);
  const audienceNow = typeof audience === "number" ? audience : null;

  return (
    <main className="flex flex-1 flex-col">
      <LiveRefresh organizationId={profile.organizationId} />
      <PageHeader
        title={broadcast.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={TONES[broadcast.status] ?? "neutral"} dot>
              {BROADCAST_STATUS_LABELS[broadcast.status] ?? broadcast.status}
            </Badge>
            {broadcast.status === "scheduled" && broadcast.scheduled_at ? `Sale ${dateTime(broadcast.scheduled_at)}` : `Creado ${dateTime(broadcast.created_at)}`}
          </span>
        }
        actions={<Link href="/envios" className="btn-secondary">Todos los envíos</Link>}
      />

      <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-[1fr_1fr]">
        <div className="flex flex-col gap-4">
          <section className="card flex flex-col gap-3 p-4" aria-label="Qué se envía">
            <h2 className="eyebrow">Qué se envía</h2>
            <p className="text-sm">
              Plantilla <span className="font-mono">{template?.name}</span> · {template?.language}
            </p>
            <p className="rounded-2xl rounded-br-sm bg-accent px-3.5 py-2 text-sm whitespace-pre-wrap text-accent-foreground">{preview}</p>
            <p className="text-xs text-muted">Donde va el nombre, cada persona recibe el suyo. {segment.locality ? `Solo contactos de «${segment.locality}».` : "Todos los contactos con consentimiento."}</p>
          </section>

          {audienceNow !== null ? (
            <section className="card flex flex-col gap-1 p-4" aria-label="A quién llega">
              <h2 className="eyebrow">A quién llega</h2>
              <p className="font-mono text-3xl font-semibold">{number.format(audienceNow)}</p>
              <p className="text-sm text-muted">
                contactos con consentimiento vigente y WhatsApp. WhatsApp cobra cada conversación que se abre: este envío puede consumir hasta {number.format(audienceNow)} créditos.
              </p>
            </section>
          ) : null}

          <BroadcastControls id={broadcast.id} status={broadcast.status} audience={audienceNow ?? total} />
        </div>

        <div className="flex flex-col gap-4">
          <section className="card flex flex-col gap-3 p-4" aria-label="Avance">
            <h2 className="eyebrow">Avance</h2>
            {total === 0 ? (
              <p className="text-sm text-muted">Todavía no salió nada.</p>
            ) : (
              <>
                <div className="h-2.5 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800" role="progressbar" aria-label="Enviados" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((sent / total) * 100)}>
                  <div className="h-full rounded-full bg-success" style={{ width: `${Math.round((sent / total) * 100)}%` }} />
                </div>
                <dl className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <dd className="font-mono text-2xl font-semibold text-success">{number.format(sent)}</dd>
                    <dt className="text-xs text-muted">Enviados</dt>
                  </div>
                  <div>
                    <dd className="font-mono text-2xl font-semibold">{number.format(queued)}</dd>
                    <dt className="text-xs text-muted">Faltan</dt>
                  </div>
                  <div>
                    <dd className={`font-mono text-2xl font-semibold ${failed > 0 ? "text-danger" : ""}`}>{number.format(failed)}</dd>
                    <dt className="text-xs text-muted">Sin enviar</dt>
                  </div>
                </dl>
              </>
            )}
          </section>

          {(failedRows ?? []).length > 0 ? (
            <section className="card flex flex-col gap-2 p-4" aria-label="Los que no se enviaron">
              <h2 className="eyebrow">Los que no se enviaron</h2>
              <ul className="flex flex-col divide-y divide-line text-sm">
                {(failedRows ?? []).map((item) => (
                  <li key={item.contact_id} className="flex flex-col gap-0.5 py-2">
                    <Link href={`/contactos/${item.contact_id}`} className="font-medium underline-offset-2 hover:underline">
                      {item.contacts?.display_name || "Sin nombre"}
                    </Link>
                    <span className="text-xs text-muted">{item.error}</span>
                  </li>
                ))}
              </ul>
              {failed > 50 ? <p className="text-xs text-muted">Se muestran los primeros 50.</p> : null}
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
