-- Un segundo tema en la misma conversación (ADR-040).
--
-- Una conversación tiene un solo caso abierto (índice cases_one_open_per_conversation). Si el agente ya había derivado el
-- caso a un sector y la persona traía otro tema que va a OTRO sector, derivar de nuevo le cambiaba el sector y le pisaba el
-- resumen al primer tema: el primer sector perdía su caso sin enterarse.
--
-- Ahora, si el caso ya está en un sector y la derivación es a un sector distinto:
--   - el caso se queda donde está (con su sector, prioridad y estado);
--   - el resumen del segundo tema se SUMA al del caso, indicando para qué sector es;
--   - el sector nuevo recibe su aviso con el resumen de lo suyo, para que lo vea y contacte a la persona.
-- Si es el mismo sector (o el caso todavía no tenía sector) se comporta como siempre.

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
  v_extra text;
begin
  perform set_config('jarvis.actor', 'agent', true);

  v_case := private.agent_open_case(p_conversation_id);

  select * into v_sector
  from public.sectors
  where organization_id = v_case.organization_id and slug = p_sector_slug and is_active;
  if not found then
    raise exception 'Sector desconocido: %', p_sector_slug;
  end if;

  if v_case.sector_id is not null and v_case.sector_id <> v_sector.id then
    v_extra := 'Otro tema, para ' || v_sector.name || ': ' || coalesce(nullif(trim(p_summary), ''), 'sin resumen');

    update public.cases
    set summary = left(coalesce(nullif(summary, ''), 'Sin resumen del primer tema') || E'\n\n' || v_extra, 4000)
    where id = v_case.id
    returning * into v_case;

    perform private.notify_sector(
      v_sector.id, v_case.id, 'case_handoff',
      'Consulta nueva para ' || v_sector.name,
      left(coalesce(nullif(trim(p_summary), ''), 'Consulta derivada por el agente'), 500)
    );

    return v_case.id;
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
