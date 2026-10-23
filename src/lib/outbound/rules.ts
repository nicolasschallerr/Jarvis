import type { ChannelType } from "@/lib/inbound/types";

const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

// ¿Se puede mandar un mensaje de texto libre ahora? En WhatsApp solo dentro de las 24 h desde el
// último mensaje del contacto; fuera de esa ventana hay que usar una plantilla aprobada por Meta.
// Telegram no tiene esa restricción: por eso esta regla vive acá, probada con tests, y no en el
// canal de desarrollo. Hay que validarla con el número real en la Fase 14.
// Los otros canales (Instagram, Messenger) tienen reglas propias que se agregan cuando se conecten.
export function canSendFreeText(
  channelType: ChannelType,
  lastInboundAt: Date | null,
  now: Date,
): boolean {
  if (channelType !== "whatsapp") {
    return true;
  }

  if (!lastInboundAt) {
    return false;
  }

  return now.getTime() - lastInboundAt.getTime() < WHATSAPP_WINDOW_MS;
}
