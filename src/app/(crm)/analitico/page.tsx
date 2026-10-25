import { connection } from "next/server";
import { EmptyState, NoAccess } from "@/components/ui/empty-state";
import { SparkIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

import { AnalystChat } from "./chat";

export const metadata = { title: "Analítico" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

export default async function AnaliticoPage() {
  // Página por pedido: lee la sesión y la hora actual (ver la nota de `instant` en el layout del CRM).
  await connection();
  const profile = await getCurrentProfile();

  // Es de la administración: superadmin y consulta y reportes. Los operadores no ven el gasto ni los totales.
  if (profile.role === "operator") {
    return <NoAccess title="Analítico" reason="Solo el superadministrador y los usuarios de consulta y reportes pueden usar el agente analítico." />;
  }

  const supabase = await createClient();
  const { data: agent } = await supabase.from("agents").select("name, is_enabled").eq("kind", "analytic").maybeSingle();

  return (
    <main className="flex flex-1 flex-col">
      <PageHeader title="Analítico" description="Preguntas de negocio en lenguaje natural, con los datos de tu organización. Solo lectura." />

      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        {!agent ? (
          <EmptyState
            icon={<SparkIcon className="size-6" />}
            title="Todavía no hay un agente analítico"
            description="Se carga con la sección «agentes» del archivo de configuración del cliente."
          />
        ) : !agent.is_enabled ? (
          <EmptyState
            icon={<SparkIcon className="size-6" />}
            title={`${agent.name} está apagado`}
            description="Un superadministrador lo puede encender desde la sección Agentes."
          />
        ) : (
          <AnalystChat agentName={agent.name} />
        )}
      </div>
    </main>
  );
}
