-- Fase 3, paso 3.6: que el trabajador de mensajes corra solo.
-- pg_cron invoca cada pocos segundos a una función que llama (con pg_net) a la ruta
-- /api/worker/messages de la aplicación. La URL y el secreto del trabajador NO están en este
-- archivo: se guardan en Supabase Vault y se leen en el momento de cada llamada.
--
-- Secretos que hay que crear una vez en Vault (SQL Editor de Supabase):
--   select vault.create_secret('https://TU-DOMINIO.vercel.app', 'jarvis_app_url');
--   select vault.create_secret('EL-MISMO-VALOR-DE-WORKER_SECRET', 'jarvis_worker_secret');

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Llama al trabajador. Si todavía no están los secretos, no hace nada (no llena el registro de errores).
create or replace function private.invoke_message_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'jarvis_app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'jarvis_worker_secret';

  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/worker/messages',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 25000
  );
end;
$$;

revoke all on function private.invoke_message_worker() from public, anon, authenticated;

-- Reprograma el trabajo sin duplicarlo si la migración se repite.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'jarvis-worker-messages') then
    perform cron.unschedule('jarvis-worker-messages');
  end if;
end;
$$;

select cron.schedule(
  'jarvis-worker-messages',
  '10 seconds',
  $$ select private.invoke_message_worker(); $$
);
