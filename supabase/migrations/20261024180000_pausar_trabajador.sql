-- Pausar el trabajador mientras corren las pruebas.
--
-- El trabajador de mensajes lo dispara pg_cron cada 10 segundos y comparte la base con las pruebas: a veces toma
-- un evento de prueba antes que la prueba y esta falla sin que haya un error real (lecciones 19 y 31). Esta
-- función enciende o apaga ese trabajo. La suite de pruebas lo apaga al empezar y lo vuelve a dejar como estaba
-- al terminar.
--
-- set_worker_active(true | false)  cambia el estado y devuelve cómo estaba antes.
-- set_worker_active(null)          solo informa el estado actual.
-- Solo la puede llamar el servidor (clave de servicio).

create or replace function public.set_worker_active(p_active boolean default null)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job_id bigint;
  v_was_active boolean;
begin
  select jobid, active into v_job_id, v_was_active from cron.job where jobname = 'jarvis-worker-messages';
  if v_job_id is null then
    -- Sin trabajo programado no hay nada que pausar.
    return false;
  end if;

  if p_active is not null and p_active is distinct from v_was_active then
    perform cron.alter_job(v_job_id, active => p_active);
  end if;

  return v_was_active;
end;
$$;

revoke all on function public.set_worker_active(boolean) from public, anon, authenticated;
grant execute on function public.set_worker_active(boolean) to service_role;
