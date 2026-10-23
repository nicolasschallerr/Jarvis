-- Fase 5, paso 5.3: historial automático de casos y dos reglas de integridad.
--
-- 1) Un solo caso abierto por conversación. El agente y los operadores se apoyan en esta regla: si
--    hay un caso sin resolver, se sigue trabajando en él en vez de abrir otro.
-- 2) resolved_at se mantiene solo: se completa al pasar a "resolved" y se borra si se reabre.
-- 3) Cada alta y cada cambio de estado, prioridad, sector o asignación queda en case_events, escrito
--    por un disparador. Así no depende de que cada pantalla o proceso se acuerde de anotarlo, y los
--    usuarios no necesitan permiso de escritura sobre case_events.

create unique index cases_one_open_per_conversation
  on public.cases (conversation_id)
  where status <> 'resolved' and conversation_id is not null;

-- resolved_at coherente con el estado.
create or replace function private.cases_sync_resolved_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'resolved' and (tg_op = 'INSERT' or old.status is distinct from 'resolved') then
    new.resolved_at := coalesce(new.resolved_at, now());
  elsif new.status <> 'resolved' then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;

create trigger cases_sync_resolved_at
  before insert or update of status on public.cases
  for each row execute function private.cases_sync_resolved_at();

-- Historial. Corre con los permisos del dueño de la función para poder escribir en case_events;
-- el actor sale de la sesión: un usuario del CRM queda como "operator" y los procesos del servidor
-- (sin usuario) como "system".
create or replace function private.log_case_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_type public.message_sender :=
    case when auth.uid() is null then 'system'::public.message_sender else 'operator'::public.message_sender end;
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

revoke all on function private.log_case_events() from public, anon, authenticated;
revoke all on function private.cases_sync_resolved_at() from public, anon, authenticated;

create trigger cases_log_events
  after insert or update on public.cases
  for each row execute function private.log_case_events();
