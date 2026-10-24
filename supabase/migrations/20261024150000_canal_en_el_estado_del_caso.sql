-- Fase 6, paso 6.15: el estado del caso incluye el canal de la conversación.
--
-- Hay datos que el canal ya conoce: por WhatsApp, el teléfono del asociado es el identificador del chat.
-- Si el agente los pidiera de nuevo sería un paso de más. El estado del caso devuelve el tipo de canal y el
-- identificador del contacto en ese canal para que el sistema los tome solo.

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
  v_channel_type public.channel_type;
  v_identifier text;
begin
  select * into v_conversation from public.conversations where id = p_conversation_id;
  if not found then
    raise exception 'Conversación no encontrada';
  end if;

  select * into v_contact from public.contacts where id = v_conversation.contact_id;

  select type into v_channel_type from public.channels where id = v_conversation.channel_id;

  select identifier into v_identifier
  from public.contact_identities
  where contact_id = v_conversation.contact_id and channel_type = v_channel_type
  limit 1;

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
    ),
    'channel', jsonb_build_object('type', v_channel_type, 'identifier', v_identifier)
  );
end;
$$;

revoke all on function public.agent_case_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.agent_case_snapshot(uuid) to service_role;
