-- Stock que el CRM lee solo (ADR-047).
--
-- 1) Las fuentes se identifican por nombre dentro de la organización: así la configuración del cliente las da de alta o
--    las cambia sin duplicarlas.
-- 2) pg_cron llama cada 10 minutos al trabajador de stock (/api/worker/catalog), con la misma URL y el mismo secreto del
--    trabajador de mensajes, guardados en Vault (ver 20261023110000_programar_trabajador.sql).

-- Si hubiera dos fuentes con el mismo nombre (cargadas a mano antes de esto), se renombra la más nueva.
update public.catalog_sources s
set name = left(s.name, 70) || ' (' || left(s.id::text, 8) || ')'
where exists (
  select 1 from public.catalog_sources o
  where o.organization_id = s.organization_id and o.name = s.name and o.created_at < s.created_at
);

alter table public.catalog_sources
  add constraint catalog_sources_org_name_key unique (organization_id, name);

create or replace function private.invoke_catalog_worker()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  -- Sin fuentes que leer no se despierta a la aplicación.
  if not exists (select 1 from public.catalog_sources where kind in ('sheet', 'web', 'supabase') and sync_every_hours is not null) then
    return;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'jarvis_app_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'jarvis_worker_secret';
  if v_url is null or v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := rtrim(v_url, '/') || '/api/worker/catalog',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 290000
  );
end;
$$;

revoke all on function private.invoke_catalog_worker() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'orbita-worker-catalog') then
    perform cron.unschedule('orbita-worker-catalog');
  end if;
end;
$$;

select cron.schedule('orbita-worker-catalog', '*/10 * * * *', $$ select private.invoke_catalog_worker(); $$);
