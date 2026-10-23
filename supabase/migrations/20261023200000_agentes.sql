-- Etapa 2 del rediseño: los agentes como "compañeros de equipo" visibles en el CRM.
--
-- Una fila por agente y organización: cómo se llama, su frase y su estado en vivo. Es aparte de
-- agent_configs, que guarda los prompts versionados del motor (Fase 6). El estado lo va a escribir el
-- servidor cuando los agentes trabajen; hasta entonces todos figuran "en pausa" y desactivados.

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind public.agent_kind not null,
  name text not null check (char_length(name) between 1 and 40),
  tagline text check (tagline is null or char_length(tagline) <= 140),
  status text not null default 'paused' check (status in ('paused', 'working', 'waiting_approval')),
  is_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, kind)
);

create index agents_organization_id_idx on public.agents (organization_id);

create trigger agents_set_updated_at
  before update on public.agents
  for each row execute function private.set_updated_at();

alter table public.agents enable row level security;

-- Todos los de la organización ven a los agentes.
create policy agents_select on public.agents
  for select to authenticated
  using (organization_id = (select private.current_org_id()));

-- Cambiar un agente (nombre, frase, encenderlo) es del superadmin. La condición de rol va en USING y
-- también en WITH CHECK: para los INSERT solo cuenta WITH CHECK (ver la corrección de políticas ALL).
create policy agents_write on public.agents
  for all to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  )
  with check (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  );

-- Para que el estado de los agentes se vea en vivo.
alter publication supabase_realtime add table public.agents;
