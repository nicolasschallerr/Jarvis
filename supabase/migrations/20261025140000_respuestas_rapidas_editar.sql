-- Renombrar y corregir respuestas rápidas: lo pueden hacer el superadmin y los operadores, solo dentro de su
-- organización (la política repite la condición de rol en USING y en WITH CHECK, lección 27).

create policy quick_replies_update on public.quick_replies
  for update to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'operator')
  )
  with check (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'operator')
  );

-- Quién la creó y de qué organización es no cambian.
create or replace function private.quick_replies_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'Solo se puede cambiar el título y el texto';
  end if;
  return new;
end;
$$;

revoke all on function private.quick_replies_guard() from public, anon, authenticated;

create trigger quick_replies_guard
  before update on public.quick_replies
  for each row execute function private.quick_replies_guard();
