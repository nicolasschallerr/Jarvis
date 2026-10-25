-- Auditoría ampliada (ADR-035). Hasta ahora audit_log registraba solo los cambios en contactos y las uniones.
-- Se suman los cambios que hace una persona desde su sesión y que importan para saber "quién hizo qué":
--   - conversaciones: tomar el chat / devolverlo a la IA y asignar;
--   - canales: alta, cambios y baja (nunca el token ni la configuración interna);
--   - agentes: encender, apagar, renombrar;
--   - sectores: quién se suma, se va o pasa a responsable.
-- Lo que se hace con el cliente de servicio (altas de personas, roles, enlaces de acceso, sincronizar plantillas,
-- exportar) lo registra el código con el nombre de quien lo pidió (src/lib/audit/record.ts).
-- El actor es auth.uid(): si el cambio lo hace el servidor (por ejemplo el trabajador) queda sin persona, o sea "Sistema".

create or replace function private.audit_conversation_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ai_enabled is distinct from old.ai_enabled then
    insert into public.audit_log (organization_id, actor_profile_id, action, entity_type, entity_id, data)
    values (new.organization_id, auth.uid(), 'conversation.ai_toggled', 'conversation', new.id, jsonb_build_object('enabled', new.ai_enabled));
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    insert into public.audit_log (organization_id, actor_profile_id, action, entity_type, entity_id, data)
    values (new.organization_id, auth.uid(), 'conversation.assigned', 'conversation', new.id, jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to));
  end if;
  return null;
end;
$$;

create or replace function private.audit_channel_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.channels := case when tg_op = 'DELETE' then old else new end;
begin
  if tg_op = 'UPDATE' and new.name is not distinct from old.name and new.is_active is not distinct from old.is_active and new.external_id is not distinct from old.external_id then
    return null;
  end if;
  insert into public.audit_log (organization_id, actor_profile_id, action, entity_type, entity_id, data)
  values (
    v_row.organization_id, auth.uid(),
    case tg_op when 'INSERT' then 'channel.created' when 'DELETE' then 'channel.deleted' else 'channel.updated' end,
    'channel', v_row.id,
    jsonb_build_object('name', v_row.name, 'type', v_row.type, 'is_active', v_row.is_active)
  );
  return null;
end;
$$;

create or replace function private.audit_agent_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fields text[] := array[]::text[];
begin
  if new.is_enabled is distinct from old.is_enabled then v_fields := array_append(v_fields, 'is_enabled'::text); end if;
  if new.name is distinct from old.name then v_fields := array_append(v_fields, 'name'::text); end if;
  if new.tagline is distinct from old.tagline then v_fields := array_append(v_fields, 'tagline'::text); end if;
  if cardinality(v_fields) > 0 then
    insert into public.audit_log (organization_id, actor_profile_id, action, entity_type, entity_id, data)
    values (new.organization_id, auth.uid(), 'agent.changed', 'agent', new.id, jsonb_build_object('fields', v_fields, 'kind', new.kind, 'is_enabled', new.is_enabled, 'name', new.name));
  end if;
  return null;
end;
$$;

create or replace function private.audit_sector_member_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.sector_members := case when tg_op = 'DELETE' then old else new end;
begin
  if tg_op = 'UPDATE' and new.is_lead is not distinct from old.is_lead then
    return null;
  end if;
  insert into public.audit_log (organization_id, actor_profile_id, action, entity_type, entity_id, data)
  values (
    v_row.organization_id, auth.uid(),
    case tg_op when 'INSERT' then 'sector.member_added' when 'DELETE' then 'sector.member_removed' else 'sector.lead_changed' end,
    'sector', v_row.sector_id,
    jsonb_build_object('profile_id', v_row.profile_id, 'is_lead', v_row.is_lead)
  );
  return null;
end;
$$;

revoke all on function private.audit_conversation_changes() from public, anon, authenticated;
revoke all on function private.audit_channel_changes() from public, anon, authenticated;
revoke all on function private.audit_agent_changes() from public, anon, authenticated;
revoke all on function private.audit_sector_member_changes() from public, anon, authenticated;

create trigger conversations_audit
  after update of ai_enabled, assigned_to on public.conversations
  for each row execute function private.audit_conversation_changes();
create trigger channels_audit
  after insert or update or delete on public.channels
  for each row execute function private.audit_channel_changes();
create trigger agents_audit
  after update of is_enabled, name, tagline on public.agents
  for each row execute function private.audit_agent_changes();
create trigger sector_members_audit
  after insert or update or delete on public.sector_members
  for each row execute function private.audit_sector_member_changes();

-- Para filtrar y paginar la pantalla de auditoría por tipo de acción.
create index if not exists audit_log_action_idx on public.audit_log (organization_id, action, created_at desc);
