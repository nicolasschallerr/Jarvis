import { connection } from "next/server";
import type { AgentView } from "@/components/agents/agent-card";
import { EmptyState, NoAccess } from "@/components/ui/empty-state";
import { BotIcon } from "@/components/ui/icons";
import { PageHeader } from "@/components/ui/page-header";
import { getCurrentProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

import { AgentForm } from "./agent-form";

export const metadata = { title: "Agentes" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

export default async function AgentesPage() {
  // Página por pedido: lee la sesión y la hora actual (ver la nota de `instant` en el layout del CRM).
  await connection();
  const profile = await getCurrentProfile();

  if (profile.role !== "superadmin") {
    return <NoAccess title="Agentes" reason="Solo un superadministrador puede ver y cambiar los agentes." />;
  }

  const supabase = await createClient();
  const { data: agents, error } = await supabase
    .from("agents")
    .select("id, kind, name, tagline, status, is_enabled")
    .order("kind");

  return (
    <main className="flex flex-1 flex-col">
      <PageHeader title="Agentes" description="Cómo se llaman, qué hacen y si están trabajando." />

      {error ? (
        <p role="alert" className="p-6 text-sm text-danger">
          No se pudieron cargar los agentes. Probá recargar.
        </p>
      ) : (agents ?? []).length === 0 ? (
        <EmptyState
          icon={<BotIcon className="size-6" />}
          title="Todavía no hay agentes"
          description="Se cargan con el script de configuración del cliente."
        />
      ) : (
        <div className="grid gap-6 p-4 sm:p-6 lg:grid-cols-2">
          {(agents ?? []).map((agent) => {
            const view: AgentView = {
              kind: agent.kind === "attention" ? "attention" : "analytic",
              name: agent.name,
              tagline: agent.tagline,
              status: agent.status === "working" || agent.status === "waiting_approval" ? agent.status : "paused",
              isEnabled: agent.is_enabled,
            };
            return <AgentForm key={agent.id} id={agent.id} agent={view} />;
          })}
        </div>
      )}
    </main>
  );
}
