-- Reportes de gestión (ADR-037): una sola función que resume un período para el panel de Reportes.
--
-- Corre con los permisos de quien la llama ("security invoker"): RLS limita todo a su organización. El período se
-- cuenta en la zona horaria de la organización y no puede pasar de 92 días.
--
-- Primera respuesta: un "turno" empieza con un mensaje del contacto cuando el mensaje anterior de esa conversación fue
-- nuestro (o no había ninguno). Su respuesta es el primer mensaje saliente que le sigue. Se mide por separado cuando
-- respondió el agente y cuando respondió una persona. Los turnos sin respuesta quedan aparte (siguen esperando).

create or replace function public.report_summary(p_from date, p_to date)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with tz as (
    select coalesce(
      (select timezone from public.organizations where id = (select private.current_org_id())),
      'America/Argentina/Buenos_Aires'
    ) as name
  ),
  bounds as (
    select
      (p_from::timestamp at time zone (select name from tz)) as from_ts,
      ((p_to + 1)::timestamp at time zone (select name from tz)) as to_ts
  ),
  turns as (
    select
      m.id,
      m.provider_timestamp as asked_at,
      r.provider_timestamp as answered_at,
      r.sender as answered_by
    from public.messages m
    left join lateral (
      select p.direction
      from public.messages p
      where p.conversation_id = m.conversation_id
        and p.status <> 'failed'
        and (p.provider_timestamp, p.created_at) < (m.provider_timestamp, m.created_at)
      order by p.provider_timestamp desc, p.created_at desc
      limit 1
    ) pv on true
    left join lateral (
      select o.provider_timestamp, o.sender
      from public.messages o
      where o.conversation_id = m.conversation_id
        and o.direction = 'outbound'
        and o.status <> 'failed'
        and (o.provider_timestamp, o.created_at) > (m.provider_timestamp, m.created_at)
      order by o.provider_timestamp, o.created_at
      limit 1
    ) r on true
    where m.direction = 'inbound'
      and m.status <> 'failed'
      and m.provider_timestamp >= (select from_ts from bounds)
      and m.provider_timestamp < (select to_ts from bounds)
      and (pv.direction is null or pv.direction = 'outbound')
  ),
  answered as (
    select extract(epoch from (answered_at - asked_at)) as seconds, answered_by from turns where answered_at is not null
  ),
  msgs as (
    select
      count(*) filter (where direction = 'inbound') as inbound,
      count(*) filter (where direction = 'outbound' and sender = 'agent') as out_agent,
      count(*) filter (where direction = 'outbound' and sender = 'operator') as out_operator
    from public.messages
    where status <> 'failed'
      and provider_timestamp >= (select from_ts from bounds) and provider_timestamp < (select to_ts from bounds)
  ),
  convs as (
    select count(*) as created
    from public.conversations
    where created_at >= (select from_ts from bounds) and created_at < (select to_ts from bounds)
  ),
  cases_period as (
    select
      count(*) filter (where opened_at >= (select from_ts from bounds) and opened_at < (select to_ts from bounds)) as created,
      count(*) filter (where resolved_at >= (select from_ts from bounds) and resolved_at < (select to_ts from bounds)) as resolved,
      percentile_cont(0.5) within group (order by extract(epoch from (resolved_at - opened_at)) / 3600)
        filter (where resolved_at >= (select from_ts from bounds) and resolved_at < (select to_ts from bounds)) as resolution_median_hours
    from public.cases
  ),
  days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') as d
  ),
  daily as (
    select
      days.day,
      (select count(*) from public.messages m
        where m.direction = 'inbound' and m.status <> 'failed'
          and (m.provider_timestamp at time zone (select name from tz))::date = days.day) as inbound,
      (select count(*) from public.messages m
        where m.direction = 'outbound' and m.status <> 'failed'
          and (m.provider_timestamp at time zone (select name from tz))::date = days.day) as outbound,
      (select count(*) from public.cases c where (c.opened_at at time zone (select name from tz))::date = days.day) as cases_created,
      (select count(*) from public.cases c where (c.resolved_at at time zone (select name from tz))::date = days.day) as cases_resolved
    from days
  )
  select case when p_to < p_from or p_to - p_from > 92 then null else jsonb_build_object(
    'conversations_new', (select created from convs),
    'messages_in', (select inbound from msgs),
    'messages_out_agent', (select out_agent from msgs),
    'messages_out_operator', (select out_operator from msgs),
    'turns_total', (select count(*) from turns),
    'turns_answered', (select count(*) from answered),
    'response_median_seconds', (select percentile_cont(0.5) within group (order by seconds) from answered),
    'response_p90_seconds', (select percentile_cont(0.9) within group (order by seconds) from answered),
    'response_median_seconds_agent', (select percentile_cont(0.5) within group (order by seconds) from answered where answered_by = 'agent'),
    'response_median_seconds_operator', (select percentile_cont(0.5) within group (order by seconds) from answered where answered_by = 'operator'),
    'answered_by_agent', (select count(*) from answered where answered_by = 'agent'),
    'answered_by_operator', (select count(*) from answered where answered_by = 'operator'),
    'cases_created', (select created from cases_period),
    'cases_resolved', (select resolved from cases_period),
    'resolution_median_hours', (select resolution_median_hours from cases_period),
    'open_by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) as n from public.cases where status <> 'resolved' group by status) s), '{}'::jsonb),
    'open_by_sector', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(sc.name, 'Sin sector'), 'count', n) order by n desc)
      from (select sector_id, count(*) as n from public.cases where status <> 'resolved' group by sector_id) o
      left join public.sectors sc on sc.id = o.sector_id
    ), '[]'::jsonb),
    'open_by_assignee', coalesce((
      select jsonb_agg(jsonb_build_object('name', coalesce(pr.full_name, 'Sin asignar'), 'count', n) order by n desc)
      from (select assigned_to, count(*) as n from public.cases where status <> 'resolved' group by assigned_to) o
      left join public.profiles pr on pr.id = o.assigned_to
    ), '[]'::jsonb),
    'daily', (select jsonb_agg(jsonb_build_object('day', day, 'inbound', inbound, 'outbound', outbound, 'cases_created', cases_created, 'cases_resolved', cases_resolved) order by day) from daily)
  ) end
$$;

revoke all on function public.report_summary(date, date) from public, anon;
grant execute on function public.report_summary(date, date) to authenticated;
