-- Fase 6, paso 6.13: lectura del estado del caso para el agente.
--
-- Antes de derivar, el agente comprueba que estén los datos obligatorios de la unidad (el "guardián de
-- datos"). Para eso necesita saber qué hay guardado: la unidad del caso, sus datos y la ficha del
-- asociado. Es una lectura, no escribe nada. Si no hay un caso abierto devuelve solo la ficha.

create or replace function public.agent_case_snapshot(p_conversation_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_conversation public.conversations;
  v_contact public.contacts;
  v_case public.cases;
  v_unit text;
begin
  select * into v_conversation from public.conversations where id = p_conversation_id;
  if not found then
    raise exception 'Conversación no encontrada';
  end if;

  select * into v_contact from public.contacts where id = v_conversation.contact_id;

  select * into v_case
  from public.cases
  where conversation_id = p_conversation_id and status <> 'resolved';

  if found and v_case.unit_id is not null then
    select slug into v_unit from public.business_units where id = v_case.unit_id;
  end if;

  return jsonb_build_object(
    'unit', v_unit,
    'data', coalesce(v_case.collected_data, '{}'::jsonb) - '_reintentos',
    'contact', jsonb_build_object(
      'name', v_contact.display_name,
      'document', v_contact.document_number,
      'locality', v_contact.locality
    )
  );
end;
$$;

revoke all on function public.agent_case_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.agent_case_snapshot(uuid) to service_role;
