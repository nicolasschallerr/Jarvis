import { channelLabel } from "@/lib/crm/format";

// Inicial del canal en un punto chico sobre el avatar de la bandeja: se ve de un vistazo por dónde escribió cada
// persona sin leer la fila. Monocromo y con los colores del tema (sin logos ni colores de marca). Es decorativo: el
// nombre del canal ya está escrito en la fila.
const INITIALS: Record<string, string> = { whatsapp: "W", instagram: "I", messenger: "M", telegram: "T" };

export function ChannelDot({ channel }: { channel: string }) {
  const initial = INITIALS[channel] ?? (channel[0]?.toLocaleUpperCase("es-AR") || "?");
  return (
    <span
      className="absolute -right-0.5 -bottom-0.5 grid size-4 place-items-center rounded-full bg-foreground text-[9px] leading-none font-bold text-surface ring-2 ring-surface"
      title={channelLabel(channel)}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}
