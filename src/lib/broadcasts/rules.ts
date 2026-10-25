import { templateVariables } from "@/lib/whatsapp/templates";

// Reglas de los envíos masivos que no tocan la base (ADR-038).

export const BROADCAST_MAX_RECIPIENTS = 5000;
export const MAX_NAME_LENGTH = 80;
export const MAX_SCHEDULE_DAYS = 60;

// La variable {{1}} (o {{nombre}}) se completa con el nombre de cada contacto. Las demás las escribe quien crea el
// envío, una vez, igual para todos.
export const NAME_VARIABLES = ["1", "nombre", "name", "first_name"];

export function isNameVariable(key: string): boolean {
  return NAME_VARIABLES.includes(key.toLowerCase());
}

// Variables del cuerpo que hay que completar a mano (todas menos el nombre) y todavía están vacías.
export function missingVariables(body: string, values: Record<string, string>): string[] {
  return templateVariables(body).filter((key) => !isNameVariable(key) && (values[key] ?? "").trim() === "");
}

export function firstName(displayName: string | null | undefined): string {
  return (displayName ?? "").trim().split(/\s+/)[0] ?? "";
}

// Valores de un contacto: los fijos del envío y su nombre. null si la plantilla pide el nombre y el contacto no tiene.
export function valuesForContact(body: string, fixed: Record<string, string>, displayName: string | null | undefined): Record<string, string> | null {
  const values: Record<string, string> = {};
  for (const key of templateVariables(body)) {
    if (isNameVariable(key)) {
      const name = firstName(displayName);
      if (!name) return null;
      values[key] = name;
    } else {
      values[key] = fixed[key] ?? "";
    }
  }
  return values;
}

// La localidad se usa dentro de un "contiene" de la base: se sacan los comodines (% _ \) para que no cambien el sentido.
export function cleanLocality(value: string): string {
  return value.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export type Segment = { locality?: string };

export function segmentOf(raw: unknown): Segment {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const locality = (raw as Record<string, unknown>).locality;
  return typeof locality === "string" && locality.trim() ? { locality: cleanLocality(locality) } : {};
}

export function fixedValuesOf(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
}

export const BROADCAST_STATUS_LABELS: Record<string, string> = {
  draft: "Borrador",
  scheduled: "Programado",
  sending: "Enviando",
  done: "Terminado",
  cancelled: "Cancelado",
};

// "2026-10-30T09:00" escrito como hora de la organización → el instante real (UTC). Un campo datetime-local no trae zona:
// se la ponemos acá, la de la organización, no la del servidor ni la del navegador.
export function localToUtc(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number) as [number, number, number, number, number, number];
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  if (Number.isNaN(asUtc)) return null;

  // Qué hora marca la zona en ese instante, para saber cuánto se corre respecto de UTC.
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(asUtc));
  const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const shown = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  return new Date(asUtc - (shown - asUtc));
}
