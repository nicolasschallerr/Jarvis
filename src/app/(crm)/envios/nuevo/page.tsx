import Link from "next/link";
import { connection } from "next/server";

import { EmptyState, NoAccess } from "@/components/ui/empty-state";
import { InboxIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

import { NewBroadcastForm } from "./new-form";

export const metadata = { title: "Nuevo envío" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

export default async function NuevoEnvioPage() {
  await connection();
  const profile = await getCurrentProfile();
  if (profile.role !== "superadmin") return <NoAccess title="Nuevo envío" reason="Solo un superadministrador puede crear envíos masivos." />;

  const supabase = await createClient();
  const [{ data: templates }, { data: audience }] = await Promise.all([
    supabase.from("message_templates").select("id, name, language, body").eq("meta_status", "approved").not("channel_id", "is", null).order("name"),
    supabase.rpc("broadcast_audience_count", { p_org: profile.organizationId, p_segment: {} }),
  ]);

  return (
    <main className="flex flex-1 flex-col">
      <PageHeader title="Nuevo envío" description="Elegí la plantilla y a quién llega. Antes de enviar, lo revisás." actions={<Link href="/envios" className="btn-secondary">Volver</Link>} />
      {(templates ?? []).length === 0 ? (
        <EmptyState
          icon={<InboxIcon className="size-6" />}
          title="No hay plantillas aprobadas"
          description="Los envíos masivos usan plantillas aprobadas por Meta. Sincronizalas desde Plantillas."
          action={
            <Link href="/plantillas" className="btn-primary">
              Ir a Plantillas
            </Link>
          }
        />
      ) : (
        <div className="p-4 sm:p-6">
          <NewBroadcastForm templates={templates ?? []} consentedTotal={typeof audience === "number" ? audience : 0} />
        </div>
      )}
    </main>
  );
}
