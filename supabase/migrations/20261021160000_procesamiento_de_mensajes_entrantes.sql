-- Fase 3, paso 3.3: procesamiento de los eventos entrantes de WhatsApp.
-- Depende de las migraciones anteriores (webhook_events, contacts, conversations, messages,
-- conversation_windows).

-- ---------------------------------------------------------------------------
-- Control de reintentos de la bandeja de entrada
-- ---------------------------------------------------------------------------

alter table public.webhook_events
  add column claimed_at timestamptz,
  add column attempts integer not null default 0;

-- Toma un lote de eventos pendientes para procesarlos. Es seguro con varios trabajadores a la
-- vez (for update skip locked: cada uno recibe eventos distintos). Un evento tomado y no
-- terminado vuelve a estar disponible a los 5 minutos (si el trabajador se cayó). Tras 5
-- intentos fallidos se descarta con su error: no se reintenta para siempre.
create or replace function public.claim_webhook_events(p_prefix text, p_limit integer default 20)
returns setof public.webhook_events
language plpgsql
set search_path = ''
as $$
begin
  update public.webhook_events
     set processed_at = now(),
         error = coalesce(error, 'Error desconocido') || ' (se superó el máximo de intentos)'
   where processed_at is null
     and attempts >= 5
     and dedupe_key like p_prefix;

  return query
  with next as (
    select id
      from public.webhook_events
     where processed_at is null
       and organization_id is not null
       and dedupe_key like p_prefix
       and (claimed_at is null or claimed_at < now() - interval '5 minutes')
     order by received_at
     limit p_limit
     for update skip locked
  )
  update public.webhook_events e
     set claimed_at = now(),
         attempts = e.attempts + 1
    from next
   where e.id = next.id
  returning e.*;
end;
$$;

-- ---------------------------------------------------------------------------
-- Alta de un mensaje entrante: contacto, conversación, mensaje y ventana de crédito en una
-- sola transacción. Es idempotente: procesar dos veces el mismo mensaje no duplica nada.
-- ---------------------------------------------------------------------------

create or replace function public.ingest_inbound_message(
  p_organization_id uuid,
  p_channel_id uuid,
  p_wa_id text,
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
  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text || ':' || p_wa_id, 0));

  select contact_id
    into v_contact_id
    from public.contact_identities
   where organization_id = p_organization_id
     and channel_type = 'whatsapp'
     and identifier = p_wa_id;

  if v_contact_id is null then
    insert into public.contacts (organization_id, display_name)
    values (p_organization_id, nullif(p_contact_name, ''))
    returning id into v_contact_id;

    insert into public.contact_identities (organization_id, contact_id, channel_type, identifier)
    values (p_organization_id, v_contact_id, 'whatsapp', p_wa_id);
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

-- Solo el servidor (clave de servicio) puede llamar a estas funciones.
revoke all on function public.claim_webhook_events(text, integer) from public, anon, authenticated;
grant execute on function public.claim_webhook_events(text, integer) to service_role;

revoke all on function public.ingest_inbound_message(
  uuid, uuid, text, text, text, public.message_type, text, timestamptz, jsonb
) from public, anon, authenticated;
grant execute on function public.ingest_inbound_message(
  uuid, uuid, text, text, text, public.message_type, text, timestamptz, jsonb
) to service_role;
