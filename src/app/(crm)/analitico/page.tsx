import { getCurrentProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

import { AnalystChat } from "./chat";

export default async function AnaliticoPage() {
  const profile = await getCurrentProfile();

  // Es de la administración: superadmin y consulta y reportes. Los operadores no ven el gasto ni los totales.
  if (profile.role === "operator") {
    return (
      <main className="p-6">
        <h1 className="text-xl font-semibold tracking-tight">Analítico</h1>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Solo el superadministrador y los usuarios de consulta y reportes pueden usar el agente analítico.
        </p>
      </main>
    );
  }

  const supabase = await createClient();
  const { data: agent } = await supabase.from("agents").select("name, is_enabled").eq("kind", "analytic").maybeSingle();

  return (
    <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight">Analítico</h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Preguntas de negocio en lenguaje natural, con los datos de tu organización. Solo lectura.</p>
      </header>

      {!agent ? (
        <p className="card p-4 text-sm text-zinc-600 dark:text-zinc-400">
          Todavía no hay un agente analítico configurado. Se carga con la sección <code>agentes</code> del archivo de configuración del cliente.
        </p>
      ) : !agent.is_enabled ? (
        <p className="card p-4 text-sm text-zinc-600 dark:text-zinc-400">
          {agent.name} está apagado. Un superadministrador lo puede encender desde la sección Agentes.
        </p>
      ) : (
        <AnalystChat agentName={agent.name} />
      )}
    </main>
  );
}
