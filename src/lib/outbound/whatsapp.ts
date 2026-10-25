import { ChannelSendError } from "./errors";
import type { SentMessage } from "./telegram";

// Llamadas a la WhatsApp Cloud API de Meta (Graph API). El token se pasa por parámetro y nunca se registra ni se
// incluye en los errores. La versión de la API se puede fijar con META_GRAPH_VERSION.
export const DEFAULT_GRAPH_VERSION = "v23.0";

export function graphBase(): string {
  const version = process.env.META_GRAPH_VERSION?.match(/^v\d+\.\d+$/) ? process.env.META_GRAPH_VERSION : DEFAULT_GRAPH_VERSION;
  return `https://graph.facebook.com/${version}`;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number } };

// Un pedido rechazado por Meta: se reintenta solo si fue un límite de velocidad o una falla del lado de Meta.
async function graphError(response: Response, fallback: string): Promise<ChannelSendError> {
  let detail: GraphError = {};
  try {
    detail = (await response.json()) as GraphError;
  } catch {
    // sin cuerpo legible
  }
  const retryable = response.status === 429 || response.status >= 500;
  const message = detail.error?.message ? `Meta: ${detail.error.message.slice(0, 200)}` : `${fallback} (${response.status})`;
  return new ChannelSendError(message, detail.error?.code ?? response.status, retryable);
}

// Envía un mensaje de plantilla. `payload` lo arma buildTemplatePayload (lib/whatsapp/templates.ts).
export async function sendWhatsAppPayload(params: {
  token: string;
  phoneNumberId: string;
  payload: Record<string, unknown>;
  fetchImpl?: FetchLike;
  now?: Date;
}): Promise<SentMessage> {
  const { fetchImpl = fetch } = params;

  let response: Response;
  try {
    response = await fetchImpl(`${graphBase()}/${encodeURIComponent(params.phoneNumberId)}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${params.token}` },
      body: JSON.stringify(params.payload),
    });
  } catch {
    throw new ChannelSendError("No se pudo contactar a WhatsApp", "network", true);
  }

  if (!response.ok) throw await graphError(response, "WhatsApp rechazó el mensaje");

  let data: { messages?: Array<{ id?: string }> };
  try {
    data = (await response.json()) as typeof data;
  } catch {
    throw new ChannelSendError("Respuesta inválida de WhatsApp", response.status, false);
  }

  const id = data.messages?.[0]?.id;
  // Aceptado por la API no es entregado: la entrega llega después por el webhook de estados.
  if (!id) throw new ChannelSendError("WhatsApp no devolvió el id del mensaje", "sin-id", false);
  return { externalId: id, providerTimestamp: (params.now ?? new Date()).toISOString() };
}

// Lista las plantillas de una cuenta de WhatsApp Business (GET /<waba-id>/message_templates), siguiendo las
// páginas. Tope de páginas para no quedar en un bucle si Meta devolviera siempre "next".
export async function listWhatsAppTemplates(params: { token: string; wabaId: string; fetchImpl?: FetchLike; maxPages?: number }): Promise<unknown[]> {
  const { fetchImpl = fetch, maxPages = 20 } = params;
  const fields = "id,name,language,status,category,parameter_format,components,rejected_reason";
  let url: string | null = `${graphBase()}/${encodeURIComponent(params.wabaId)}/message_templates?fields=${fields}&limit=100`;
  const all: unknown[] = [];

  for (let page = 0; url && page < maxPages; page += 1) {
    let response: Response;
    try {
      response = await fetchImpl(url, { method: "GET", headers: { authorization: `Bearer ${params.token}` } });
    } catch {
      throw new ChannelSendError("No se pudo contactar a WhatsApp", "network", true);
    }
    if (!response.ok) throw await graphError(response, "WhatsApp no devolvió las plantillas");

    const data = (await response.json()) as { data?: unknown[]; paging?: { next?: string } };
    all.push(...(data.data ?? []));
    // Solo se sigue un "next" de Meta: nunca otro dominio.
    const next = data.paging?.next;
    url = next && next.startsWith("https://graph.facebook.com/") ? next : null;
  }

  return all;
}
