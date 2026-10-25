import { connection } from "next/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { ArrowLeftIcon, BotIcon } from "@/components/ui/icons";
import { getCurrentProfile } from "@/lib/auth/profile";
import { channelLabel, dayHeading, dayKeyOf, timeOnly, typeLabel } from "@/lib/crm/format";
import { getAgentNames } from "@/lib/crm/agent-names";
import { listQuickReplies } from "@/lib/crm/quick-replies";
import { createClient } from "@/lib/supabase/server";

import type { ChannelType } from "@/lib/inbound/types";
import { canSendFreeText } from "@/lib/outbound/rules";

import { AiSwitch } from "./ai-switch";
import { CasePanel } from "./case-panel";
import { MessageMedia, type MediaItem } from "./message-media";
import { LiveRefresh } from "../../live-refresh";
import { ReplyForm } from "./reply-form";
import { ScrollToEnd } from "./scroll-to-end";
import { TemplateForm } from "./template-form";
import { OpenSidePanelButton } from "./side-panel";

const MESSAGE_PAGE = 100;
const MESSAGE_MAX = 2000;
const SIGNED_URL_SECONDS = 3600;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// Lee la sesión: bloquea en el servidor hasta tenerla (ver el layout del CRM).
export const instant = false;

type MessageRow = {
  id: string;
  direction: string;
  sender: string;
  sender_profile_id: string | null;
  type: string;
  body: string | null;
  transcription: string | null;
  status: string;
  created_at: string;
  provider_timestamp: string | null;
};

// Cuándo pasó el mensaje: la hora del canal si la hay (el orden real de la charla), si no la de registro.
function whenOf(message: MessageRow): string {
  return message.provider_timestamp ?? message.created_at;
}

export const metadata = { title: "Conversación" };

export default async function ConversacionPage({ params, searchParams }: PageProps<"/conversaciones/[id]">) {
  // Página por pedido: lee la sesión y la hora actual (ver la nota de `instant` en el layout del CRM).
  await connection();
  const profile = await getCurrentProfile();
  const { id } = await params;
  const requested = Number(first((await searchParams).mensajes));
  const limit = Number.isInteger(requested) && requested > 0 ? Math.min(requested, MESSAGE_MAX) : MESSAGE_PAGE;
  const now = new Date();

  const supabase = await createClient();

  // Tanda 1: todo lo que depende solo del id de la conversación y de la sesión, junto. Cada consulta es un viaje a la
  // base: hacerlas en fila sumaba la demora de cada una.
  // RLS limita todo a la organización del usuario: un id ajeno simplemente no existe.
  const [{ data: conversation }, { data: latest }, agentNames, quickReplies, { data: templates }] = await Promise.all([
    supabase
      .from("conversation_summaries")
      .select("id, contact_id, contact_name, contact_document, channel_type, last_inbound_at, ai_enabled")
      .eq("id", id)
      .maybeSingle(),
    // Los últimos mensajes en el orden en que ocurrieron, mostrados del más viejo al más nuevo (uno de más para saber
    // si hay anteriores).
    supabase
      .from("messages")
      .select("id, direction, sender, sender_profile_id, type, body, transcription, status, created_at, provider_timestamp")
      .eq("conversation_id", id)
      .order("provider_timestamp", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(limit + 1),
    getAgentNames(),
    profile.role === "viewer" ? Promise.resolve([]) : listQuickReplies(supabase),
    // Plantillas aprobadas de Meta: lo único que se puede enviar por WhatsApp fuera de la ventana de 24 h (Fase 9).
    // Se piden siempre y se usan solo si el canal es WhatsApp (así no esperan a saber el canal).
    profile.role === "viewer"
      ? Promise.resolve({ data: [] })
      : supabase.from("message_templates").select("id, name, language, body, category").eq("meta_status", "approved").order("name"),
  ]);
  if (!conversation) notFound();

  const hasOlder = (latest?.length ?? 0) > limit;
  const messages: MessageRow[] = [...(latest ?? []).slice(0, limit)].reverse();
  const agentName = agentNames.attention;
  const approvedTemplates = conversation.channel_type === "whatsapp" ? (templates ?? []) : [];

  // Tanda 2: lo que depende de los mensajes. Nombres de quienes respondieron a mano (para firmar cada burbuja) y
  // archivos adjuntos, juntos.
  const operatorIds = [...new Set(messages.map((message) => message.sender_profile_id).filter((value): value is string => !!value))];
  const messageIds = messages.map((message) => message.id);
  const [{ data: operators }, { data: files }] = await Promise.all([
    operatorIds.length ? supabase.from("profiles").select("id, full_name").in("id", operatorIds) : Promise.resolve({ data: [] }),
    // La política de Storage deja firmar solo los archivos de la propia organización.
    messageIds.length ? supabase.from("media_files").select("message_id, storage_path, mime_type").in("message_id", messageIds) : Promise.resolve({ data: [] }),
  ]);
  const operatorNames = new Map((operators ?? []).map((operator) => [operator.id, operator.full_name]));

  // Tanda 3: las direcciones firmadas de los adjuntos.
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

  const channel = (conversation.channel_type ?? "whatsapp") as ChannelType;
  const contactName = conversation.contact_name || "Sin nombre";
  const aiEnabled = conversation.ai_enabled ?? false;

  // Qué se le muestra al usuario debajo de los mensajes. La autorización real está en la acción.
  const freeTextAllowed = canSendFreeText(channel, conversation.last_inbound_at ? new Date(conversation.last_inbound_at) : null, now);

  return (
    <div className="flex min-h-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
          <Link href="/conversaciones" className="btn-secondary !p-2" aria-label="Volver a las conversaciones">
            <ArrowLeftIcon />
          </Link>
          <Avatar name={contactName} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-lg font-semibold tracking-tight">
              {conversation.contact_id ? (
                <Link href={`/contactos/${conversation.contact_id}`} className="underline-offset-2 hover:underline" title="Ver todo el historial del contacto">
                  {contactName}
                </Link>
              ) : (
                contactName
              )}
            </h1>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <Badge>{channelLabel(channel)}</Badge>
              <Badge tone={aiEnabled ? "agent" : "warning"} dot>
                {aiEnabled ? `Atiende ${agentName}` : "Atiende una persona"}
              </Badge>
              {conversation.contact_document ? <span>Doc. {conversation.contact_document}</span> : null}
              {/* La ventana de 24 h es una regla de WhatsApp: en los demás canales no aplica. */}
              {channel === "whatsapp" ? (
                freeTextAllowed ? (
                  <Badge tone="success" dot>
                    Ventana de 24 h abierta
                  </Badge>
                ) : (
                  <Badge tone="warning" dot>
                    Ventana de 24 h cerrada
                  </Badge>
                )
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <AiSwitch conversationId={conversation.id ?? id} agentName={agentName} aiEnabled={aiEnabled} canChange={profile.role !== "viewer"} />
            <OpenSidePanelButton />
          </div>
        </header>

        <ol className="flex flex-1 flex-col gap-2 overflow-y-auto px-4 py-4 sm:px-6" aria-label="Mensajes">
          {hasOlder ? (
            <li className="flex justify-center pb-2">
              <Link href={`/conversaciones/${id}?mensajes=${limit + MESSAGE_PAGE}`} scroll={false} className="btn-secondary !py-1 text-xs">
                Cargar mensajes anteriores
              </Link>
            </li>
          ) : null}
          {messages.length === 0 ? <li className="m-auto text-sm text-muted">Esta conversación todavía no tiene mensajes.</li> : null}
          {messages.map((message, index) => {
            const when = whenOf(message);
            const previous = messages[index - 1];
            const newDay = !previous || dayKeyOf(whenOf(previous)) !== dayKeyOf(when);

            return (
              <MessageItem
                key={message.id}
                message={message}
                when={when}
                dayLabel={newDay ? dayHeading(when, now) : null}
                media={mediaByMessage.get(message.id)}
                operatorName={message.sender_profile_id ? operatorNames.get(message.sender_profile_id) : undefined}
                agentName={agentName}
              />
            );
          })}
          <ScrollToEnd lastId={messages.at(-1)?.id ?? null} />
        </ol>
        <LiveRefresh conversationId={conversation.id ?? id} />

        {profile.role === "viewer" ? (
          <p className="border-t border-line px-6 py-4 text-sm text-muted">Tu rol es de consulta: podés leer la conversación pero no responder.</p>
        ) : !freeTextAllowed ? (
          <TemplateForm
            conversationId={conversation.id ?? id}
            templates={approvedTemplates}
            contactFirstName={contactName === "Sin nombre" ? "" : (contactName.trim().split(/\s+/)[0] ?? "")}
            canManage={profile.role === "superadmin"}
          />
        ) : (
          <ReplyForm conversationId={conversation.id ?? id} agentName={agentName} aiEnabled={aiEnabled} quickReplies={quickReplies} />
        )}
      </main>
      <Suspense fallback={<aside className="hidden w-80 shrink-0 border-l border-line p-4 lg:block xl:w-96" aria-busy="true"><div className="skeleton h-40" /></aside>}>
        <CasePanel conversationId={conversation.id ?? id} contactId={conversation.contact_id ?? ""} role={profile.role} currentUserId={profile.id} />
      </Suspense>
    </div>
  );
}

// Una burbuja. Cada autor tiene su estilo: el contacto a la izquierda; el agente y el equipo a la derecha (el agente
// en tono suave con su marca, una persona del equipo en el color fuerte); los avisos del sistema, al centro.
function MessageItem({
  message,
  when,
  dayLabel,
  media,
  operatorName,
  agentName,
}: {
  message: MessageRow;
  when: string;
  dayLabel: string | null;
  media: MediaItem | undefined;
  operatorName: string | undefined;
  agentName: string;
}) {
  const separator = dayLabel ? (
    <li className="my-2 flex items-center gap-3 text-xs font-medium text-muted" aria-label={dayLabel}>
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
      {dayLabel}
      <span className="h-px flex-1 bg-line" aria-hidden="true" />
    </li>
  ) : null;

  if (message.sender === "system") {
    return (
      <>
        {separator}
        <li className="mx-auto max-w-[85%] rounded-full bg-zinc-200/60 px-3 py-1 text-center text-xs text-muted dark:bg-zinc-800">
          {message.body} · {timeOnly(when)}
        </li>
      </>
    );
  }

  const fromContact = message.sender === "contact";
  const fromAgent = message.sender === "agent";
  const failed = message.status === "failed";

  const bubble = fromContact
    ? "rounded-bl-sm border border-line bg-surface"
    : fromAgent
      ? "rounded-br-sm bg-accent-soft"
      : "rounded-br-sm bg-accent text-accent-foreground";
  const meta = fromContact || fromAgent ? "text-muted" : "text-accent-foreground/80";

  return (
    <>
      {separator}
      <li className={`flex ${fromContact ? "justify-start" : "justify-end"}`}>
        <div className={`flex max-w-[85%] flex-col gap-1 rounded-2xl px-3.5 py-2 text-sm shadow-xs sm:max-w-[70%] ${bubble} ${failed ? "ring-2 ring-danger" : ""}`}>
          {fromAgent ? (
            <p className="flex items-center gap-1 text-xs font-semibold text-accent">
              <BotIcon className="size-3.5" />
              {agentName}
            </p>
          ) : !fromContact ? (
            <p className={`text-xs font-semibold ${meta}`}>{operatorName ?? "Equipo"}</p>
          ) : null}
          {media ? <MessageMedia type={message.type} media={media} /> : null}
          {message.type !== "text" && !media ? (
            <p className={`text-xs italic ${meta}`}>{typeLabel(message.type)} · el archivo no está disponible</p>
          ) : null}
          {message.body ? <p className="whitespace-pre-wrap break-words">{message.body}</p> : null}
          {message.transcription ? (
            <p className={`whitespace-pre-wrap break-words border-l-2 border-current/30 pl-2 text-[13px] italic ${meta}`}>
              Transcripción: {message.transcription}
            </p>
          ) : null}
          <p className={`self-end text-[11px] ${meta}`}>{timeOnly(when)}</p>
        </div>
      </li>
      {failed ? <li className="-mt-1 self-end text-xs font-medium text-danger">No se pudo enviar este mensaje.</li> : null}
    </>
  );
}
