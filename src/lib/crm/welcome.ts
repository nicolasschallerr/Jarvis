import { DEFAULT_TIME_ZONE } from "./greeting";

export type WelcomeCounts = {
  awaitingReply: number;
  myOpenCases: number;
  unassignedCases: number;
  urgentCases: number;
};

// Clave del día en la hora de la organización ("2026-10-23"). La bienvenida completa se muestra una vez
// por día y por navegador: se compara con la que quedó guardada.
export function dayKey(date: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  // El formato sueco da año-mes-día, ordenable y sin ambigüedad.
  return new Intl.DateTimeFormat("sv-SE", { year: "numeric", month: "2-digit", day: "2-digit", timeZone }).format(date);
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// Lo que dice cada agente al recibirte. Son datos reales de la bandeja, dichos en voz del agente: ninguna
// frase afirma algo que el agente hizo (los agentes todavía no responden por su cuenta).
export function welcomeLine(kind: "attention" | "analytic" | "stock" | "finance" | "assistant", counts: WelcomeCounts, products = 0): string {
  if (kind === "assistant") return "Estoy siempre encendido: preguntame lo que quieras sobre la empresa.";
  if (kind === "finance") return "Preguntame por los números de la empresa: están en Finanzas.";
  if (kind === "stock") {
    if (products === 0) return "Todavía no hay stock cargado.";
    return products === 1 ? "Tengo 1 producto en el catálogo." : `Tengo ${products} productos en el catálogo.`;
  }
  if (kind === "attention") {
    if (counts.awaitingReply === 0) return "No hay conversaciones esperando respuesta.";
    return counts.awaitingReply === 1
      ? "Hay 1 conversación esperando respuesta."
      : `Hay ${counts.awaitingReply} conversaciones esperando respuesta.`;
  }

  if (counts.myOpenCases === 0 && counts.unassignedCases === 0) return "No hay casos pendientes por ahora.";

  const parts = [`Tenés ${plural(counts.myOpenCases, "caso abierto", "casos abiertos")}`];
  if (counts.unassignedCases > 0) parts.push(`y ${counts.unassignedCases} sin asignar`);
  let line = `${parts.join(" ")}.`;
  if (counts.urgentCases > 0) {
    line += counts.urgentCases === 1 ? " 1 es urgente." : ` ${counts.urgentCases} son urgentes.`;
  }
  return line;
}
