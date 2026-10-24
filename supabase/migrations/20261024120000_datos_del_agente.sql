-- Fase 6, paso 6.12: datos que junta el agente.
--
-- 1) agent_save_contact_data: guarda en la ficha del asociado el nombre, el documento y la localidad
--    que dio en la conversación (solo lo que viene completo; no borra lo que ya había).
-- 2) agent_record_field_attempt: cuenta los intentos fallidos de un dato dentro del caso, para derivar
--    a una persona cuando se supera el límite configurado. El contador vive en collected_data bajo la
--    clave "_reintentos" y se borra cuando el dato se valida.
-- 3) La auditoría de contactos anota si el cambio lo hizo el agente (ver lección 37).

create or replace function public.agent_save_contact_data(
  p_conversation_id uuid,
  p_display_name text,
  p_document_number text,
  p_locality text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conversation public.conversations;
  v_name text := nullif(btrim(coalesce(p_display_name, '')), '');
  v_locality text := nullif(btrim(coalesce(p_locality, '')), '');
  v_document text := nullif(regexp_replace(coalesce(p_document_number, ''), '\D', '', 'g'), '');
begin
  perform set_config('jarvis.actor', 'agent', true);

  select * into v_conversation from public.conversations where id = p_conversation_id;
  if not found then
    raise exception 'Conversación no encontrada';
  end if;

  if v_name is not null and char_length(v_name) > 120 then raise exception 'El nombre es demasiado largo'; end if;
  if v_locality is not null and char_length(v_locality) > 80 then raise exception 'La localidad es demasiado larga'; end if;
  if v_document is not null and char_length(v_document) not between 7 and 11 then
    raise exception 'El documento debe tener entre 7 y 11 dígitos';
  end if;

  update public.contacts
  set display_name = coalesce(v_name, display_name),
      document_number = coalesce(v_document, document_number),
      locality = coalesce(v_locality, locality)
  where id = v_conversation.contact_id and organization_id = v_conversation.organization_id;
end;
$$;

create or replace function public.agent_record_field_attempt(
  p_conversation_id uuid,
  p_field text,
  p_ok boolean
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case public.cases;
  v_count integer;
begin
  if p_field !~ '^[a-z0-9_]{1,40}$' then
    raise exception 'Nombre de dato inválido';
  end if;

  perform set_config('jarvis.actor', 'agent', true);
  v_case := private.agent_open_case(p_conversation_id);

  if p_ok then
    update public.cases set collected_data = collected_data #- array['_reintentos', p_field] where id = v_case.id;
    return 0;
  end if;

  v_count := coalesce((v_case.collected_data -> '_reintentos' ->> p_field)::integer, 0) + 1;
  update public.cases
  set collected_data = jsonb_set(
    collected_data,
    '{_reintentos}',
    coalesce(collected_data -> '_reintentos', '{}'::jsonb) || jsonb_build_object(p_field, v_count),
    true
  )
  where id = v_case.id;

  return v_count;
end;
$$;

revoke all on function public.agent_save_contact_data(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.agent_record_field_attempt(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.agent_save_contact_data(uuid, text, text, text) to service_role;
grant execute on function public.agent_record_field_attempt(uuid, text, boolean) to service_role;

create or replace function private.audit_contact_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields text[] := array[]::text[];
  v_actor text :=
    case
      when auth.uid() is not null then 'operator'
      when current_setting('jarvis.actor', true) = 'agent' then 'agent'
      else 'system'
    end;
begin
  if new.display_name is distinct from old.display_name then v_fields := array_append(v_fields, 'display_name'::text); end if;
  if new.document_number is distinct from old.document_number then v_fields := array_append(v_fields, 'document_number'::text); end if;
  if new.locality is distinct from old.locality then v_fields := array_append(v_fields, 'locality'::text); end if;
  if new.notes is distinct from old.notes then v_fields := array_append(v_fields, 'notes'::text); end if;
  if new.client_record_id is distinct from old.client_record_id then v_fields := array_append(v_fields, 'client_record_id'::text); end if;
  if new.opted_in_at is distinct from old.opted_in_at then v_fields := array_append(v_fields, 'opted_in_at'::text); end if;
  if new.opted_out_at is distinct from old.opted_out_at then v_fields := array_append(v_fields, 'opted_out_at'::text); end if;

  if cardinality(v_fields) > 0 then
    insert into public.audit_log (organization_id, actor_profile_id, action, entity_type, entity_id, data)
    values (
      new.organization_id, auth.uid(), 'contact.updated', 'contact', new.id,
      jsonb_build_object('fields', v_fields, 'actor', v_actor)
    );
  end if;

  return new;
end;
$$;
