import { ChannelSendError } from "./errors";
import type { SentMessage } from "./telegram";
import { DEFAULT_GRAPH_VERSION, graphBase, graphError, sendWhatsAppPayload } from "./whatsapp";

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

// Límites de texto de cada canal de Meta. Instagram cuenta bytes (UTF-8), los otros cuentan caracteres.
export const MESSAGE_LIMITS = {
  whatsapp: { maxChars: 4096, maxBytes: null },
  messenger: { maxChars: 2000, maxBytes: null },
  instagram: { maxChars: null, maxBytes: 1000 },
} as const;

type Limit = { maxChars: number | null; maxBytes: number | null };

function fits(text: string, limit: Limit): boolean {
  return (limit.maxChars === null || text.length <= limit.maxChars) && (limit.maxBytes === null || Buffer.byteLength(text, "utf8") <= limit.maxBytes);
}

// Parte un texto largo en varios mensajes que entren en el límite del canal. Corta donde se nota menos: primero en un
// párrafo, después en un salto de línea, una oración o un espacio, y recién al final en seco.
export function splitText(text: string, limit: Limit): string[] {
  const clean = text.trim();
  if (clean.length === 0) return [];
  const parts: string[] = [];
  let rest = clean;

  while (!fits(rest, limit)) {
    // El mayor prefijo que entra en el límite (por caracteres y por bytes).
    let end = limit.maxChars !== null ? Math.min(limit.maxChars, rest.length) : rest.length;
    while (end > 1 && !fits(rest.slice(0, end), limit)) end -= 1;
    // No cortar a la mitad de un emoji (par sustituto): quedaría un carácter inválido.
    if (end < rest.length && end > 1 && /[\uD800-\uDBFF]/.test(rest[end - 1] ?? "")) end -= 1;

    const head = rest.slice(0, end);
    const floor = Math.floor(end / 3);
    const cut = [head.lastIndexOf("\n\n"), head.lastIndexOf("\n"), head.lastIndexOf(". "), head.lastIndexOf(" ")].find((index) => index >= floor);
    const at = cut === undefined ? end : head[cut] === "." ? cut + 1 : cut;

    parts.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }

  if (rest) parts.push(rest);
  return parts;
}

// Envía un texto libre por WhatsApp (solo dentro de la ventana de 24 h; fuera de ella van plantillas).
export async function sendWhatsAppText(params: { token: string; phoneNumberId: string; to: string; text: string; fetchImpl?: FetchLike; now?: Date }): Promise<SentMessage> {
  const parts = splitText(params.text, MESSAGE_LIMITS.whatsapp);
  if (parts.length === 0) throw new ChannelSendError("El mensaje está vacío", "vacio", false);

  let last: SentMessage | null = null;
  for (const part of parts) {
    last = await sendWhatsAppPayload({
      token: params.token,
      phoneNumberId: params.phoneNumberId,
      payload: { messaging_product: "whatsapp", recipient_type: "individual", to: params.to, type: "text", text: { body: part, preview_url: false } },
      fetchImpl: params.fetchImpl,
      now: params.now,
    });
  }
  return last as SentMessage;
}

// Qué API usa Instagram: con "inicio de sesión de Instagram" (graph.instagram.com y un token de la cuenta) o con
// "inicio de sesión de Facebook" (graph.facebook.com y el token de la página vinculada). Messenger siempre usa la página.
export type InstagramApi = "instagram_login" | "facebook_login";

export function instagramApiFrom(config: unknown): InstagramApi {
  const api = typeof config === "object" && config !== null && !Array.isArray(config) ? (config as Record<string, unknown>).api : null;
  return api === "facebook_login" ? "facebook_login" : "instagram_login";
}

function graphVersion(): string {
  return process.env.META_GRAPH_VERSION?.match(/^v\d+\.\d+$/) ? process.env.META_GRAPH_VERSION : DEFAULT_GRAPH_VERSION;
}

function apiBase(channel: "messenger" | "instagram", api: InstagramApi): string {
  return channel === "instagram" && api === "instagram_login" ? `https://graph.instagram.com/${graphVersion()}` : graphBase();
}

// Envía un texto por Messenger o Instagram (Send API). "me" es la cuenta dueña del token. Con `humanAgent` el mensaje
// va con la etiqueta de agente humano (respuesta manual de una persona hasta 7 días después). El token va solo en el
// encabezado y nunca en un error. Devuelve el id del último mensaje enviado si el texto tuvo que partirse.
export async function sendMessagingText(params: {
  channel: "messenger" | "instagram";
  token: string;
  recipientId: string;
  text: string;
  api?: InstagramApi;
  humanAgent?: boolean;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<SentMessage> {
  const { fetchImpl = fetch } = params;
  const label = params.channel === "instagram" ? "Instagram" : "Messenger";
  const parts = splitText(params.text, MESSAGE_LIMITS[params.channel]);
  if (parts.length === 0) throw new ChannelSendError("El mensaje está vacío", "vacio", false);

  const url = `${apiBase(params.channel, params.api ?? "instagram_login")}/me/messages`;
  let last = "";

  for (const part of parts) {
    const body: Record<string, unknown> = {
      recipient: { id: params.recipientId },
      message: { text: part },
      messaging_type: params.humanAgent ? "MESSAGE_TAG" : "RESPONSE",
    };
    if (params.humanAgent) body.tag = "HUMAN_AGENT";

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${params.token}` },
        body: JSON.stringify(body),
      });
    } catch {
      throw new ChannelSendError(`No se pudo contactar a ${label}`, "network", true);
    }

    if (!response.ok) throw await graphError(response, `${label} rechazó el mensaje`);

    let data: { message_id?: string };
    try {
      data = (await response.json()) as typeof data;
    } catch {
      throw new ChannelSendError("Respuesta inválida del canal", response.status, false);
    }
    if (!data.message_id) throw new ChannelSendError("El canal no devolvió el id del mensaje", "sin-id", false);
    last = data.message_id;
  }

  return { externalId: last, providerTimestamp: (params.now ?? new Date()).toISOString() };
}

// Pide el nombre de la persona a Messenger o Instagram (el webhook no lo trae). Es de mejor esfuerzo: si falla o no
// hay permiso, la ficha queda sin nombre y se sigue.
export async function fetchProfileName(params: {
  channel: "messenger" | "instagram";
  token: string;
  personId: string;
  api?: InstagramApi;
  fetchImpl?: FetchLike;
}): Promise<string | null> {
  const { fetchImpl = fetch } = params;
  const fields = params.channel === "instagram" ? "name,username" : "name";

  try {
    const response = await fetchImpl(`${apiBase(params.channel, params.api ?? "instagram_login")}/${encodeURIComponent(params.personId)}?fields=${fields}`, {
      method: "GET",
      headers: { authorization: `Bearer ${params.token}` },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { name?: unknown; username?: unknown };
    const name = typeof data.name === "string" && data.name.trim() ? data.name.trim() : typeof data.username === "string" ? data.username.trim() : "";
    return name ? name.slice(0, 120) : null;
  } catch {
    return null;
  }
}
