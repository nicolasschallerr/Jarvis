-- Respuestas rápidas: textos que el equipo guarda para reusar al contestar a mano (ADR-028).
-- Leen todos los de la organización; crean y borran el superadmin y los operadores. Cada política repite el rol en
-- USING y en WITH CHECK (lección 27).

create table public.quick_replies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  body text not null check (char_length(body) between 1 and 4000),
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index quick_replies_organization_id_idx on public.quick_replies (organization_id, title);

alter table public.quick_replies enable row level security;

create policy quick_replies_select on public.quick_replies
  for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy quick_replies_insert on public.quick_replies
  for insert to authenticated
  with check (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'operator')
  );

create policy quick_replies_delete on public.quick_replies
  for delete to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'operator')
  );
