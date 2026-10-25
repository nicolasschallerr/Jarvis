-- Conteos del Inicio y de la bandeja en una sola consulta cada uno (ADR-034).
--
-- Antes eran 4 consultas en el Inicio y 5 en la bandeja, cada una un viaje a la base. Ahora es una. Las funciones son
-- "security invoker": corren con los permisos de quien las llama, así que RLS limita todo a su organización igual que
-- antes (la vista conversation_summaries también es security invoker).

create or replace function public.home_counts(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'awaiting', (select count(*) from public.conversation_summaries where last_direction = 'inbound'),
    'mine', (select count(*) from public.cases where status <> 'resolved' and assigned_to = p_user_id),
    'unassigned', (select count(*) from public.cases where status <> 'resolved' and assigned_to is null),
    'urgent', (select count(*) from public.cases where status <> 'resolved' and priority = 'urgent')
  )
$$;

create or replace function public.inbox_counts(p_user_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'todas', count(*),
    'esperando', count(*) filter (where last_direction = 'inbound'),
    'mias', count(*) filter (where assigned_to = p_user_id or case_assigned_to = p_user_id),
    'sin-asignar', count(*) filter (where assigned_to is null and case_assigned_to is null),
    'ia-pausada', count(*) filter (where not ai_enabled)
  )
  from public.conversation_summaries
$$;

revoke all on function public.home_counts(uuid) from public, anon;
revoke all on function public.inbox_counts(uuid) from public, anon;
grant execute on function public.home_counts(uuid) to authenticated;
grant execute on function public.inbox_counts(uuid) to authenticated;
