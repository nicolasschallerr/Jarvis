-- Límites de consumo y alertas (ADR-036, cierra lo pendiente de la Fase 11).
--
-- Cada organización puede fijar un tope mensual de créditos y/o de costo estimado de IA, y a qué porcentaje se avisa.
-- Es informativo: no corta al agente (cortarlo es una decisión de negocio que se toma con el cliente). El trabajador
-- revisa el consumo y avisa a los superadmins una sola vez al cruzar el umbral y otra al superar el límite.

alter table public.organizations
  add column monthly_credit_limit integer check (monthly_credit_limit is null or monthly_credit_limit > 0),
  add column monthly_cost_limit_usd numeric check (monthly_cost_limit_usd is null or monthly_cost_limit_usd > 0),
  add column usage_alert_percent integer not null default 80 check (usage_alert_percent between 1 and 100),
  -- Control de avisos: en qué mes y hasta qué nivel ya se avisó, y cuándo se revisó por última vez.
  add column usage_alert_month text,
  add column usage_alert_level text check (usage_alert_level is null or usage_alert_level in ('warning', 'exceeded')),
  add column usage_checked_at timestamptz;

-- Consumo de un mes de una organización (el mes se cuenta en la zona horaria de la organización). Solo la usa el
-- servidor: va con la clave de servicio, así que no se le da permiso a las personas.
create or replace function public.org_month_usage(p_org uuid, p_month date)
returns table (credits integer, cost_usd numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with tz as (
    select coalesce((select timezone from public.organizations where id = p_org), 'America/Argentina/Buenos_Aires') as name
  ),
  bounds as (
    select
      (date_trunc('month', p_month)::timestamp at time zone (select name from tz)) as from_ts,
      ((date_trunc('month', p_month) + interval '1 month')::timestamp at time zone (select name from tz)) as to_ts
  )
  select
    coalesce((
      select sum(w.credits)::integer from public.conversation_windows w
      where w.organization_id = p_org
        and w.opened_at >= (select from_ts from bounds) and w.opened_at < (select to_ts from bounds)
    ), 0),
    coalesce((
      select sum(a.cost_usd) from public.ai_calls a
      where a.organization_id = p_org and a.error is null
        and a.created_at >= (select from_ts from bounds) and a.created_at < (select to_ts from bounds)
    ), 0)
$$;

revoke all on function public.org_month_usage(uuid, date) from public, anon, authenticated;
grant execute on function public.org_month_usage(uuid, date) to service_role;
