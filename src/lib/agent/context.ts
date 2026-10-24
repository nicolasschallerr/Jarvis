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
  units: z.array(z.object({ id: z.string(), name: z.string(), sector: z.string(), handoffMessage: z.string().nullable().default(null) })),
  sectors: z.array(z.object({ id: z.string(), name: z.string() })),
  defaultSector: z.string().nullable(),
  sensitiveTopics: z.array(
    z.object({ id: z.string(), description: z.string(), sector: z.string(), priority: z.string() }),
  ),
  // Un documento de conocimiento por unidad (id de la unidad → texto).
  knowledge: z.record(z.string(), z.string()),
  // Textos fijos que envía el sistema sin pasar por el modelo (null = no configurado).
  menuText: z.string().nullable().default(null),
  handoffMessage: z.string().nullable().default(null),
  // Datos que se juntan, con su validación y dónde se guardan (ver ADR-022). Cuántos intentos fallidos
  // se toleran por dato antes de pasar a una persona.
  fields: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        regex: z.string().nullable(),
        help: z.string().nullable(),
        clean: z.enum(["digits"]).nullable(),
        store: z.enum(["case", "contact_name", "contact_document", "contact_locality"]),
        units: z.array(z.string()).nullable(),
        required: z.boolean(),
        fromChannel: z.boolean().default(false),
      }),
    )
    .default([]),
  maxFieldRetries: z.number().default(3),
  // Cuántos datos se pueden pedir en un mismo mensaje.
  fieldsPerMessage: z.number().default(3),
  // Recordatorios cuando el caso espera al asociado: horas desde que quedó esperando y texto a enviar.
  followups: z
    .object({ active: z.boolean(), hours: z.array(z.number()), text: z.string().nullable() })
    .default({ active: false, hours: [], text: null }),
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

  if (settings.fields.length > 0) {
    const describeField = (field: AttentionSettings["fields"][number]) =>
      `- \`${field.id}\`: ${field.label}${field.required ? "" : " (opcional)"}${field.help ? `. ${field.help}` : ""}${field.fromChannel ? " (si escribe por WhatsApp se toma del número: no se lo pidas)" : ""}`;
    const perMessage =
      settings.fieldsPerMessage <= 1
        ? "Pedí los datos de a uno por mensaje, en el orden de la lista."
        : `Juntá los datos en la menor cantidad de mensajes posible: pedí los que falten juntos, en un solo mensaje escrito con naturalidad, hasta ${settings.fieldsPerMessage} por mensaje.`;
    const common = settings.fields.filter((field) => field.units === null);
    const lines = [
      "## Datos a juntar (usá estos nombres exactos en guardar_datos_del_caso)",
      `${perMessage} Si la persona ya dio algún dato (aunque sea dentro de otra frase), guardalo y no se lo vuelvas a pedir. Guardá los datos apenas los dé. Si un dato es inválido, explicale cómo escribirlo y pedí solo ese. Tras superar los intentos permitidos con un dato, derivá a una persona.`,
    ];
    if (common.length > 0) lines.push("", "En todas las áreas:", ...common.map(describeField));
    for (const unit of settings.units) {
      const own = settings.fields.filter((field) => field.units?.includes(unit.id));
      if (own.length > 0) lines.push("", `Solo en ${unit.name} (\`${unit.id}\`):`, ...own.map(describeField));
    }
    sections.push(lines.join("\n"));
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

// Comando universal MENÚ: en cualquier momento, escribir esa palabra (con o sin tilde, en mayúsculas o
// minúsculas, con puntuación alrededor) vuelve al menú principal.
export function isMenuCommand(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  return normalized === "menu";
}

// El historial que ve el agente empieza en el último MENÚ del asociado: lo anterior ya no cuenta. El MENÚ
// y la respuesta con el menú se conservan, así el agente entiende un "3" que contesta ese menú.
export function sinceLastMenu<T extends HistoryRow>(rows: T[]): T[] {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row && row.direction === "inbound" && row.type === "text" && isMenuCommand(row.body)) return rows.slice(index);
  }
  return rows;
}

// Mensaje oficial de derivación: el de la unidad si lo tiene, si no el general. Lo envía el sistema tal
// cual (reemplazando {{sector}}), así sale idéntico siempre. null si el cliente no lo configuró.
export function handoffText(settings: AttentionSettings, sectorId: string, unitId: string | null): string | null {
  const unit = unitId ? settings.units.find((candidate) => candidate.id === unitId) : undefined;
  const template = unit?.handoffMessage ?? settings.handoffMessage;
  if (!template) return null;
  const sectorName = settings.sectors.find((sector) => sector.id === sectorId)?.name ?? sectorId;
  return template.replace(/\{\{sector\}\}/g, sectorName).trim();
}
