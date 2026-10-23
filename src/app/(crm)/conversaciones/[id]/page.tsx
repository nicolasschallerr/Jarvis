import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { getCurrentProfile } from "@/lib/auth/profile";
import { channelLabel, dateTime, senderLabel } from "@/lib/crm/format";
import { createClient } from "@/lib/supabase/server";

import type { ChannelType } from "@/lib/inbound/types";
import { canSendFreeText } from "@/lib/outbound/rules";

import { CasePanel } from "./case-panel";
import { MessageMedia, type MediaItem } from "./message-media";
import { LiveRefresh } from "../../live-refresh";
import { ReplyForm } from "./reply-form";
import { ScrollToEnd } from "./scroll-to-end";

const MESSAGE_LIMIT = 200;
const SIGNED_URL_SECONDS = 3600;

export default async function ConversacionPage({ params }: PageProps<"/conversaciones/[id]">) {
  const profile = await getCurrentProfile();
  const { id } = await params;

  const supabase = await createClient();

  // RLS limita todo a la organización del usuario: un id ajeno simplemente no existe.
  const { data: conversation } = await supabase
    .from("conversation_summaries")
    .select("id, contact_name, channel_type, window_open, last_inbound_at")
    .eq("id", id)
    .maybeSingle();
  if (!conversation) notFound();

  // Los últimos mensajes, mostrados del más viejo al más nuevo.
  const { data: latest } = await supabase
    .from("messages")
    .select("id, direction, sender, type, body, transcription, status, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: false })
    .limit(MESSAGE_LIMIT);
  const messages = [...(latest ?? [])].reverse();

  // Archivos adjuntos: la política de Storage deja firmar solo los de la propia organización.
  const messageIds = messages.map((message) => message.id);
  const { data: files } = messageIds.length
    ? await supabase.from("media_files").select("message_id, storage_path, mime_type").in("message_id", messageIds)
    : { data: [] };

  const signed = files?.length
    ? await supabase.storage.from("media").createSignedUrls(
        files.map((file) => file.storage_path),
        SIGNED_URL_SECONDS,
      )
    : null;
  const urlByPath = new Map(signed?.data?.map((entry) => [entry.path, entry.signedUrl]) ?? []);

  const mediaByMessage = new Map<string, MediaItem>();
  for (const file of files ?? []) {
    const url = urlByPath.get(file.storage_path);
    if (url) mediaByMessage.set(file.message_id, { url, mimeType: file.mime_type });
  }

  // Qué se le muestra al usuario debajo de los mensajes. La autorización real está en la acción.
  const freeTextAllowed = canSendFreeText(
    (conversation.channel_type ?? "whatsapp") as ChannelType,
    conversation.last_inbound_at ? new Date(conversation.last_inbound_at) : null,
    new Date(),
  );

  return (
    <div className="flex h-screen">
    <main className="flex min-w-0 flex-1 flex-col">
      <header className="flex flex-col gap-1 border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <Link href="/conversaciones" className="text-sm text-zinc-600 hover:underline dark:text-zinc-400">
          ← Conversaciones
        </Link>
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight">{conversation.contact_name || "Sin nombre"}</h1>
          <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
            {channelLabel(conversation.channel_type ?? "")}
          </span>
          {conversation.window_open ? (
            <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
              Ventana abierta
            </span>
          ) : null}
        </div>
      </header>

      <ol className="flex flex-1 flex-col gap-3 overflow-y-auto px-6 py-4">
        {messages.length === 0 ? (
          <li className="text-sm text-zinc-600 dark:text-zinc-400">Esta conversación todavía no tiene mensajes.</li>
        ) : null}
        {messages.map((message) => {
          const outbound = message.direction === "outbound";
          const media = mediaByMessage.get(message.id);

          return (
            <li key={message.id} className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
              <div
                className={`flex max-w-[75%] flex-col gap-1 rounded-lg px-3 py-2 text-sm ${
                  outbound ? "bg-blue-100 dark:bg-blue-950" : "bg-zinc-100 dark:bg-zinc-900"
                }`}
              >
                <p className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
                  {senderLabel(message.sender, conversation.contact_name)}
                </p>
                {media ? <MessageMedia type={message.type} media={media} /> : null}
                {message.type !== "text" && !media ? (
                  <p className="italic text-zinc-600 dark:text-zinc-400">[{message.type}] sin archivo disponible</p>
                ) : null}
                {message.body ? <p className="whitespace-pre-wrap break-words">{message.body}</p> : null}
                {message.transcription ? (
                  <p className="whitespace-pre-wrap break-words italic text-zinc-700 dark:text-zinc-300">
                    Transcripción: {message.transcription}
                  </p>
                ) : null}
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  {dateTime(message.created_at)}
                  {outbound && message.status === "failed" ? " · no se pudo enviar" : ""}
                </p>
              </div>
            </li>
          );
        })}
        <ScrollToEnd count={messages.length} />
      </ol>
      <LiveRefresh conversationId={conversation.id ?? id} />

      {profile.role === "viewer" ? (
        <p className="border-t border-zinc-200 px-6 py-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          Tu rol es de consulta: podés leer la conversación pero no responder.
        </p>
      ) : !freeTextAllowed ? (
        <p className="border-t border-zinc-200 px-6 py-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          Pasaron más de 24 horas desde el último mensaje del contacto: solo se pueden enviar plantillas
          aprobadas (disponible más adelante).
        </p>
      ) : (
        <ReplyForm conversationId={conversation.id ?? id} />
      )}
    </main>
    <Suspense fallback={<aside className="w-80 shrink-0 border-l border-zinc-200 p-4 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">Cargando caso...</aside>}>
      <CasePanel conversationId={conversation.id ?? id} role={profile.role} />
    </Suspense>
    </div>
  );
}
