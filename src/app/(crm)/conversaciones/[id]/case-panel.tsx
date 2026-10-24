import { dateTime, describeCaseEvent, PRIORITY_LABELS, STATUS_LABELS } from "@/lib/crm/format";
import type { CasePriority, CaseStatus } from "@/lib/crm/cases";
import { createClient } from "@/lib/supabase/server";

import { AreaAnswerForm } from "./area-answer-form";
import { CaseControls, CreateCaseForm } from "./case-forms";
import { ContactCard } from "./contact-card";
import { NoteForm } from "./note-form";
import { SidePanel } from "./side-panel";

// Datos juntados por el agente, listos para mostrar. Las claves que empiezan con "_" son internas (por
// ejemplo, el contador de reintentos) y no se muestran.
function collectedEntries(data: unknown): Array<[string, string]> {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  return Object.entries(data as Record<string, unknown>)
    .filter(([key, value]) => !key.startsWith("_") && value !== null && value !== undefined && String(value).trim() !== "")
    .map(([key, value]) => [key.replace(/_/g, " "), typeof value === "object" ? JSON.stringify(value) : String(value)]);
}

// Panel del caso de una conversación: el caso abierto con sus controles e historial, o el formulario
// para abrir uno. La lectura es abierta en la organización (ADR-016); modificar lo decide RLS.
export async function CasePanel({
  conversationId,
  contactId,
  role,
  currentUserId,
}: {
  conversationId: string;
  contactId: string;
  role: "superadmin" | "operator" | "viewer";
  currentUserId: string;
}) {
  const supabase = await createClient();

  const [{ data: cases }, { data: sectors }, { data: people }] = await Promise.all([
    supabase
      .from("cases")
      .select("id, title, status, priority, sector_id, assigned_to, opened_at, resolved_at, resolution, summary, collected_data")
      .eq("conversation_id", conversationId)
      .order("opened_at", { ascending: false })
      .limit(10),
    supabase.from("sectors").select("id, name, is_active").order("name"),
    supabase.from("profiles").select("id, full_name, role, is_active"),
  ]);

  // A quién se puede asignar un caso: superadmin y operadores activos.
  const assignable = (people ?? [])
    .filter((person) => person.is_active && person.role !== "viewer")
    .map((person) => ({ id: person.id, name: person.full_name }));
  const activeSectors = (sectors ?? []).filter((sector) => sector.is_active).map((sector) => ({ id: sector.id, name: sector.name }));

  const openCase = (cases ?? []).find((item) => item.status !== "resolved");
  const closedCases = (cases ?? []).filter((item) => item.status === "resolved");

  const names = {
    sectors: new Map((sectors ?? []).map((sector) => [sector.id, sector.name])),
    profiles: new Map((people ?? []).map((person) => [person.id, person.full_name])),
  };

  const { data: notes } = await supabase
    .from("internal_notes")
    .select("id, body, author_id, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: events } = openCase
    ? await supabase
        .from("case_events")
        .select("id, event_type, actor_type, actor_profile_id, data, created_at")
        .eq("case_id", openCase.id)
        .order("created_at", { ascending: false })
        .limit(30)
    : { data: [] };

  // Consultas que el agente le hizo a un sector sobre este caso, y a qué sectores pertenece quien mira
  // (responde quien es del sector consultado o el superadmin).
  const [{ data: queries }, { data: memberships }] = await Promise.all([
    openCase
      ? supabase
          .from("area_queries")
          .select("id, sector_id, question, status, answer, answered_by, answered_at, created_at")
          .eq("case_id", openCase.id)
          .order("created_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
    supabase.from("sector_members").select("sector_id").eq("profile_id", currentUserId),
  ]);
  const mySectorIds = new Set((memberships ?? []).map((member) => member.sector_id));

  return (
    <SidePanel>
      <ContactCard contactId={contactId} conversationId={conversationId} canEdit={role !== "viewer"} />

      <h2 className="text-base font-semibold">Caso</h2>

      {openCase ? (
        <>
          <div className="flex flex-col gap-1 text-sm">
            <p className="font-medium">{openCase.title}</p>
            <p className="text-zinc-600 dark:text-zinc-400">
              {STATUS_LABELS[openCase.status]} · Prioridad {PRIORITY_LABELS[openCase.priority]?.toLowerCase()}
            </p>
            <p className="text-zinc-600 dark:text-zinc-400">
              Sector: {openCase.sector_id ? (names.sectors.get(openCase.sector_id) ?? "—") : "sin sector"}
            </p>
            <p className="text-zinc-600 dark:text-zinc-400">
              Asignado a: {openCase.assigned_to ? (names.profiles.get(openCase.assigned_to) ?? "—") : "sin asignar"}
            </p>
          </div>

          {openCase.summary || collectedEntries(openCase.collected_data).length > 0 ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">Datos del caso</h3>
              {openCase.summary ? <p className="whitespace-pre-wrap break-words text-sm">{openCase.summary}</p> : null}
              {collectedEntries(openCase.collected_data).length > 0 ? (
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  {collectedEntries(openCase.collected_data).map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-zinc-600 dark:text-zinc-400">{key}</dt>
                      <dd className="break-words">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </section>
          ) : null}

          <CaseControls
            conversationId={conversationId}
            caseId={openCase.id}
            status={openCase.status as CaseStatus}
            priority={openCase.priority as CasePriority}
            assignedTo={openCase.assigned_to}
            sectorId={openCase.sector_id}
            currentUserId={currentUserId}
            people={assignable}
            sectors={activeSectors}
            canEdit={role !== "viewer"}
          />

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Historial</h3>
            <ol className="flex flex-col gap-2 text-sm">
              {(events ?? []).map((event) => {
                const described = describeCaseEvent(event, names);
                return (
                  <li key={event.id} className="flex flex-col">
                    <span>{described.text}</span>
                    <span className="text-xs text-zinc-600 dark:text-zinc-400">
                      {described.actor} · {dateTime(event.created_at)}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        </>
      ) : role === "viewer" ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Esta conversación no tiene un caso abierto.</p>
      ) : (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Esta conversación no tiene un caso abierto. Abrí uno para seguir la gestión.
          </p>
          <CreateCaseForm
            conversationId={conversationId}
            sectors={activeSectors}
          />
        </>
      )}

      {(queries ?? []).length > 0 ? (
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold">Consultas al área</h3>
          <ul className="flex flex-col gap-3 text-sm">
            {(queries ?? []).map((query) => {
              const canAnswer =
                query.status === "pending" && role !== "viewer" && (role === "superadmin" || mySectorIds.has(query.sector_id));
              return (
                <li key={query.id} className="flex flex-col gap-2 rounded-md bg-zinc-100 px-3 py-2 dark:bg-zinc-800">
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">
                    A {names.sectors.get(query.sector_id) ?? "un sector"} · {dateTime(query.created_at)} ·{" "}
                    {query.status === "pending" ? "Pendiente" : query.status === "answered" ? "Respondida" : "Cerrada"}
                  </span>
                  <span className="whitespace-pre-wrap break-words">{query.question}</span>
                  {query.answer ? (
                    <span className="whitespace-pre-wrap break-words border-l-2 border-emerald-500 pl-2">
                      {query.answer}
                      <span className="block text-xs text-zinc-600 dark:text-zinc-400">
                        {query.answered_by ? (names.profiles.get(query.answered_by) ?? "Operador") : "Persona eliminada"} · {dateTime(query.answered_at)}
                      </span>
                    </span>
                  ) : null}
                  {canAnswer ? <AreaAnswerForm conversationId={conversationId} queryId={query.id} /> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">Notas internas</h3>
        <p className="text-xs text-zinc-600 dark:text-zinc-400">Solo las ve el equipo. No se envían al contacto.</p>
        {role !== "viewer" ? <NoteForm conversationId={conversationId} /> : null}
        {(notes ?? []).length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Todavía no hay notas.</p>
        ) : (
          <ul className="flex flex-col gap-3 text-sm">
            {(notes ?? []).map((note) => (
              <li key={note.id} className="flex flex-col rounded-md bg-amber-50 px-3 py-2 dark:bg-amber-950/40">
                <span className="whitespace-pre-wrap break-words">{note.body}</span>
                <span className="text-xs text-zinc-600 dark:text-zinc-400">
                  {note.author_id ? (names.profiles.get(note.author_id) ?? "Operador") : "Persona eliminada"} · {dateTime(note.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {closedCases.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Casos resueltos</h3>
          <ul className="flex flex-col gap-2 text-sm">
            {closedCases.map((item) => (
              <li key={item.id} className="flex flex-col">
                <span>{item.title}</span>
                <span className="text-xs text-zinc-600 dark:text-zinc-400">
                  Resuelto el {dateTime(item.resolved_at)}
                  {item.resolution ? ` · ${item.resolution}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </SidePanel>
  );
}
