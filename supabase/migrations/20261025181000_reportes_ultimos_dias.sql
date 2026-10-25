-- Reporte de los últimos N días: calcula "hoy" en la zona horaria de la organización y devuelve también el período, así
-- la pantalla necesita un solo viaje a la base (ADR-034).

create or replace function public.report_last_days(p_days integer)
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
  range as (
    select
      ((now() at time zone (select name from tz))::date - (greatest(1, least(p_days, 90)) - 1)) as from_day,
      (now() at time zone (select name from tz))::date as to_day
  )
  select public.report_summary((select from_day from range), (select to_day from range))
         || jsonb_build_object('from', (select from_day from range), 'to', (select to_day from range))
$$;

revoke all on function public.report_last_days(integer) from public, anon;
grant execute on function public.report_last_days(integer) to authenticated;
