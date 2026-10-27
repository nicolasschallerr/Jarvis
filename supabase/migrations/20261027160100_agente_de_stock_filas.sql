-- Una fila de agente de stock por organización (ADR-046).
--
-- Encendido o apagado decide si el agente de atención consulta el catálogo. Las organizaciones que ya lo usaban
-- (catálogo cargado o activado en su configuración) lo reciben encendido, así nada cambia para ellas; el resto, apagado.

insert into public.agents (organization_id, kind, name, tagline, is_enabled)
select
  o.id,
  'stock',
  'Stock',
  'Reviso el stock para responder con datos reales.',
  exists (select 1 from public.catalog_items c where c.organization_id = o.id)
    or exists (
      select 1
      from public.agent_configs a
      where a.organization_id = o.id
        and a.kind = 'attention'
        and a.is_active
        and coalesce((a.settings -> 'catalog' ->> 'enabled')::boolean, false)
    )
from public.organizations o
on conflict (organization_id, kind) do nothing;

-- Las organizaciones nuevas nacen con su agente de stock (apagado), igual que el resto lo configura el superadmin.
create or replace function private.create_stock_agent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.agents (organization_id, kind, name, tagline)
  values (new.id, 'stock', 'Stock', 'Reviso el stock para responder con datos reales.')
  on conflict (organization_id, kind) do nothing;
  return new;
end;
$$;

revoke all on function private.create_stock_agent() from public, anon, authenticated;

create trigger organizations_create_stock_agent
  after insert on public.organizations
  for each row execute function private.create_stock_agent();
