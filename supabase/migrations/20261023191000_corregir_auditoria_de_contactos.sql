-- Corrección de 20261023190000: v_fields || 'campo' hace que Postgres interprete el texto como un
-- literal de arreglo ("malformed array literal") y el disparador hacía fallar CUALQUIER actualización
-- de contactos, también las de la ingesta de mensajes. Se usa array_append con tipo explícito.

create or replace function private.audit_contact_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields text[] := array[]::text[];
begin
  if new.display_name is distinct from old.display_name then v_fields := array_append(v_fields, 'display_name'::text); end if;
  if new.document_number is distinct from old.document_number then v_fields := array_append(v_fields, 'document_number'::text); end if;
  if new.locality is distinct from old.locality then v_fields := array_append(v_fields, 'locality'::text); end if;
  if new.notes is distinct from old.notes then v_fields := array_append(v_fields, 'notes'::text); end if;
  if new.client_record_id is distinct from old.client_record_id then v_fields := array_append(v_fields, 'client_record_id'::text); end if;
  if new.opted_in_at is distinct from old.opted_in_at then v_fields := array_append(v_fields, 'opted_in_at'::text); end if;
  if new.opted_out_at is distinct from old.opted_out_at then v_fields := array_append(v_fields, 'opted_out_at'::text); end if;

  if cardinality(v_fields) > 0 then
    insert into public.audit_log (organization_id, actor_profile_id, action, entity_type, entity_id, data)
    values (new.organization_id, auth.uid(), 'contact.updated', 'contact', new.id, jsonb_build_object('fields', v_fields));
  end if;

  return new;
end;
$$;
