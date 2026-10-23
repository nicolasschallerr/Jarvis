-- Fase 5, paso 5.6: ficha del asociado. Cada cambio en los datos de un contacto queda en audit_log.
--
-- Se guarda QUÉ campos cambiaron, no sus valores: el documento, el nombre y las notas son datos
-- personales y no conviene duplicarlos en un registro que vive más tiempo. El actor sale de la sesión
-- (null cuando lo hace un proceso del servidor, por ejemplo al actualizar el nombre desde un canal).
-- Lo escribe un disparador para que ninguna pantalla ni proceso pueda olvidarse de auditar.

create or replace function private.audit_contact_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields text[] := array[]::text[];
begin
  if new.display_name is distinct from old.display_name then v_fields := v_fields || 'display_name'; end if;
  if new.document_number is distinct from old.document_number then v_fields := v_fields || 'document_number'; end if;
  if new.locality is distinct from old.locality then v_fields := v_fields || 'locality'; end if;
  if new.notes is distinct from old.notes then v_fields := v_fields || 'notes'; end if;
  if new.client_record_id is distinct from old.client_record_id then v_fields := v_fields || 'client_record_id'; end if;
  if new.opted_in_at is distinct from old.opted_in_at then v_fields := v_fields || 'opted_in_at'; end if;
  if new.opted_out_at is distinct from old.opted_out_at then v_fields := v_fields || 'opted_out_at'; end if;

  if cardinality(v_fields) > 0 then
    insert into public.audit_log (organization_id, actor_profile_id, action, entity_type, entity_id, data)
    values (new.organization_id, auth.uid(), 'contact.updated', 'contact', new.id, jsonb_build_object('fields', v_fields));
  end if;

  return new;
end;
$$;

revoke all on function private.audit_contact_changes() from public, anon, authenticated;

create trigger contacts_audit_changes
  after update on public.contacts
  for each row execute function private.audit_contact_changes();
