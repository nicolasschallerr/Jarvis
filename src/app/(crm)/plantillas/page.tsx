import { connection } from "next/server";

import { Badge, type Tone } from "@/components/ui/badge";
import { EmptyState, NoAccess } from "@/components/ui/empty-state";
import { InboxIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentProfile } from "@/lib/auth/profile";
import { capitalizeFirst, dateTime } from "@/lib/crm/format";
import { createClient } from "@/lib/supabase/server";
import { STATUS_LABELS, templateVariables, type TemplateStatus } from "@/lib/whatsapp/templates";

import { SyncButton } from "./sync-button";

export const metadata = { title: "Plantillas" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

const STATUS_TONES: Record<TemplateStatus, Tone> = {
  draft: "neutral",
  submitted: "info",
  approved: "success",
  rejected: "danger",
  paused: "warning",
  disabled: "neutral",
};

// Plantillas de WhatsApp aprobadas por Meta: lo único que se puede enviar fuera de la ventana de 24 h (Fase 9,
// ADR-030). Se crean y se aprueban en el Administrador de WhatsApp de Meta; acá se sincronizan y se revisan.
export default async function PlantillasPage() {
  await connection();
  const profile = await getCurrentProfile();
  if (profile.role !== "superadmin") {
    return <NoAccess title="Plantillas" reason="Solo un superadministrador puede ver y sincronizar las plantillas de WhatsApp." />;
  }

  const supabase = await createClient();
  const { data: templates, error } = await supabase
    .from("message_templates")
    .select("id, name, language, category, body, meta_status, rejected_reason, synced_at")
    .order("meta_status")
    .order("name");

  const approved = (templates ?? []).filter((template) => template.meta_status === "approved").length;

  return (
    <main className="flex flex-1 flex-col">
      <PageHeader
        title="Plantillas de WhatsApp"
        description={`Fuera de la ventana de 24 h, WhatsApp solo deja escribir con plantillas aprobadas por Meta. ${approved} aprobadas para usar.`}
        actions={<SyncButton />}
      />

      {error ? (
        <p role="alert" className="p-6 text-sm text-danger">
          No se pudieron cargar las plantillas. Probá recargar.
        </p>
      ) : (templates ?? []).length === 0 ? (
        <EmptyState
          icon={<InboxIcon className="size-6" />}
          title="Todavía no hay plantillas"
          description="Crealas y mandalas a aprobar en el Administrador de WhatsApp de Meta. Después tocá «Sincronizar con Meta». El canal de WhatsApp necesita su token en el servidor y el id de la cuenta de WhatsApp Business (waba_id)."
        />
      ) : (
        <ul className="grid gap-4 p-4 sm:p-6 lg:grid-cols-2">
          {(templates ?? []).map((template) => {
            const status = template.meta_status as TemplateStatus;
            const variables = templateVariables(template.body);
            return (
              <li key={template.id} className="card flex flex-col gap-3 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-mono text-sm font-semibold">{template.name}</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge tone={STATUS_TONES[status]} dot>
                      {STATUS_LABELS[status]}
                    </Badge>
                    <Badge>{template.language}</Badge>
                    {template.category ? <Badge>{capitalizeFirst(template.category)}</Badge> : null}
                  </div>
                </div>
                <p className="rounded-xl bg-zinc-100 px-3 py-2 text-sm whitespace-pre-wrap dark:bg-zinc-900">{template.body}</p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
                  <span className="font-mono">{variables.length === 0 ? "Sin variables" : `Variables: ${variables.map((key) => `{{${key}}}`).join(" ")}`}</span>
                  {template.synced_at ? <span>Sincronizada {dateTime(template.synced_at)}</span> : null}
                </div>
                {template.rejected_reason ? <p className="text-xs text-danger">Motivo del rechazo: {template.rejected_reason}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
