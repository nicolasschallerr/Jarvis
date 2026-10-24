import type { AgentView } from "@/components/agents/agent-card";
import { getCurrentProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

import { AgentForm } from "./agent-form";

export default async function AgentesPage() {
  const profile = await getCurrentProfile();

  if (profile.role !== "superadmin") {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold tracking-tight">Agentes</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Solo un superadministrador puede ver y cambiar los agentes.</p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: agents, error } = await supabase
    .from("agents")
    .select("id, kind, name, tagline, status, is_enabled")
    .order("kind");

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <h1 className="text-xl font-semibold tracking-tight">Agentes</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Cómo se llaman y si están atendiendo.</p>
      </header>

      {error ? (
        <p className="p-6 text-sm text-red-600 dark:text-red-400">No se pudieron cargar los agentes. Probá recargar.</p>
      ) : (agents ?? []).length === 0 ? (
        <p className="p-6 text-sm text-zinc-600 dark:text-zinc-400">
          Todavía no hay agentes. Se cargan con el script de configuración del cliente.
        </p>
      ) : (
        <div className="grid gap-6 p-6 lg:grid-cols-2">
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
