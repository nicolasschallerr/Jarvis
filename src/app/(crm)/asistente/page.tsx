import { connection } from "next/server";

import { NoAccess } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { ASSISTANT_NAME } from "@/lib/assistant/ask";
import { getCurrentProfile } from "@/lib/auth/profile";

import { AnalystChat } from "../analitico/chat";
import { askAssistantAction } from "./actions";

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

const EXAMPLES = [
  "¿Cuántos movimientos de más de 2 millones hubo este mes?",
  "¿Cuántos casos de garantía abrimos este mes y cuántos siguen abiertos?",
  "¿Qué productos están agotados?",
  "¿Cuánto le pagamos a proveedores en los últimos tres meses?",
  "¿Cuántos contactos nuevos se sumaron este mes?",
  "¿Qué sector tiene más casos abiertos?",
];

export default async function AsistentePage() {
  await connection();
  const profile = await getCurrentProfile();

  if (profile.role === "operator") {
    return <NoAccess title="Asistente" reason="Solo el superadministrador y los usuarios de consulta y reportes pueden usar el Asistente." />;
  }

  return (
    <main className="flex flex-1 flex-col">
      <PageHeader
        title={ASSISTANT_NAME}
        description={`Preguntale lo que quieras sobre ${profile.organizationName}: casos, conversaciones, contactos, stock y finanzas. Siempre encendido, solo lectura.`}
      />
      <div className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
        <AnalystChat
          agentName={ASSISTANT_NAME}
          action={askAssistantAction}
          examples={EXAMPLES}
          toolLabels={TOOL_LABELS}
          intro={`Soy el asistente de ${profile.organizationName}. Respondo con los datos reales de la organización y no modifico nada. Probá con alguna de estas:`}
        />
      </div>
    </main>
  );
}
