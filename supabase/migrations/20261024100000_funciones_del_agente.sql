-- Fase 6, paso 6.1: funciones con las que el agente de atención escribe casos, y el actor "agente"
-- en el historial.
--
-- El agente corre en el servidor con la clave de servicio (sin usuario), así que el disparador de
-- historial lo anotaba como "system". Cada función fija el valor de sesión jarvis.actor = 'agent'
-- (solo dentro de su transacción) y el disparador lo lee. Así "agente" y "sistema" se distinguen sin
-- que cada llamada tenga que acordarse de anotarlo (ver ADR-017 y ADR-019).

create or replace function private.log_case_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_type public.message_sender :=
    case
      when auth.uid() is not null then 'operator'::public.message_sender
      when current_setting('jarvis.actor', true) = 'agent' then 'agent'::public.message_sender
      else 'system'::public.message_sender
    end;
begin
  if tg_op = 'INSERT' then
    insert into public.case_events (organization_id, case_id, actor_type, actor_profile_id, event_type, data)
    values (
      new.organization_id, new.id, v_actor_type, v_actor, 'created',
      jsonb_build_object(
        'title', new.title, 'status', new.status, 'priority', new.priority,
        'sector_id', new.sector_id, 'assigned_to', new.assigned_to
      )
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.case_events (organization_id, case_id, actor_type, actor_profile_id, event_type, data)
    values (new.organization_id, new.id, v_actor_type, v_actor, 'status_changed',
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.priority is distinct from old.priority then
    insert into public.case_events (organization_id, case_id, actor_type, actor_profile_id, event_type, data)
    values (new.organization_id, new.id, v_actor_type, v_actor, 'priority_changed',
            jsonb_build_object('from', old.priority, 'to', new.priority));
  end if;

  if new.sector_id is distinct from old.sector_id then
    insert into public.case_events (organization_id, case_id, actor_type, actor_profile_id, event_type, data)
    values (new.organization_id, new.id, v_actor_type, v_actor, 'sector_changed',
            jsonb_build_object('from', old.sector_id, 'to', new.sector_id));
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    insert into public.case_events (organization_id, case_id, actor_type, actor_profile_id, event_type, data)
    values (new.organization_id, new.id, v_actor_type, v_actor, 'assigned',
            jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to));
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Caso abierto de la conversación (lo crea si no existe). Uso interno de las funciones de abajo.
-- ---------------------------------------------------------------------------

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
    insert into public.cases (organization_id, contact_id, conversation_id)
    values (v_conversation.organization_id, v_conversation.contact_id, p_conversation_id)
    returning * into v_case;
  end if;

  return v_case;
end;
$$;

revoke all on function private.agent_open_case(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Guardar datos del caso: unidad, título y datos juntados (se suman a lo que ya había).
-- ---------------------------------------------------------------------------

create or replace function public.agent_save_case_data(
  p_conversation_id uuid,
  p_unit_slug text,
  p_title text,
  p_data jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_unit_id uuid;
begin
  perform set_config('jarvis.actor', 'agent', true);

  v_case := private.agent_open_case(p_conversation_id);

  if p_unit_slug is not null and p_unit_slug <> '' then
    select id into v_unit_id
    from public.business_units
    where organization_id = v_case.organization_id and slug = p_unit_slug and is_active;
    if v_unit_id is null then
      raise exception 'Unidad desconocida: %', p_unit_slug;
    end if;
  end if;

  update public.cases
  set unit_id = coalesce(v_unit_id, unit_id),
      title = coalesce(nullif(p_title, ''), title),
      collected_data = collected_data || coalesce(p_data, '{}'::jsonb)
  where id = v_case.id;

  return v_case.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Derivar al sector con un resumen. El caso queda "nuevo" en la cola del sector.
-- ---------------------------------------------------------------------------

create or replace function public.agent_handoff_case(
  p_conversation_id uuid,
  p_sector_slug text,
  p_summary text,
  p_priority public.case_priority default 'normal'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_sector_id uuid;
begin
  perform set_config('jarvis.actor', 'agent', true);

  v_case := private.agent_open_case(p_conversation_id);

  select id into v_sector_id
  from public.sectors
  where organization_id = v_case.organization_id and slug = p_sector_slug and is_active;
  if v_sector_id is null then
    raise exception 'Sector desconocido: %', p_sector_slug;
  end if;

  update public.cases
  set sector_id = v_sector_id,
      summary = p_summary,
      priority = coalesce(p_priority, priority),
      status = case when status = 'waiting_area' then status else 'new' end
  where id = v_case.id;

  return v_case.id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Consultar a un sector: queda pendiente y el caso pasa a "esperando al área".
-- ---------------------------------------------------------------------------

create or replace function public.agent_ask_area(
  p_conversation_id uuid,
  p_sector_slug text,
  p_question text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_sector_id uuid;
  v_query_id uuid;
begin
  perform set_config('jarvis.actor', 'agent', true);

  v_case := private.agent_open_case(p_conversation_id);

  select id into v_sector_id
  from public.sectors
  where organization_id = v_case.organization_id and slug = p_sector_slug and is_active;
  if v_sector_id is null then
    raise exception 'Sector desconocido: %', p_sector_slug;
  end if;

  insert into public.area_queries (organization_id, case_id, conversation_id, sector_id, question)
  values (v_case.organization_id, v_case.id, p_conversation_id, v_sector_id, p_question)
  returning id into v_query_id;

  update public.cases
  set sector_id = v_sector_id, status = 'waiting_area'
  where id = v_case.id;

  return v_query_id;
end;
$$;

-- Solo el servidor (clave de servicio) las puede llamar.
revoke all on function public.agent_save_case_data(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.agent_handoff_case(uuid, text, text, public.case_priority) from public, anon, authenticated;
revoke all on function public.agent_ask_area(uuid, text, text) from public, anon, authenticated;
grant execute on function public.agent_save_case_data(uuid, text, text, jsonb) to service_role;
grant execute on function public.agent_handoff_case(uuid, text, text, public.case_priority) to service_role;
grant execute on function public.agent_ask_area(uuid, text, text) to service_role;
