-- Endurecimiento tras la auditoría de seguridad y lógica (ver ADR-027).
--
-- 1) Tokens de canal: solo el servidor (clave de servicio, scripts) define a qué variable de entorno apunta un
--    canal. Antes, un superadmin podía apuntar su canal a la variable de OTRO cliente (o a la clave de servicio)
--    y enviar mensajes en su nombre. Además el nombre tiene que tener la forma de un token de canal.
-- 2) Columnas protegidas: las personas (sesión con usuario) solo pueden cambiar lo que su pantalla cambia. Las
--    referencias (conversación, contacto, canal, organización), el consentimiento y las marcas de unión las
--    escribe solo el servidor. RLS decide QUÉ filas; estos disparadores, QUÉ columnas.
-- 3) Respuestas del área: un tope de intentos, para no llamar al modelo en cada pasada si el envío falla.
-- 4) Turno del agente por conversación: una sola ejecución responde a la vez (las pasadas del trabajador pueden
--    superponerse).
-- 5) agent_open_case tolera la carrera de dos ejecuciones creando el mismo caso.

-- 1) Tokens de canal -----------------------------------------------------------------------------------------

alter table public.channels
  add constraint channels_secret_ref_format
  check (secret_ref is null or secret_ref ~ '^(TELEGRAM_BOT_TOKEN|WHATSAPP_ACCESS_TOKEN|CHANNEL_TOKEN)(_[A-Z0-9]+)*$');

create or replace function private.channels_guard_secret_ref()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and (tg_op = 'INSERT' or new.secret_ref is distinct from old.secret_ref)
     and new.secret_ref is not null then
    raise exception 'Solo el servidor puede definir el token de un canal';
  end if;
  return new;
end;
$$;

create trigger channels_guard_secret_ref
  before insert or update on public.channels
  for each row execute function private.channels_guard_secret_ref();

-- 2) Columnas protegidas ----------------------------------------------------------------------------------------

create or replace function private.guard_user_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- El servidor (sin usuario) puede todo; las restricciones son para las sesiones de personas.
  if auth.uid() is null then
    return new;
  end if;

  if tg_table_name = 'conversations' then
    if new.organization_id is distinct from old.organization_id
       or new.channel_id is distinct from old.channel_id
       or new.contact_id is distinct from old.contact_id then
      raise exception 'No se puede cambiar la organización, el canal ni el contacto de una conversación';
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
       or new.reply_attempts is distinct from old.reply_attempts then
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

-- 3) Tope de intentos de las respuestas del área (antes del disparador, que lo usa) --------------------------

alter table public.area_queries
  add column reply_attempts integer not null default 0 check (reply_attempts >= 0),
  add column reply_error text;

create trigger conversations_guard_user_columns
  before update on public.conversations
  for each row execute function private.guard_user_columns();
create trigger contacts_guard_user_columns
  before update on public.contacts
  for each row execute function private.guard_user_columns();
create trigger area_queries_guard_user_columns
  before update on public.area_queries
  for each row execute function private.guard_user_columns();
create trigger notifications_guard_user_columns
  before update on public.notifications
  for each row execute function private.guard_user_columns();

revoke all on function private.guard_user_columns() from public, anon, authenticated;
revoke all on function private.channels_guard_secret_ref() from public, anon, authenticated;

-- 4) Turno del agente por conversación ------------------------------------------------------------------------

alter table public.conversations add column agent_lock_until timestamptz;

-- Toma el turno si está libre o vencido. Devuelve true si lo tomó. El vencimiento evita que un corte deje la
-- conversación bloqueada para siempre.
create or replace function public.claim_agent_turn(p_conversation_id uuid, p_seconds integer default 120)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with claimed as (
    update public.conversations
    set agent_lock_until = now() + make_interval(secs => p_seconds)
    where id = p_conversation_id and (agent_lock_until is null or agent_lock_until < now())
    returning id
  )
  select exists (select 1 from claimed)
$$;

create or replace function public.release_agent_turn(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversations set agent_lock_until = null where id = p_conversation_id
$$;

revoke all on function public.claim_agent_turn(uuid, integer) from public, anon, authenticated;
revoke all on function public.release_agent_turn(uuid) from public, anon, authenticated;
grant execute on function public.claim_agent_turn(uuid, integer) to service_role;
grant execute on function public.release_agent_turn(uuid) to service_role;

-- 5) agent_open_case con carrera ---------------------------------------------------------------------------------

create or replace function private.agent_open_case(p_conversation_id uuid)
returns public.cases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.conversations;
  v_case public.cases;
begin
  select * into v_conversation from public.conversations where id = p_conversation_id;
  if not found then
    raise exception 'Conversación no encontrada';
  end if;

  select * into v_case
  from public.cases
  where conversation_id = p_conversation_id and status <> 'resolved';

  if not found then
    begin
      insert into public.cases (organization_id, contact_id, conversation_id)
      values (v_conversation.organization_id, v_conversation.contact_id, p_conversation_id)
      returning * into v_case;
    exception when unique_violation then
      -- Otra ejecución lo creó al mismo tiempo: se usa ese.
      select * into v_case
      from public.cases
      where conversation_id = p_conversation_id and status <> 'resolved';
    end;
  end if;

  return v_case;
end;
$$;

revoke all on function private.agent_open_case(uuid) from public, anon, authenticated;
