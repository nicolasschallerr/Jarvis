-- Borrar una organización con canales o integrantes de sector fallaba: al borrarla en cascada, los disparadores de
-- auditoría de canales y de integrantes de sector (ADR-035) intentaban registrar "canal borrado" / "integrante
-- quitado" con el id de una organización que ya no existía, y la clave foránea de audit_log lo rechazaba.
-- Cuando la organización ya no existe no hay a quién auditar: se omite el registro.

create or replace function private.audit_channel_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.channels := case when tg_op = 'DELETE' then old else new end;
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations where id = v_row.organization_id) then
    return null;
  end if;
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

create or replace function private.audit_sector_member_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.sector_members := case when tg_op = 'DELETE' then old else new end;
begin
  if tg_op = 'DELETE' and not exists (select 1 from public.organizations where id = v_row.organization_id) then
    return null;
  end if;
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
