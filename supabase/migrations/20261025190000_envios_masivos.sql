-- Envíos masivos con consentimiento (ADR-038).
--
-- Las tablas broadcasts y broadcast_recipients existen desde la Fase 1. Se completan con lo que hace falta para enviar:
-- las variables fijas de la plantilla, cuándo empezó y terminó, y los datos para reservar y reintentar cada destinatario.
-- Solo se le escribe a quien aceptó recibir mensajes y no pidió dejar de recibirlos.

alter table public.broadcasts
  add column variables jsonb not null default '{}'::jsonb,
  add column started_at timestamptz,
  add column finished_at timestamptz;

alter table public.broadcast_recipients
  add column attempts integer not null default 0,
  add column claimed_at timestamptz,
  add column sent_at timestamptz;

-- Quién recibe: contactos con consentimiento vigente (aceptó y no se dio de baja después), con WhatsApp, sin fichas
-- unidas a otra. La zona se filtra por localidad (texto parcial; la aplicación saca los comodines antes de guardarla).
-- "security invoker": con la sesión de una persona, RLS la limita a su organización; el servidor la usa con su clave.
create or replace function public.broadcast_audience(p_org uuid, p_segment jsonb, p_limit integer default 5000)
returns table (contact_id uuid)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id
  from public.contacts c
  where c.organization_id = p_org
    and c.merged_into is null
    and c.opted_in_at is not null
    and (c.opted_out_at is null or c.opted_out_at < c.opted_in_at)
    and exists (select 1 from public.contact_identities i where i.contact_id = c.id and i.channel_type = 'whatsapp')
    and (coalesce(p_segment ->> 'locality', '') = '' or c.locality ilike '%' || (p_segment ->> 'locality') || '%')
  order by c.id
  limit greatest(1, least(p_limit, 5000))
$$;

create or replace function public.broadcast_audience_count(p_org uuid, p_segment jsonb)
returns integer
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*)::integer
  from public.contacts c
  where c.organization_id = p_org
    and c.merged_into is null
    and c.opted_in_at is not null
    and (c.opted_out_at is null or c.opted_out_at < c.opted_in_at)
    and exists (select 1 from public.contact_identities i where i.contact_id = c.id and i.channel_type = 'whatsapp')
    and (coalesce(p_segment ->> 'locality', '') = '' or c.locality ilike '%' || (p_segment ->> 'locality') || '%')
$$;

-- Avance de cada envío, en una consulta (la lista de envíos).
create or replace function public.broadcast_stats()
returns table (broadcast_id uuid, queued bigint, sent bigint, failed bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    r.broadcast_id,
    count(*) filter (where r.status = 'queued'),
    count(*) filter (where r.status in ('sent', 'delivered', 'read')),
    count(*) filter (where r.status = 'failed')
  from public.broadcast_recipients r
  group by r.broadcast_id
$$;

-- Reserva un lote de destinatarios para enviarlos. Con "skip locked", dos pasadas del trabajador que se superponen no
-- toman los mismos y nadie recibe dos mensajes. Una reserva vieja (la pasada se cortó) se libera sola a los 5 minutos.
create or replace function public.claim_broadcast_recipients(p_broadcast uuid, p_limit integer default 20)
returns table (contact_id uuid, attempts integer)
language sql
security definer
set search_path = ''
as $$
  with picked as (
    select r.broadcast_id, r.contact_id
    from public.broadcast_recipients r
    where r.broadcast_id = p_broadcast
      and r.status = 'queued'
      and (r.claimed_at is null or r.claimed_at < now() - interval '5 minutes')
    order by r.contact_id
    limit greatest(1, least(p_limit, 100))
    for update skip locked
  )
  update public.broadcast_recipients r
  set claimed_at = now()
  from picked
  where r.broadcast_id = picked.broadcast_id and r.contact_id = picked.contact_id
  returning r.contact_id, r.attempts
$$;

revoke all on function public.claim_broadcast_recipients(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_broadcast_recipients(uuid, integer) to service_role;
revoke all on function public.broadcast_audience(uuid, jsonb, integer) from public, anon;
revoke all on function public.broadcast_audience_count(uuid, jsonb) from public, anon;
revoke all on function public.broadcast_stats() from public, anon;
grant execute on function public.broadcast_audience(uuid, jsonb, integer) to authenticated, service_role;
grant execute on function public.broadcast_audience_count(uuid, jsonb) to authenticated, service_role;
grant execute on function public.broadcast_stats() to authenticated;

create index if not exists broadcasts_status_idx on public.broadcasts (status, scheduled_at);
create index if not exists broadcast_recipients_queue_idx on public.broadcast_recipients (broadcast_id, status);
