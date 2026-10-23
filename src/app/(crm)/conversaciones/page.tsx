import Link from "next/link";

import { getCurrentProfile } from "@/lib/auth/profile";
import { channelLabel, messagePreview, shortDate, STATUS_LABELS } from "@/lib/crm/format";
import { createClient } from "@/lib/supabase/server";

import { LiveRefresh } from "../live-refresh";

export default async function ConversacionesPage() {
  // Verifica la sesión y el perfil; la lista la filtra RLS por organización.
  const profile = await getCurrentProfile();

  const supabase = await createClient();
  const { data: conversations, error } = await supabase
    .from("conversation_summaries")
    .select(
      "id, contact_name, channel_type, channel_name, last_body, last_type, last_direction, last_message_at, window_open, case_status, case_priority, case_assigned_to",
    )
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(100);

  const now = new Date();

  return (
    <main className="flex flex-1 flex-col">
      <LiveRefresh organizationId={profile.organizationId} />
      <header className="border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
        <h1 className="text-xl font-semibold tracking-tight">Conversaciones</h1>
      </header>

      {error ? (
        <p className="p-6 text-sm text-red-600 dark:text-red-400">
          No se pudieron cargar las conversaciones. Probá recargar la página.
        </p>
      ) : !conversations?.length ? (
        <p className="p-6 text-sm text-zinc-600 dark:text-zinc-400">
          Todavía no hay conversaciones. Cuando alguien escriba, va a aparecer acá.
        </p>
      ) : (
        <ul className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {conversations.map((conversation) => (
            <li key={conversation.id}>
              <Link
                href={`/conversaciones/${conversation.id}`}
                className="flex items-start gap-4 px-6 py-4 hover:bg-zinc-100 dark:hover:bg-zinc-900"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-medium">{conversation.contact_name || "Sin nombre"}</p>
                    <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                      {channelLabel(conversation.channel_type ?? "")}
                    </span>
                    {conversation.case_status ? (
                      <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                        Caso: {STATUS_LABELS[conversation.case_status]}
                        {conversation.case_assigned_to === profile.id ? " · mío" : conversation.case_assigned_to ? "" : " · sin asignar"}
                      </span>
                    ) : null}
                    {conversation.window_open ? (
                      <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        Ventana abierta
                      </span>
                    ) : null}
                  </div>
                  <p className="truncate text-sm text-zinc-600 dark:text-zinc-400">
                    {conversation.last_direction === "outbound" ? "Vos: " : ""}
                    {messagePreview(conversation.last_body, conversation.last_type)}
                  </p>
                </div>
                <time className="shrink-0 text-xs text-zinc-600 dark:text-zinc-400" dateTime={conversation.last_message_at ?? undefined}>
                  {shortDate(conversation.last_message_at, now)}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
