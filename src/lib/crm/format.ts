const CHANNEL_LABELS: Record<string, string> = {
  whatsapp: "WhatsApp",
  telegram: "Telegram",
};

const TYPE_LABELS: Record<string, string> = {
  audio: "Audio",
  image: "Foto",
  document: "Documento",
  video: "Video",
  sticker: "Sticker",
  location: "Ubicación",
  unsupported: "Mensaje no compatible",
};

export function channelLabel(type: string): string {
  return CHANNEL_LABELS[type] ?? type;
}

// Texto corto de lo último que se dijo: el cuerpo si lo hay, si no el tipo de adjunto.
export function messagePreview(body: string | null, type: string | null): string {
  if (body) return body;
  if (type && type !== "text") return `[${TYPE_LABELS[type] ?? type}]`;
  return "";
}

const dayFormat = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: "America/Argentina/Buenos_Aires" });
const timeFormat = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });

const dateTimeFormat = new Intl.DateTimeFormat("es-AR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "America/Argentina/Buenos_Aires",
});

export function dateTime(iso: string | null): string {
  return iso ? dateTimeFormat.format(new Date(iso)) : "";
}

const SENDER_LABELS: Record<string, string> = {
  agent: "Jarvis (IA)",
  operator: "Operador",
  system: "Sistema",
};

// Quién escribió, para la burbuja: el contacto con su nombre, el resto por su rol.
export function senderLabel(sender: string, contactName: string | null): string {
  return sender === "contact" ? contactName || "Contacto" : (SENDER_LABELS[sender] ?? sender);
}

export const STATUS_LABELS: Record<string, string> = {
  new: "Nuevo",
  in_progress: "En curso",
  waiting_contact: "Esperando al contacto",
  waiting_area: "Esperando al área",
  resolved: "Resuelto",
};

export const PRIORITY_LABELS: Record<string, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

export type EventNames = { sectors: Map<string, string>; profiles: Map<string, string> };

type CaseEventRow = { event_type: string; actor_type: string; actor_profile_id: string | null; data: unknown };

function field(data: unknown, key: string): string | null {
  if (typeof data !== "object" || data === null) return null;
  const value = (data as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

// Frase para el historial del caso: qué cambió y quién lo hizo.
export function describeCaseEvent(event: CaseEventRow, names: EventNames): { text: string; actor: string } {
  const actor =
    event.actor_type === "operator" && event.actor_profile_id
      ? (names.profiles.get(event.actor_profile_id) ?? "Operador")
      : event.actor_type === "agent"
        ? "Jarvis (IA)"
        : "Sistema";

  const sector = (id: string | null) => (id ? (names.sectors.get(id) ?? "sector desconocido") : "sin sector");
  const person = (id: string | null) => (id ? (names.profiles.get(id) ?? "persona desconocida") : "sin asignar");
  const status = (value: string | null) => STATUS_LABELS[value ?? ""] ?? value ?? "";
  const priority = (value: string | null) => PRIORITY_LABELS[value ?? ""] ?? value ?? "";

  switch (event.event_type) {
    case "created":
      return { text: "Caso creado", actor };
    case "status_changed":
      return { text: `Estado: ${status(field(event.data, "from"))} → ${status(field(event.data, "to"))}`, actor };
    case "priority_changed":
      return { text: `Prioridad: ${priority(field(event.data, "from"))} → ${priority(field(event.data, "to"))}`, actor };
    case "sector_changed":
      return { text: `Sector: ${sector(field(event.data, "from"))} → ${sector(field(event.data, "to"))}`, actor };
    case "assigned":
      return { text: `Asignación: ${person(field(event.data, "from"))} → ${person(field(event.data, "to"))}`, actor };
    default:
      return { text: event.event_type, actor };
  }
}

// Hora si es de hoy, fecha si es de otro día (siempre en horario de Argentina).
export function shortDate(iso: string | null, now: Date): string {
  if (!iso) return "";
  const date = new Date(iso);
  return dayFormat.format(date) === dayFormat.format(now) ? timeFormat.format(date) : dayFormat.format(date);
}

// Primera letra en mayúscula y el resto como está. Reemplaza a la clase CSS `capitalize`, que pone en mayúscula
// cada palabra ("24 De Octubre").
export function capitalizeFirst(text: string): string {
  return text.charAt(0).toLocaleUpperCase("es-AR") + text.slice(1);
}

// Nombre legible del tipo de un mensaje o adjunto ("image" → "Foto").
export function typeLabel(type: string): string {
  return TYPE_LABELS[type] ?? "Archivo";
}

const MIME_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "imagen",
  "image/png": "imagen",
  "image/webp": "imagen",
  "image/gif": "imagen",
  "audio/ogg": "audio",
  "audio/mpeg": "audio",
  "audio/mp4": "audio",
  "video/mp4": "video",
};

// Tipo de archivo para mostrar ("application/pdf" → "PDF").
export function mimeLabel(mime: string): string {
  return MIME_LABELS[mime.split(";")[0]?.trim().toLowerCase() ?? ""] ?? "archivo";
}

// Nombre legible de un dato juntado por el agente ("situacion_laboral" → "Situacion laboral").
export function fieldLabel(key: string): string {
  return capitalizeFirst(key.replace(/_/g, " ").trim());
}

const timeOnlyFormat = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Argentina/Buenos_Aires" });
const dayHeadingFormat = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Argentina/Buenos_Aires" });

// Hora corta (15:20).
export function timeOnly(iso: string | null): string {
  return iso ? timeOnlyFormat.format(new Date(iso)) : "";
}

// Encabezado de un día dentro de una conversación: "Hoy", "Ayer" o "Lunes 20 de octubre".
export function dayHeading(iso: string, now: Date): string {
  const day = dayFormat.format(new Date(iso));
  if (day === dayFormat.format(now)) return "Hoy";
  if (day === dayFormat.format(new Date(now.getTime() - 86_400_000))) return "Ayer";
  return capitalizeFirst(dayHeadingFormat.format(new Date(iso)));
}

// Clave de día para agrupar mensajes (en horario de Argentina).
export function dayKeyOf(iso: string): string {
  return dayFormat.format(new Date(iso));
}
