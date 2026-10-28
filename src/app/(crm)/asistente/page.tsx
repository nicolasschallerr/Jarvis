import { connection } from "next/server";

import { NoAccess } from "@/components/ui/empty-state";
import { ASSISTANT_NAME } from "@/lib/assistant/ask";
import { getCurrentProfile } from "@/lib/auth/profile";
import { createClient } from "@/lib/supabase/server";

import { AssistantChat, type Suggestion } from "./assistant-chat";

export const metadata = { title: "Asistente" };

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

const TOOL_LABELS: Record<string, string> = {
  contar_casos: "casos",
  tiempos_de_resolucion: "tiempos de resolución",
  contar_conversaciones: "conversaciones",
  consultas_al_area: "consultas al área",
  resumen_de_consumo: "consumo",
  resumen_financiero: "resumen financiero",
  por_categoria: "categorías",
  evolucion_mensual: "evolución mensual",
  pendientes: "pendientes",
  buscar_en_catalogo: "stock",
  ver_ficha_del_catalogo: "ficha del producto",
  buscar_movimientos: "movimientos",
  buscar_casos: "búsqueda de casos",
  contar_contactos: "contactos",
};

const SUGGESTIONS: Suggestion[] = [
  { topic: "finanzas", question: "¿Cuántos préstamos de 2 millones hicimos este mes?" },
  { topic: "casos", question: "¿Cuántos casos de garantía abrimos este mes y cuántos siguen abiertos?" },
  { topic: "stock", question: "¿Qué productos están agotados o con pocas unidades?" },
  { topic: "finanzas", question: "¿Quién nos debe plata y cuánto está vencido?" },
  { topic: "conversaciones", question: "¿Cuántas conversaciones atendimos esta semana?" },
  { topic: "contactos", question: "¿Cuántos contactos nuevos se sumaron este mes?" },
];

// El Asistente de la empresa (ADR-050): siempre encendido, responde sobre todos los datos de la organización.
export default async function AsistentePage() {
  await connection();
  const profile = await getCurrentProfile();

  if (profile.role === "operator") {
    return <NoAccess title="Asistente" reason="Solo el superadministrador y los usuarios de consulta y reportes pueden usar el Asistente." />;
  }

  const supabase = await createClient();
  const { data: agent } = await supabase.from("agents").select("name").eq("kind", "assistant").maybeSingle();

  return (
    <main className="flex min-h-0 flex-1 flex-col">
      <h1 className="sr-only">{agent?.name ?? ASSISTANT_NAME}</h1>
      <AssistantChat
        agentName={agent?.name ?? ASSISTANT_NAME}
        firstName={profile.fullName.trim().split(/\s+/)[0] ?? ""}
        organizationName={profile.organizationName}
        suggestions={SUGGESTIONS}
        toolLabels={TOOL_LABELS}
      />
    </main>
  );
}
