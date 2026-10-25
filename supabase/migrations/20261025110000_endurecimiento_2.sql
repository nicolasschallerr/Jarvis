-- Segunda ronda de endurecimiento (revisión independiente del 2026-10-25, ver ADR-027 y ADR-029).
--
-- 1) Respuestas del área que hoy no pueden salir (chat tomado por una persona, canal sin envío, ventana cerrada)
--    se postergan con reply_next_attempt_at en vez de quedar primeras en la cola tapando a las demás.
-- 2) Turno del agente renovable: una respuesta larga (varias vueltas del modelo) no pierde el turno a mitad.
-- 3) Columnas protegidas también en los casos: una persona no puede reasignar un caso a otro contacto ni
--    reescribir lo que juntó el agente.
-- 4) Las identidades de contacto (teléfono, usuario de Telegram) las escribe solo el sistema: cambiarlas a mano
--    mandaría los mensajes a otra persona.
-- 5) Solo se asigna a alguien de la misma organización, activo y que no sea de consulta.

-- 1) Postergar respuestas del área ----------------------------------------------------------------------------

alter table public.area_queries add column reply_next_attempt_at timestamptz;

-- 2) Turno renovable --------------------------------------------------------------------------------------------

create or replace function public.extend_agent_turn(p_conversation_id uuid, p_seconds integer default 120)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversations
  set agent_lock_until = now() + make_interval(secs => p_seconds)
  where id = p_conversation_id and agent_lock_until is not null
$$;

revoke all on function public.extend_agent_turn(uuid, integer) from public, anon, authenticated;
grant execute on function public.extend_agent_turn(uuid, integer) to service_role;

-- 3) Columnas protegidas (se suma la tabla de casos y la columna nueva de las consultas) -----------------------

create or replace function private.guard_user_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- El servidor (sin usuario) y las funciones de la base (otro current_user) pueden todo; las restricciones son
  -- para lo que una persona cambia directamente con su sesión.
  if auth.uid() is null or current_user <> 'authenticated' then
    return new;
  end if;

  if tg_table_name = 'conversations' then
    if new.organization_id is distinct from old.organization_id
       or new.channel_id is distinct from old.channel_id
       or new.contact_id is distinct from old.contact_id then
      raise exception 'No se puede cambiar la organización, el canal ni el contacto de una conversación';
    end if;
    if new.last_inbound_at is distinct from old.last_inbound_at
       or new.last_message_at is distinct from old.last_message_at
       or new.agent_lock_until is distinct from old.agent_lock_until
       or new.created_at is distinct from old.created_at then
      raise exception 'Las marcas de tiempo de la conversación las registra solo el sistema';
    end if;

  elsif tg_table_name = 'cases' then
    -- Desde la pantalla se cambian estado, prioridad, asignación, sector, título y resolución. El resto (a quién
    -- y de qué conversación es, lo que juntó el agente, las fechas) lo escribe el sistema.
    if new.organization_id is distinct from old.organization_id
       or new.contact_id is distinct from old.contact_id
       or new.conversation_id is distinct from old.conversation_id
       or new.unit_id is distinct from old.unit_id
       or new.collected_data is distinct from old.collected_data
       or new.summary is distinct from old.summary
       or new.opened_at is distinct from old.opened_at
       or new.resolved_at is distinct from old.resolved_at
       or new.created_at is distinct from old.created_at then
      raise exception 'Ese dato del caso lo registra solo el sistema';
    end if;

  elsif tg_table_name = 'contacts' then
    if new.organization_id is distinct from old.organization_id
       or new.merged_into is distinct from old.merged_into
       or new.merged_at is distinct from old.merged_at
       or new.opted_in_at is distinct from old.opted_in_at
       or new.opted_out_at is distinct from old.opted_out_at then
      raise exception 'Ese dato del contacto lo registra solo el sistema';
    end if;

  elsif tg_table_name = 'area_queries' then
    if new.organization_id is distinct from old.organization_id
       or new.case_id is distinct from old.case_id
       or new.conversation_id is distinct from old.conversation_id
       or new.sector_id is distinct from old.sector_id
       or new.question is distinct from old.question
       or new.reply_sent_at is distinct from old.reply_sent_at
       or new.reply_attempts is distinct from old.reply_attempts
       or new.reply_next_attempt_at is distinct from old.reply_next_attempt_at then
      raise exception 'Solo se puede responder la consulta';
    end if;
    if new.answered_by is distinct from old.answered_by and new.answered_by is distinct from auth.uid() then
      raise exception 'La respuesta queda a nombre de quien la escribe';
    end if;

  elsif tg_table_name = 'notifications' then
    if new.organization_id is distinct from old.organization_id
       or new.profile_id is distinct from old.profile_id
       or new.type is distinct from old.type
       or new.case_id is distinct from old.case_id
       or new.title is distinct from old.title
       or new.body is distinct from old.body then
      raise exception 'De un aviso solo se puede marcar la lectura';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.guard_user_columns() from public, anon, authenticated;

create trigger cases_guard_user_columns
  before update on public.cases
  for each row execute function private.guard_user_columns();

-- 4) Identidades de contacto: solo lectura para las personas (el superadmin puede borrar, como antes) ---------

drop policy if exists contact_identities_insert on public.contact_identities;
drop policy if exists contact_identities_update on public.contact_identities;

-- 5) Asignaciones dentro de la organización -------------------------------------------------------------------

create or replace function private.check_assignee()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assigned_to is not null and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    if not exists (
      select 1 from public.profiles p
      where p.id = new.assigned_to
        and p.organization_id = new.organization_id
        and p.is_active
        and p.role <> 'viewer'
    ) then
      raise exception 'Solo se puede asignar a una persona activa del equipo de la organización';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function private.check_assignee() from public, anon, authenticated;

create trigger cases_check_assignee
  before insert or update of assigned_to on public.cases
  for each row execute function private.check_assignee();
create trigger conversations_check_assignee
  before insert or update of assigned_to on public.conversations
  for each row execute function private.check_assignee();
