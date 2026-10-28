-- El Asistente como agente visible (ADR-050): una fila por organización para que aparezca en Agentes y en el Panorama
-- con su nombre y su frase. Está siempre encendido: la regla de la tabla no deja apagarlo.

insert into public.agents (organization_id, kind, name, tagline, is_enabled)
select o.id, 'assistant', 'Asistente', 'Preguntame lo que quieras sobre la empresa: busco el dato y te lo explico.', true
from public.organizations o
on conflict (organization_id, kind) do update set is_enabled = true;

alter table public.agents
  add constraint agents_assistant_always_on check (kind <> 'assistant' or is_enabled);

create or replace function private.create_assistant_agent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.agents (organization_id, kind, name, tagline, is_enabled)
  values (new.id, 'assistant', 'Asistente', 'Preguntame lo que quieras sobre la empresa: busco el dato y te lo explico.', true)
  on conflict (organization_id, kind) do nothing;
  return new;
end;
$$;

revoke all on function private.create_assistant_agent() from public, anon, authenticated;

create trigger organizations_create_assistant_agent
  after insert on public.organizations
  for each row execute function private.create_assistant_agent();
