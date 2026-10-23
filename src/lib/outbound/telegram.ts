import { ChannelSendError } from "./errors";

// Telegram acepta hasta 4096 caracteres por mensaje.
export const TELEGRAM_MAX_TEXT = 4096;

type TelegramSendResponse = {
  ok: boolean;
  result?: { message_id: number; date: number };
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

export type SentMessage = {
  // Mismo formato que usa la ingesta: <chat>:<mensaje>.
  externalId: string;
  providerTimestamp: string;
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

// Envía un texto a un chat de Telegram con sendMessage. El token se pasa por parámetro y nunca se
// registra ni se incluye en los errores.
export async function sendTelegramText(params: {
  token: string;
  chatId: string;
  text: string;
  fetchImpl?: FetchLike;
}): Promise<SentMessage> {
  const { token, chatId, text, fetchImpl = fetch } = params;

  if (text.length === 0) {
    throw new ChannelSendError("El mensaje está vacío", "empty", false);
  }
  if (text.length > TELEGRAM_MAX_TEXT) {
    throw new ChannelSendError(`El mensaje supera los ${TELEGRAM_MAX_TEXT} caracteres`, "too-long", false);
  }

  let response: Response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    // Falla de red: no se incluye el detalle porque podría contener la URL con el token.
    throw new ChannelSendError("No se pudo contactar a Telegram", "network", true);
  }

  let data: TelegramSendResponse;
  try {
    data = (await response.json()) as TelegramSendResponse;
  } catch {
    throw new ChannelSendError(`Respuesta inválida de Telegram (${response.status})`, response.status, response.status >= 500);
  }

  if (!data.ok || !data.result) {
    const code = data.error_code ?? response.status;
    const retryAfter = data.parameters?.retry_after ?? null;
    // 429 (límite de velocidad) y 5xx se pueden reintentar; 400/403 (chat inexistente, bot bloqueado) no.
    const retryable = code === 429 || code >= 500;
    throw new ChannelSendError(data.description ?? `Telegram rechazó el envío (${code})`, code, retryable, retryAfter);
  }

  return {
    externalId: `${chatId}:${data.result.message_id}`,
    providerTimestamp: new Date(data.result.date * 1000).toISOString(),
  };
}
