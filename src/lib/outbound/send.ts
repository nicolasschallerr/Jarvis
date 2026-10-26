import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/lib/supabase/database.types";

import { channelToken } from "./channel-token";
import { ChannelSendError, OutsideWindowError } from "./errors";
import { formatForChannel } from "./format";
import { instagramApiFrom, sendMessagingText, sendWhatsAppText } from "./meta-messaging";
import { canSendFreeText, sendMode } from "./rules";
import { sendTelegramText, type SentMessage } from "./telegram";

type Sender = Database["public"]["Enums"]["message_sender"];

export type SendTextParams = {
  conversationId: string;
  text: string;
  sender: Sender;
  senderProfileId?: string | null;
  now?: Date;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
};

export type SendTextResult = { messageId: string; externalId: string };

// Envía un texto en una conversación, por el canal que corresponda. Es la única puerta de salida:
// quien llame (operador, agente, seguimiento) no sabe cómo habla cada canal.
//
// Orden: validar la regla del canal, guardar el mensaje como "queued", llamar al proveedor y
// cerrarlo como "sent" (o "failed" con su error). Guardarlo antes evita perder el rastro si algo
// se corta a mitad de camino.
export async function sendTextMessage(
  admin: SupabaseClient<Database>,
  params: SendTextParams,
): Promise<SendTextResult> {
  const now = params.now ?? new Date();

  const { data: conversation, error: conversationError } = await admin
    .from("conversations")
    .select("id, organization_id, contact_id, last_inbound_at, channels(type, external_id, secret_ref, config)")
    .eq("id", params.conversationId)
    .maybeSingle();

  if (conversationError) throw new Error(`No se pudo consultar la conversación: ${conversationError.message}`);
  if (!conversation || !conversation.channels) throw new Error("Conversación o canal no encontrado");

  const channel = conversation.channels;

  const lastInbound = conversation.last_inbound_at ? new Date(conversation.last_inbound_at) : null;
  const config = typeof channel.config === "object" && channel.config !== null && !Array.isArray(channel.config) ? (channel.config as Record<string, unknown>) : {};
  // Messenger e Instagram permiten que una PERSONA responda hasta 7 días después con la etiqueta "agente humano", si la
  // cuenta tiene ese permiso (channels.config.human_agent). La IA y el sistema nunca la usan.
  const mode = sendMode(channel.type, lastInbound, now, { humanAgentTag: config.human_agent === true });
  if (mode === "closed" || (mode === "human_agent" && params.sender !== "operator")) {
    throw new OutsideWindowError();
  }

  // Un contacto puede tener más de una identidad en el mismo canal (por ejemplo, tras unir dos contactos que
  // escribían desde dos números): se usa la más reciente.
  const { data: identity, error: identityError } = await admin
    .from("contact_identities")
    .select("identifier")
    .eq("contact_id", conversation.contact_id)
    .eq("channel_type", channel.type)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (identityError) throw new Error(`No se pudo consultar la identidad del contacto: ${identityError.message}`);
  if (!identity) throw new Error("El contacto no tiene identidad en este canal");

  // Lo que escribe el agente va con el formato que entiende cada canal (sin Markdown suelto). Lo de una persona se respeta.
  const text = params.sender === "agent" ? formatForChannel(params.text, channel.type) : params.text;

  // El token no está en la base: el canal guarda solo el NOMBRE de la variable de entorno.
  const token = channelToken(channel.secret_ref);

  const { data: queued, error: queueError } = await admin
    .from("messages")
    .insert({
      organization_id: conversation.organization_id,
      conversation_id: conversation.id,
      direction: "outbound",
      sender: params.sender,
      sender_profile_id: params.senderProfileId ?? null,
      type: "text",
      body: text,
      status: "queued",
      // Con hora desde el principio: si el envío falla, el mensaje queda en su lugar de la conversación en vez de
      // quedar "sin hora" (y primero al ordenar), lo que hacía creer al agente que ya había respondido.
      provider_timestamp: now.toISOString(),
    })
    .select("id")
    .single();

  if (queueError || !queued) throw new Error(`No se pudo guardar el mensaje: ${queueError?.message}`);

  let sent: SentMessage;
  try {
    sent = await sendByChannel(channel.type, {
      token,
      accountId: channel.external_id,
      identifier: identity.identifier,
      text,
      humanAgent: mode === "human_agent",
      api: instagramApiFrom(config),
      fetchImpl: params.fetchImpl,
      now,
    });
  } catch (error) {
    const detail = error instanceof ChannelSendError
      ? { code: error.code, message: error.message, retryable: error.retryable, retry_after: error.retryAfterSeconds }
      : { message: error instanceof Error ? error.message : "Error desconocido" };

    await admin
      .from("messages")
      .update({ status: "failed", status_updated_at: new Date().toISOString(), error: detail as Json })
      .eq("id", queued.id);

    throw error;
  }

  const { error: finalizeError } = await admin.rpc("finalize_outbound_message", {
    p_message_id: queued.id,
    p_external_id: sent.externalId,
    p_provider_timestamp: sent.providerTimestamp,
  });

  if (finalizeError) throw new Error(`No se pudo cerrar el mensaje enviado: ${finalizeError.message}`);

  return { messageId: queued.id, externalId: sent.externalId };
}

async function sendByChannel(
  type: Database["public"]["Enums"]["channel_type"],
  params: {
    token: string;
    // Cuenta del canal en el proveedor (phone_number_id en WhatsApp).
    accountId: string;
    identifier: string;
    text: string;
    humanAgent: boolean;
    api: ReturnType<typeof instagramApiFrom>;
    fetchImpl?: SendTextParams["fetchImpl"];
    now: Date;
  },
): Promise<SentMessage> {
  if (type === "telegram") {
    return sendTelegramText({
      token: params.token,
      chatId: params.identifier,
      text: params.text,
      fetchImpl: params.fetchImpl,
    });
  }

  if (type === "whatsapp") {
    return sendWhatsAppText({ token: params.token, phoneNumberId: params.accountId, to: params.identifier, text: params.text, fetchImpl: params.fetchImpl, now: params.now });
  }

  if (type === "messenger" || type === "instagram") {
    return sendMessagingText({
      channel: type,
      token: params.token,
      recipientId: params.identifier,
      text: params.text,
      api: params.api,
      humanAgent: params.humanAgent,
      fetchImpl: params.fetchImpl,
      now: params.now,
    });
  }

  // Un canal sin envío no se arregla reintentando: error definitivo (no se reintenta cada 15 minutos).
  throw new ChannelSendError(`El envío por ${type} todavía no está implementado`, "canal_sin_envio", false);
}

// Canales por los que se puede enviar texto (el correo todavía no).
export const SENDABLE_CHANNELS: ReadonlyArray<Database["public"]["Enums"]["channel_type"]> = ["telegram", "whatsapp", "messenger", "instagram"];

export type Sendability = { ok: true; channel: Database["public"]["Enums"]["channel_type"] } | { ok: false; reason: "canal_sin_envio" | "fuera_de_ventana" | "sin_conversacion" };

// ¿Se puede escribir ahora en esta conversación? Sirve para no pagar el modelo redactando algo que después no
// va a poder salir (canal sin envío o fuera de la ventana de 24 h de WhatsApp).
export async function checkSendable(admin: SupabaseClient<Database>, conversationId: string, now: Date): Promise<Sendability> {
  const { data } = await admin.from("conversations").select("last_inbound_at, channels(type)").eq("id", conversationId).maybeSingle();
  if (!data?.channels) return { ok: false, reason: "sin_conversacion" };
  if (!SENDABLE_CHANNELS.includes(data.channels.type)) return { ok: false, reason: "canal_sin_envio" };
  const lastInbound = data.last_inbound_at ? new Date(data.last_inbound_at) : null;
  if (!canSendFreeText(data.channels.type, lastInbound, now)) return { ok: false, reason: "fuera_de_ventana" };
  return { ok: true, channel: data.channels.type };
}
