import type { ChannelType } from "@/lib/inbound/types";

// El agente suele escribir con Markdown (**negrita**, # títulos). Ningún canal de mensajería lo interpreta igual:
// WhatsApp marca la negrita con un solo asterisco; Messenger, Instagram y Telegram (como lo enviamos) no tienen formato y
// mostrarían los asteriscos tal cual. Se adapta al canal antes de enviar, así la persona nunca ve símbolos sueltos.
export function formatForChannel(text: string, channelType: ChannelType): string {
  const bold = channelType === "whatsapp" ? "*$1*" : "$1";
  return text
    .replace(/\*\*([^*\n]+)\*\*/g, bold)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
