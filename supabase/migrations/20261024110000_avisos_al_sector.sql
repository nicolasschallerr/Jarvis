-- Fase 6, paso 6.9: avisos al sector.
--
-- Cuando el agente deriva un caso o le hace una consulta a un sector, las personas de ese sector reciben
-- un aviso (tabla notifications). Se crea dentro de las mismas funciones que escriben el caso, así que no
-- hay derivación ni consulta sin aviso. El aviso lleva solo el título del caso: nunca el texto de la
-- consulta ni datos del asociado.

create or replace function private.notify_sector(
  p_sector_id uuid,
  p_case_id uuid,
  p_type text,
  p_title text,
  p_body text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications (organization_id, profile_id, type, case_id, title, body)
  select m.organization_id, m.profile_id, p_type, p_case_id, p_title, p_body
  from public.sector_members m
  join public.profiles p on p.id = m.profile_id
  where m.sector_id = p_sector_id and p.is_active and p.role in ('superadmin', 'operator')
$$;

revoke all on function private.notify_sector(uuid, uuid, text, text, text) from public, anon, authenticated;

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
  v_sector public.sectors;
begin
  perform set_config('jarvis.actor', 'agent', true);

  v_case := private.agent_open_case(p_conversation_id);

  select * into v_sector
  from public.sectors
  where organization_id = v_case.organization_id and slug = p_sector_slug and is_active;
  if not found then
    raise exception 'Sector desconocido: %', p_sector_slug;
  end if;

  update public.cases
  set sector_id = v_sector.id,
      summary = p_summary,
      priority = coalesce(p_priority, priority),
      status = case when status = 'waiting_area' then status else 'new' end
  where id = v_case.id
  returning * into v_case;

  perform private.notify_sector(
    v_sector.id, v_case.id, 'case_handoff',
    'Caso nuevo para ' || v_sector.name,
    coalesce(v_case.title, 'Caso sin título')
  );

  return v_case.id;
end;
$$;

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
  v_sector public.sectors;
  v_query_id uuid;
begin
  perform set_config('jarvis.actor', 'agent', true);

  v_case := private.agent_open_case(p_conversation_id);

  select * into v_sector
  from public.sectors
  where organization_id = v_case.organization_id and slug = p_sector_slug and is_active;
  if not found then
    raise exception 'Sector desconocido: %', p_sector_slug;
  end if;

  insert into public.area_queries (organization_id, case_id, conversation_id, sector_id, question)
  values (v_case.organization_id, v_case.id, p_conversation_id, v_sector.id, p_question)
  returning id into v_query_id;

  update public.cases
  set sector_id = v_sector.id, status = 'waiting_area'
  where id = v_case.id
  returning * into v_case;

  perform private.notify_sector(
    v_sector.id, v_case.id, 'area_query',
    'Consulta pendiente para ' || v_sector.name,
    coalesce(v_case.title, 'Caso sin título')
  );

  return v_query_id;
end;
$$;

-- create or replace conserva los permisos, pero se repiten para que esta migración se lea sola.
revoke all on function public.agent_handoff_case(uuid, text, text, public.case_priority) from public, anon, authenticated;
revoke all on function public.agent_ask_area(uuid, text, text) from public, anon, authenticated;
grant execute on function public.agent_handoff_case(uuid, text, text, public.case_priority) to service_role;
grant execute on function public.agent_ask_area(uuid, text, text) to service_role;
