-- Fase 11, paso 11.1: consumo por día (créditos y uso de IA).
--
-- Una fila por día, en la zona horaria de la organización, con:
--   - los créditos: ventanas de 24 h abiertas ese día (ADR-010), y cuántas inició el asociado o la organización;
--   - la IA: llamadas al modelo, errores, tokens y costo (solo de las llamadas que lo tienen).
-- La función corre con los permisos de quien la llama (security invoker): cada persona ve solo lo que RLS le
-- permite. Las ventanas las ve toda la organización; las llamadas a IA, solo superadmin y consulta y reportes.

create or replace function public.consumption_by_day(p_from date, p_to date)
returns table (
  day date,
  credits integer,
  windows integer,
  windows_by_contact integer,
  windows_by_business integer,
  ai_calls integer,
  ai_errors integer,
  input_tokens bigint,
  output_tokens bigint,
  cost_usd numeric,
  calls_without_cost integer
)
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
  days as (
    select d::date as day from generate_series(p_from, p_to, interval '1 day') as d
  ),
  w as (
    select
      (opened_at at time zone (select name from tz))::date as day,
      sum(credits)::integer as credits,
      count(*)::integer as windows,
      (count(*) filter (where initiated_by = 'contact'))::integer as by_contact,
      (count(*) filter (where initiated_by = 'business'))::integer as by_business
    from public.conversation_windows
    where opened_at >= (select from_ts from bounds) and opened_at < (select to_ts from bounds)
    group by 1
  ),
  a as (
    select
      (created_at at time zone (select name from tz))::date as day,
      (count(*) filter (where error is null))::integer as calls,
      (count(*) filter (where error is not null))::integer as errors,
      coalesce(sum(input_tokens) filter (where error is null), 0)::bigint as input_tokens,
      coalesce(sum(output_tokens) filter (where error is null), 0)::bigint as output_tokens,
      coalesce(sum(cost_usd) filter (where error is null), 0) as cost_usd,
      (count(*) filter (where error is null and cost_usd is null))::integer as without_cost
    from public.ai_calls
    where created_at >= (select from_ts from bounds) and created_at < (select to_ts from bounds)
    group by 1
  )
  select
    days.day,
    coalesce(w.credits, 0),
    coalesce(w.windows, 0),
    coalesce(w.by_contact, 0),
    coalesce(w.by_business, 0),
    coalesce(a.calls, 0),
    coalesce(a.errors, 0),
    coalesce(a.input_tokens, 0),
    coalesce(a.output_tokens, 0),
    coalesce(a.cost_usd, 0),
    coalesce(a.without_cost, 0)
  from days
  left join w on w.day = days.day
  left join a on a.day = days.day
  where p_to >= p_from and p_to - p_from <= 92
  order by days.day
$$;

revoke all on function public.consumption_by_day(date, date) from public, anon;
grant execute on function public.consumption_by_day(date, date) to authenticated;
