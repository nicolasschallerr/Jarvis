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

// Hora si es de hoy, fecha si es de otro día (siempre en horario de Argentina).
export function shortDate(iso: string | null, now: Date): string {
  if (!iso) return "";
  const date = new Date(iso);
  return dayFormat.format(date) === dayFormat.format(now) ? timeFormat.format(date) : dayFormat.format(date);
}
