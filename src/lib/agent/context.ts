import { z } from "zod";

import type { ChatMessage } from "@/lib/ai/types";

// Lo que el agente necesita saber de la configuración del cliente. Se guarda en agent_configs.settings
// (cargado desde clientes/<slug>/); nada de esto está escrito en el código.
export const attentionSettingsSchema = z.object({
  organizationName: z.string(),
  agentName: z.string(),
  timeZone: z.string(),
  businessHours: z
    .object({ days: z.array(z.string()), from: z.string(), to: z.string(), holidays: z.array(z.string()) })
    .nullable(),
  units: z.array(z.object({ id: z.string(), name: z.string(), sector: z.string() })),
  sectors: z.array(z.object({ id: z.string(), name: z.string() })),
  defaultSector: z.string().nullable(),
  sensitiveTopics: z.array(
    z.object({ id: z.string(), description: z.string(), sector: z.string(), priority: z.string() }),
  ),
  // Un documento de conocimiento por unidad (id de la unidad → texto).
  knowledge: z.record(z.string(), z.string()),
  // Precios en USD por millón de tokens, solo si el cliente los configura: nunca se asumen.
  pricing: z.object({ inputPerMTok: z.number(), outputPerMTok: z.number() }).nullable().default(null),
});

export type AttentionSettings = z.infer<typeof attentionSettingsSchema>;

const WEEKDAYS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

// ¿Estamos dentro del horario de atención? Se calcula con la zona horaria del cliente, no la del
// servidor (Vercel corre en UTC).
export function isWithinBusinessHours(now: Date, settings: AttentionSettings): boolean {
  const hours = settings.businessHours;
  if (!hours) return true;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  }).formatToParts(now);

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  const time = `${get("hour")}:${get("minute")}`;
  const weekdayIndex = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const weekday = WEEKDAYS[weekdayIndex];

  if (hours.holidays.includes(date)) return false;
  if (!weekday || !hours.days.includes(weekday)) return false;
  return time >= hours.from && time < hours.to;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
}

// Arma las instrucciones completas: el prompt del cliente (con sus variables), el contexto de la
// organización, el estado del horario y el conocimiento de cada unidad. Es igual en todos los turnos
// de un cliente salvo la línea del horario, que va al final para no romper la caché del resto.
export function buildSystemPrompt(prompt: string, settings: AttentionSettings, now: Date): string {
  const sections = [
    fill(prompt, { nombre_agente: settings.agentName, nombre_organizacion: settings.organizationName }),
  ];

  sections.push(
    [
      "## Unidades y sectores (usá exactamente estos identificadores en las herramientas)",
      ...settings.units.map((unit) => `- Unidad \`${unit.id}\` (${unit.name}) → sector \`${unit.sector}\``),
      ...settings.sectors.map((sector) => `- Sector \`${sector.id}\`: ${sector.name}`),
      settings.defaultSector ? `- Si no identificás la unidad, derivá al sector \`${settings.defaultSector}\`.` : "",
    ]
      .filter(Boolean)
      .join("\n"),
  );

  if (settings.sensitiveTopics.length > 0) {
    sections.push(
      [
        "## Temas sensibles (derivá sin intentar resolverlos)",
        ...settings.sensitiveTopics.map(
          (topic) => `- ${topic.description} → sector \`${topic.sector}\`, prioridad ${topic.priority}`,
        ),
      ].join("\n"),
    );
  }

  for (const unit of settings.units) {
    const text = settings.knowledge[unit.id];
    if (text) sections.push(`## Base de conocimiento: ${unit.name}\n\n${text.trim()}`);
  }

  sections.push(
    "## Cómo usar las herramientas\n\nGuardá los datos con `guardar_datos_del_caso` apenas el asociado los dé. Cuando tengas todo lo que pide la unidad, usá `derivar_a_sector`. Si falta un dato que solo sabe el área, usá `consultar_al_area`. Después de usar una herramienta, escribile al asociado un mensaje breve que diga qué pasó y qué sigue. Respondé siempre con el texto que se le envía al asociado, sin explicar tu razonamiento.",
  );

  sections.push(
    isWithinBusinessHours(now, settings)
      ? "## Horario\n\nAhora el equipo está dentro del horario de atención."
      : "## Horario\n\nAhora el equipo está FUERA del horario de atención: tomá la consulta completa, derivala y avisá que el equipo la va a ver en el próximo horario hábil.",
  );

  return sections.join("\n\n");
}

export type HistoryRow = {
  direction: "inbound" | "outbound";
  type: string;
  body: string | null;
  transcription: string | null;
};

// Lo que el agente "lee" de un mensaje. Los adjuntos que todavía no se entienden (audio, imagen,
// PDF: Fase 7) se mencionan para que el agente le pida al asociado que lo escriba.
export function describeMessage(row: HistoryRow): string {
  const text = (row.transcription ?? row.body ?? "").trim();
  switch (row.type) {
    case "text":
      return text;
    case "audio":
      return text ? `[Audio transcripto] ${text}` : "[El asociado envió un audio que todavía no puedo escuchar]";
    case "image":
      return text ? `[Imagen con texto] ${text}` : "[El asociado envió una imagen que todavía no puedo ver]";
    case "document":
      return text ? `[Documento] ${text}` : "[El asociado envió un documento que todavía no puedo leer]";
    default:
      return text || "[Mensaje de un tipo que todavía no puedo leer]";
  }
}

// Convierte el historial guardado en turnos user/assistant. La API exige que se alternen y que el
// primero sea del usuario: los mensajes seguidos del mismo lado se juntan y se descarta lo previo
// al primer mensaje del asociado.
export function buildHistory(rows: HistoryRow[]): ChatMessage[] {
  const turns: Array<{ role: "user" | "assistant"; text: string }> = [];

  for (const row of rows) {
    const text = describeMessage(row);
    if (!text) continue;
    const role = row.direction === "inbound" ? "user" : "assistant";
    const last = turns[turns.length - 1];
    if (last && last.role === role) last.text += `\n${text}`;
    else turns.push({ role, text });
  }

  while (turns.length > 0 && turns[0]?.role !== "user") turns.shift();

  return turns.map((turn) =>
    turn.role === "user"
      ? { role: "user", content: turn.text }
      : { role: "assistant", content: [{ type: "text", text: turn.text }] },
  );
}
