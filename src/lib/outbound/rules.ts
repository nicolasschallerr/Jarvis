import type { ChannelType } from "@/lib/inbound/types";

const WINDOW_MS = 24 * 60 * 60 * 1000;
const HUMAN_AGENT_WINDOW_MS = 7 * WINDOW_MS;

// Canales de Meta con ventana de atención: WhatsApp, Messenger e Instagram solo dejan escribir texto libre dentro de
// las 24 h desde el último mensaje de la persona. Telegram y el correo no tienen esa restricción.
const WINDOWED_CHANNELS: ReadonlySet<ChannelType> = new Set(["whatsapp", "messenger", "instagram"]);

// Messenger e Instagram permiten, además, que una PERSONA del equipo responda hasta 7 días después con la etiqueta
// "agente humano". La IA nunca puede usarla (es para respuestas manuales). WhatsApp no tiene algo equivalente: fuera
// de las 24 h solo salen plantillas aprobadas.
const HUMAN_AGENT_CHANNELS: ReadonlySet<ChannelType> = new Set(["messenger", "instagram"]);

export type SendMode =
  // Dentro de las 24 h (o canal sin ventana): texto libre para cualquiera.
  | "free"
  // Entre 24 h y 7 días, en un canal que lo permite y con la etiqueta habilitada: solo una persona.
  | "human_agent"
  // No se puede escribir texto libre.
  | "closed";

export function sendMode(channelType: ChannelType, lastInboundAt: Date | null, now: Date, options: { humanAgentTag?: boolean } = {}): SendMode {
  if (!WINDOWED_CHANNELS.has(channelType)) return "free";
  if (!lastInboundAt) return "closed";

  const elapsed = now.getTime() - lastInboundAt.getTime();
  if (elapsed < WINDOW_MS) return "free";
  if (options.humanAgentTag && HUMAN_AGENT_CHANNELS.has(channelType) && elapsed < HUMAN_AGENT_WINDOW_MS) return "human_agent";
  return "closed";
}

// ¿Se puede mandar un mensaje de texto libre ahora (sin contar la etiqueta de agente humano)? Es la regla que usa el
// agente: dentro de la ventana. Hay que validarla con cuentas reales de Meta.
export function canSendFreeText(channelType: ChannelType, lastInboundAt: Date | null, now: Date): boolean {
  return sendMode(channelType, lastInboundAt, now) === "free";
}
