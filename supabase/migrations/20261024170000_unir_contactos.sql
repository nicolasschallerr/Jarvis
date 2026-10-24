-- Fase 12, paso 12.1: unir contactos duplicados.
--
-- La misma persona puede escribir por dos canales (o con dos números) y quedar como dos contactos. Unir es
-- pasar todo lo de uno (el "absorbido") al otro (el "conservado"): identidades, conversaciones, casos,
-- seguimientos y datos de la ficha. Es una sola transacción: o se une todo o no se toca nada.
--
-- El contacto absorbido NO se borra: queda vacío y marcado como unido (merged_into). Sus ventanas de crédito
-- (ADR-010) siguen a su nombre: son el historial de facturación y no se reescribe ni se superpone con las del
-- conservado. Sus datos personales se vacían, porque ya están en el contacto conservado (minimización).

alter table public.contacts
  add column merged_into uuid references public.contacts (id) on delete set null,
  add column merged_at timestamptz,
  add constraint contacts_merged_consistent check ((merged_into is null) = (merged_at is null));

create index contacts_merged_into_idx on public.contacts (merged_into) where merged_into is not null;

create or replace function public.merge_contacts(p_keep uuid, p_remove uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid := (select private.current_org_id());
  v_keep public.contacts;
  v_remove public.contacts;
  v_conv record;
  v_target uuid;
  v_identities integer;
  v_moved integer := 0;
  v_merged integer := 0;
  v_cases integer;
begin
  if (select private.current_user_role()) is distinct from 'superadmin' then
    raise exception 'Solo un superadministrador puede unir contactos';
  end if;
  if p_keep = p_remove then
    raise exception 'No se puede unir un contacto consigo mismo';
  end if;

  select * into v_keep from public.contacts where id = p_keep and organization_id = v_org for update;
  if not found then raise exception 'El contacto a conservar no existe'; end if;
  select * into v_remove from public.contacts where id = p_remove and organization_id = v_org for update;
  if not found then raise exception 'El contacto a unir no existe'; end if;
  if v_keep.merged_into is not null or v_remove.merged_into is not null then
    raise exception 'Uno de los contactos ya fue unido a otro';
  end if;

  -- Un caso abierto por conversación (índice único): si los dos tienen uno en el mismo canal no se pueden
  -- juntar sin decidir cuál sigue. Se pide resolver uno antes, y no se toca nada.
  for v_conv in select id, channel_id from public.conversations where contact_id = p_remove loop
    select id into v_target from public.conversations where contact_id = p_keep and channel_id = v_conv.channel_id;
    if v_target is not null
       and exists (select 1 from public.cases where conversation_id = v_conv.id and status <> 'resolved')
       and exists (select 1 from public.cases where conversation_id = v_target and status <> 'resolved') then
      raise exception 'Los dos contactos tienen un caso abierto en el mismo canal: resolvé uno antes de unirlos';
    end if;
  end loop;

  -- Conversaciones: si el conservado no tiene una en ese canal, se la queda; si ya tiene, se junta todo en
  -- la suya y se elimina la del absorbido.
  for v_conv in
    select id, channel_id, last_inbound_at, last_message_at from public.conversations where contact_id = p_remove
  loop
    select id into v_target from public.conversations where contact_id = p_keep and channel_id = v_conv.channel_id;

    if v_target is null then
      update public.conversations set contact_id = p_keep where id = v_conv.id;
      v_moved := v_moved + 1;
    else
      update public.messages set conversation_id = v_target where conversation_id = v_conv.id;
      update public.cases set conversation_id = v_target where conversation_id = v_conv.id;
      update public.internal_notes set conversation_id = v_target where conversation_id = v_conv.id;
      update public.area_queries set conversation_id = v_target where conversation_id = v_conv.id;
      update public.followups set conversation_id = v_target where conversation_id = v_conv.id;
      update public.ai_calls set conversation_id = v_target where conversation_id = v_conv.id;
      update public.conversation_evaluations set conversation_id = v_target where conversation_id = v_conv.id;
      update public.conversation_windows set conversation_id = v_target where conversation_id = v_conv.id;

      update public.conversations
      set last_inbound_at = greatest(last_inbound_at, v_conv.last_inbound_at),
          last_message_at = greatest(last_message_at, v_conv.last_message_at)
      where id = v_target;

      delete from public.conversations where id = v_conv.id;
      v_merged := v_merged + 1;
    end if;
  end loop;

  update public.contact_identities set contact_id = p_keep where contact_id = p_remove;
  get diagnostics v_identities = row_count;

  update public.cases set contact_id = p_keep where contact_id = p_remove;
  get diagnostics v_cases = row_count;
  update public.followups set contact_id = p_keep where contact_id = p_remove;

  -- Envíos masivos: si los dos figuran en el mismo envío, queda uno solo.
  delete from public.broadcast_recipients r
  where r.contact_id = p_remove
    and exists (select 1 from public.broadcast_recipients k where k.broadcast_id = r.broadcast_id and k.contact_id = p_keep);
  update public.broadcast_recipients set contact_id = p_keep where contact_id = p_remove;

  -- Ficha: el conservado completa lo que le falta con lo del absorbido. Consentimiento: se conserva la baja
  -- más reciente (la prudente) y el alta más reciente.
  update public.contacts
  set display_name = coalesce(v_keep.display_name, v_remove.display_name),
      document_number = coalesce(v_keep.document_number, v_remove.document_number),
      locality = coalesce(v_keep.locality, v_remove.locality),
      client_record_id = coalesce(v_keep.client_record_id, v_remove.client_record_id),
      notes = case
        when v_keep.notes is null then v_remove.notes
        when v_remove.notes is null then v_keep.notes
        else v_keep.notes || E'\n---\n' || v_remove.notes
      end,
      opted_in_at = greatest(v_keep.opted_in_at, v_remove.opted_in_at),
      opted_out_at = greatest(v_keep.opted_out_at, v_remove.opted_out_at)
  where id = p_keep;

  -- El absorbido queda vacío y marcado. Sus ventanas de crédito siguen a su nombre.
  update public.contacts
  set merged_into = p_keep,
      merged_at = now(),
      display_name = null,
      document_number = null,
      locality = null,
      client_record_id = null,
      notes = null,
      opted_in_at = null,
      opted_out_at = null
  where id = p_remove;

  insert into public.audit_log (organization_id, actor_profile_id, action, entity_type, entity_id, data)
  values (
    v_org, auth.uid(), 'contact.merged', 'contact', p_keep,
    jsonb_build_object(
      'absorbed_contact', p_remove,
      'identities_moved', v_identities,
      'conversations_moved', v_moved,
      'conversations_merged', v_merged,
      'cases_moved', v_cases
    )
  );

  return jsonb_build_object(
    'identities_moved', v_identities,
    'conversations_moved', v_moved,
    'conversations_merged', v_merged,
    'cases_moved', v_cases
  );
end;
$$;

revoke all on function public.merge_contacts(uuid, uuid) from public, anon;
grant execute on function public.merge_contacts(uuid, uuid) to authenticated;
