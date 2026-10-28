import Link from "next/link";
import { connection } from "next/server";
import { byAgentOrder, toAgentKind, type AgentView } from "@/components/agents/agent-card";
import { EmptyState, NoAccess } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
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
  const [{ data: allAgents, error }, { count: products }, { count: sources }] = await Promise.all([
    supabase.from("agents").select("id, kind, name, status, is_enabled").order("kind"),
    supabase.from("catalog_items").select("id", { count: "exact", head: true }).eq("is_available", true),
    supabase.from("catalog_sources").select("id", { count: "exact", head: true }),
  ]);
  // Solo los agentes que son compañeros visibles del equipo (la base tiene otros tipos internos).
  const agents = (allAgents ?? [])
    .filter((agent) => toAgentKind(agent.kind) !== null)
    .sort((a, b) => byAgentOrder(toAgentKind(a.kind) ?? "attention", toAgentKind(b.kind) ?? "attention"));

  return (
    <main className="flex flex-1 flex-col">
      <PageHeader title="Agentes" description="Cómo se llaman, qué hacen y si están trabajando." />

      {error ? (
        <ErrorBanner>No se pudieron cargar los agentes. Probá recargar.</ErrorBanner>
      ) : agents.length === 0 ? (
        <EmptyState
          icon={<BotIcon className="size-6" />}
          title="Todavía no hay agentes"
          description="Se cargan con el script de configuración del cliente."
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 p-4 sm:p-6 lg:grid-cols-2 2xl:grid-cols-3">
          {agents.map((agent) => {
            const kind = toAgentKind(agent.kind) ?? "attention";
            const view: AgentView = {
              kind,
              name: agent.name,
              status: agent.status === "working" || agent.status === "waiting_approval" ? agent.status : "paused",
              isEnabled: agent.is_enabled,
            };
            return (
              <AgentForm key={agent.id} id={agent.id} agent={view}>
                {kind === "stock" ? (
                  <p className="text-sm text-muted">
                    {products ?? 0} productos disponibles
                    {sources ? ` en ${sources} ${sources === 1 ? "fuente" : "fuentes"}` : ""}.{" "}
                    <Link href="/stock" className="font-medium text-accent hover:underline">
                      Ver el stock
                    </Link>
                  </p>
                ) : kind === "assistant" ? (
                  <p className="text-sm text-muted">
                    Responde cualquier pregunta sobre los datos de la organización.{" "}
                    <Link href="/asistente" className="font-medium text-accent hover:underline">
                      Abrir el Asistente
                    </Link>
                  </p>
                ) : kind === "finance" ? (
                  <p className="text-sm text-muted">
                    Lee los movimientos de la empresa y responde sobre ingresos, gastos y cobranzas.{" "}
                    <Link href="/finanzas" className="font-medium text-accent hover:underline">
                      Ver Finanzas
                    </Link>
                  </p>
                ) : null}
              </AgentForm>
            );
          })}
        </div>
      )}
    </main>
  );
}
