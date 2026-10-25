-- Rendimiento de la bandeja con miles de conversaciones (ADR-032).
--
-- Antes, la vista de resumen buscaba el último mensaje de CADA conversación en cada carga (una subconsulta ordenada
-- por fila) y los conteos de las pestañas filtraban sobre ese cálculo: recorrían toda la organización. Ahora el último
-- mensaje se guarda en la propia conversación, lo mantiene un disparador y los filtros usan índices comunes.

-- 1) Todo mensaje tiene hora (la del proveedor o, si no la trae, la de guardado) ---------------------------------

update public.messages set provider_timestamp = created_at where provider_timestamp is null;
alter table public.messages alter column provider_timestamp set not null;

-- 2) El último mensaje, en la conversación -----------------------------------------------------------------------

alter table public.conversations
  add column last_message_id uuid,
  add column last_body text,
  add column last_type public.message_type,
  add column last_direction public.message_direction,
  add column last_sender public.message_sender;

-- Para buscar el último mensaje que no falló de una conversación sin ordenar todo.
create index if not exists messages_last_idx
  on public.messages (conversation_id, provider_timestamp desc, created_at desc)
  where status <> 'failed';

create or replace function private.refresh_last_message(p_conversation_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.conversations c
  set last_message_id = lm.id,
      last_body = lm.body,
      last_type = lm.type,
      last_direction = lm.direction,
      last_sender = lm.sender
  from (
    select m.id, m.body, m.type, m.direction, m.sender
    from public.messages m
    where m.conversation_id = p_conversation_id and m.status <> 'failed'
    order by m.provider_timestamp desc, m.created_at desc
    limit 1
  ) lm
  where c.id = p_conversation_id
$$;

create or replace function private.messages_refresh_last()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.refresh_last_message(new.conversation_id);
  return null;
end;
$$;

-- Al guardar un mensaje, o cuando cambia su estado (un envío fallido deja de ser "el último") o su hora.
create trigger messages_refresh_last_insert
  after insert on public.messages
  for each row execute function private.messages_refresh_last();
create trigger messages_refresh_last_update
  after update of status, provider_timestamp on public.messages
  for each row
  when (old.status is distinct from new.status or old.provider_timestamp is distinct from new.provider_timestamp)
  execute function private.messages_refresh_last();

revoke all on function private.refresh_last_message(uuid) from public, anon, authenticated;
revoke all on function private.messages_refresh_last() from public, anon, authenticated;

-- Las personas no escriben estas columnas: se suman a las protegidas.
create or replace function private.guard_user_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
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
       or new.last_message_id is distinct from old.last_message_id
       or new.last_body is distinct from old.last_body
       or new.last_type is distinct from old.last_type
       or new.last_direction is distinct from old.last_direction
       or new.last_sender is distinct from old.last_sender
       or new.agent_lock_until is distinct from old.agent_lock_until
       or new.created_at is distinct from old.created_at then
      raise exception 'Las marcas de tiempo de la conversación las registra solo el sistema';
    end if;

  elsif tg_table_name = 'cases' then
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

-- Lo que ya existe.
select private.refresh_last_message(id) from public.conversations;

-- 3) Índices de la bandeja ----------------------------------------------------------------------------------------

create index if not exists conversations_inbox_idx on public.conversations (organization_id, last_message_at desc nulls last);
create index if not exists conversations_waiting_idx on public.conversations (organization_id, last_message_at desc) where last_direction = 'inbound';
create index if not exists conversations_ai_paused_idx on public.conversations (organization_id, last_message_at desc) where not ai_enabled;
create index if not exists conversation_windows_contact_idx on public.conversation_windows (contact_id, expires_at desc);

-- 4) La vista, ahora sin subconsultas por fila para el último mensaje ---------------------------------------------

create or replace view public.conversation_summaries
with (security_invoker = true) as
select
  c.id,
  c.organization_id,
  c.contact_id,
  c.channel_id,
  c.ai_enabled,
  c.assigned_to,
  c.last_message_at,
  c.last_inbound_at,
  ct.display_name as contact_name,
  ch.type as channel_type,
  ch.name as channel_name,
  c.last_body,
  c.last_type,
  c.last_direction,
  exists (
    select 1
    from public.conversation_windows w
    where w.contact_id = c.contact_id
      and w.expires_at > now()
  ) as window_open,
  oc.status as case_status,
  oc.priority as case_priority,
  oc.assigned_to as case_assigned_to,
  c.last_sender,
  ct.document_number as contact_document,
  oc.sector_id as case_sector_id
from public.conversations c
join public.contacts ct on ct.id = c.contact_id
join public.channels ch on ch.id = c.channel_id
left join lateral (
  select cs.status, cs.priority, cs.assigned_to, cs.sector_id
  from public.cases cs
  where cs.conversation_id = c.id
    and cs.status <> 'resolved'
  limit 1
) oc on true;
