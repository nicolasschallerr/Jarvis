-- Fase 6, paso 6.14: reinicio de los intentos fallidos.
--
-- Cuando el asociado escribe MENÚ vuelve al principio: los contadores de intentos fallidos del caso
-- abierto se borran. Si no hay un caso abierto no hace nada (no crea uno vacío).

create or replace function public.agent_reset_attempts(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('jarvis.actor', 'agent', true);

  update public.cases
  set collected_data = collected_data - '_reintentos'
  where conversation_id = p_conversation_id
    and status <> 'resolved'
    and collected_data ? '_reintentos';
end;
$$;

revoke all on function public.agent_reset_attempts(uuid) from public, anon, authenticated;
grant execute on function public.agent_reset_attempts(uuid) to service_role;
