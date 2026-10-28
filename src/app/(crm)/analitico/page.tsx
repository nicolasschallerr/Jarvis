import { connection } from "next/server";

import { AgentChat, type Suggestion } from "@/components/assistant/agent-chat";
import { AssistantOrb } from "@/components/assistant/assistant-orb";
import { NoAccess } from "@/components/ui/empty-state";
import { getCurrentProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

import { askAnalystAction } from "./actions";

export const metadata = { title: "Analítico" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

const TOOL_LABELS: Record<string, string> = {
  contar_casos: "casos",
  tiempos_de_resolucion: "tiempos de resolución",
  contar_conversaciones: "conversaciones",
  consultas_al_area: "consultas al área",
  resumen_de_consumo: "consumo",
};

const SUGGESTIONS: Suggestion[] = [
  { topic: "casos", question: "¿Cuántos casos abiertos hay por sector?" },
  { topic: "casos", question: "¿Cuánto tardamos en resolver los casos este mes?" },
  { topic: "conversaciones", question: "¿Cuántas conversaciones atendimos esta semana, por canal?" },
  { topic: "casos", question: "¿Qué sector tarda más en responder las consultas del agente?" },
  { topic: "consumo", question: "¿Cuántos créditos de IA usamos este mes?" },
  { topic: "casos", question: "¿Quién del equipo tiene más casos asignados?" },
];

// El agente analítico (Mateo): el mismo chat que el Asistente, en su color, enfocado en la operación del CRM.
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
  const firstName = profile.fullName.trim().split(/\s+/)[0] ?? "";

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">Analítico</h1>
      {!agent || !agent.is_enabled ? (
        <section
          className="rise-in mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 px-4 py-12 text-center"
          style={{ ["--agent-assistant" as string]: "var(--agent-sinapsis)" }}
        >
          <AssistantOrb className="size-24 opacity-60 grayscale" />
          <h2 className="font-display text-xl font-semibold">{agent ? `${agent.name} está apagado` : "Todavía no hay un agente analítico"}</h2>
          <p className="text-sm text-muted">
            {agent
              ? "Un superadministrador lo puede encender desde la sección Agentes."
              : "Se carga con la sección «agentes» del archivo de configuración del cliente."}
          </p>
        </section>
      ) : (
        <AgentChat
          action={askAnalystAction}
          tint="analytic"
          agentName={agent.name}
          firstName={firstName}
          organizationName={profile.organizationName}
          suggestions={SUGGESTIONS}
          toolLabels={TOOL_LABELS}
          heading={`¿Qué querés saber de la operación${firstName ? `, ${firstName}` : ""}?`}
          intro={`Soy ${agent.name}, el agente analítico. Te respondo con números reales de la atención: casos, tiempos, conversaciones, áreas y consumo de la IA.`}
          footnote={`${agent.name} solo lee: los números salen del CRM de ${profile.organizationName} y no incluye datos personales.`}
        />
      )}
    </main>
  );
}
