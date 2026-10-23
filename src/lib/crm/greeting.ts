export const DEFAULT_TIME_ZONE = "America/Argentina/Buenos_Aires";

// "Buen día" hasta el mediodía, "buenas tardes" hasta las 20 y "buenas noches" después, en la hora de
// la organización (no la del servidor, que corre en otra zona).
export function greetingFor(date: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  const hour = Number(
    new Intl.DateTimeFormat("es-AR", { hour: "numeric", hourCycle: "h23", timeZone }).format(date),
  );

  if (hour >= 6 && hour < 12) return "Buen día";
  if (hour >= 12 && hour < 20) return "Buenas tardes";
  return "Buenas noches";
}

// "viernes 23 de octubre", en la hora de la organización.
export function longDate(date: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone }).format(date);
}
