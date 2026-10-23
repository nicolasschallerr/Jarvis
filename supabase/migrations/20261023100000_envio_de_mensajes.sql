-- Fase 3, paso 3.5: envío de mensajes salientes.
-- Cierra un mensaje saliente cuando el proveedor ya lo aceptó: lo marca como enviado, avanza el
-- reloj de la conversación y, si el negocio inicia una conversación nueva, abre su ventana de
-- crédito (los contactos iniciados por el cliente también consumen crédito).

create or replace function public.finalize_outbound_message(
  p_message_id uuid,
  p_external_id text,
  p_provider_timestamp timestamptz
)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_organization_id uuid;
  v_conversation_id uuid;
  v_contact_id uuid;
begin
  update public.messages
     set status = 'sent',
         external_id = p_external_id,
         provider_timestamp = p_provider_timestamp,
         status_updated_at = now(),
         error = null
   where id = p_message_id
     and direction = 'outbound'
  returning organization_id, conversation_id
       into v_organization_id, v_conversation_id;

  -- No existe o no es un mensaje saliente: no hay nada más que hacer.
  if v_conversation_id is null then
    return;
  end if;

  select contact_id
    into v_contact_id
    from public.conversations
   where id = v_conversation_id;

  update public.conversations
     set last_message_at = greatest(coalesce(last_message_at, p_provider_timestamp), p_provider_timestamp)
   where id = v_conversation_id;

  -- 1 crédito = 1 ventana de 24 h por contacto. Si no hay una abierta, la abre el negocio.
  if not exists (
    select 1
      from public.conversation_windows
     where contact_id = v_contact_id
       and opened_at <= p_provider_timestamp
       and expires_at > p_provider_timestamp
  ) then
    begin
      insert into public.conversation_windows (
        organization_id, contact_id, conversation_id, initiated_by, opened_at, expires_at
      )
      values (
        v_organization_id, v_contact_id, v_conversation_id, 'business',
        p_provider_timestamp, p_provider_timestamp + interval '24 hours'
      );
    exception
      when exclusion_violation then
        null; -- otra ventana se superpone: ya está cubierto
    end;
  end if;
end;
$$;

revoke all on function public.finalize_outbound_message(uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.finalize_outbound_message(uuid, text, timestamptz)
  to service_role;
