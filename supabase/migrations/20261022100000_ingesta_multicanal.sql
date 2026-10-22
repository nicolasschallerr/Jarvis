-- Fase 3, paso 3.4: la ingesta de mensajes entrantes deja de ser exclusiva de WhatsApp.
-- Reemplaza ingest_inbound_message por una versión que recibe el tipo de canal, de modo que el
-- mismo flujo sirva para Telegram (desarrollo) y WhatsApp (producción) sin duplicar lógica.

drop function if exists public.ingest_inbound_message(
  uuid, uuid, text, text, text, public.message_type, text, timestamptz, jsonb
);

create or replace function public.ingest_inbound_message(
  p_organization_id uuid,
  p_channel_id uuid,
  p_channel_type public.channel_type,
  p_identifier text,
  p_contact_name text,
  p_external_id text,
  p_type public.message_type,
  p_body text,
  p_provider_timestamp timestamptz,
  p_raw jsonb
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_contact_id uuid;
  v_conversation_id uuid;
  v_message_id uuid;
begin
  -- Serializa el alta por contacto: dos primeros mensajes simultáneos no crean dos fichas.
  perform pg_advisory_xact_lock(
    hashtextextended(p_organization_id::text || ':' || p_channel_type::text || ':' || p_identifier, 0)
  );

  select contact_id
    into v_contact_id
    from public.contact_identities
   where organization_id = p_organization_id
     and channel_type = p_channel_type
     and identifier = p_identifier;

  if v_contact_id is null then
    insert into public.contacts (organization_id, display_name)
    values (p_organization_id, nullif(p_contact_name, ''))
    returning id into v_contact_id;

    insert into public.contact_identities (organization_id, contact_id, channel_type, identifier)
    values (p_organization_id, v_contact_id, p_channel_type, p_identifier);
  elsif nullif(p_contact_name, '') is not null then
    update public.contacts
       set display_name = p_contact_name
     where id = v_contact_id
       and display_name is null;
  end if;

  insert into public.conversations (organization_id, contact_id, channel_id)
  values (p_organization_id, v_contact_id, p_channel_id)
  on conflict (channel_id, contact_id) do update set updated_at = now()
  returning id into v_conversation_id;

  insert into public.messages (
    organization_id, conversation_id, direction, sender, type, body,
    external_id, status, provider_timestamp, raw
  )
  values (
    p_organization_id, v_conversation_id, 'inbound', 'contact', p_type, p_body,
    p_external_id, 'delivered', p_provider_timestamp, p_raw
  )
  on conflict (organization_id, external_id) where external_id is not null do nothing
  returning id into v_message_id;

  -- Ya existía: es un reproceso. No se toca nada más (ni la conversación ni los créditos).
  if v_message_id is null then
    return null;
  end if;

  -- El orden usa la hora del proveedor, así un mensaje viejo que llega tarde no retrocede el reloj.
  update public.conversations
     set last_inbound_at = greatest(coalesce(last_inbound_at, p_provider_timestamp), p_provider_timestamp),
         last_message_at = greatest(coalesce(last_message_at, p_provider_timestamp), p_provider_timestamp)
   where id = v_conversation_id;

  -- 1 crédito = 1 ventana de 24 h por contacto. Si ya hay una abierta en ese momento, no se cobra otra.
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
        p_organization_id, v_contact_id, v_conversation_id, 'contact',
        p_provider_timestamp, p_provider_timestamp + interval '24 hours'
      );
    exception
      when exclusion_violation then
        null; -- otra ventana se superpone: ya está cubierto
    end;
  end if;

  return v_message_id;
end;
$$;

revoke all on function public.ingest_inbound_message(
  uuid, uuid, public.channel_type, text, text, text, public.message_type, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.ingest_inbound_message(
  uuid, uuid, public.channel_type, text, text, text, public.message_type, text, timestamptz, jsonb
) to service_role;
