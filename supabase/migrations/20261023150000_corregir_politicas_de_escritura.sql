-- CORRECCIÓN DE SEGURIDAD (Fase 5): las políticas de escritura de tipo ALL tenían un WITH CHECK
-- explícito que solo comprobaba la organización. Para los INSERT, Postgres evalúa únicamente el
-- WITH CHECK (USING no se aplica a filas nuevas), así que cualquier usuario de la organización,
-- también un operador o de solo consulta, podía insertar filas aunque USING exigiera superadmin.
-- Afectaba a: business_units, case_tags, channels, sector_members, sectors y tags.
--
-- Ahora cada política repite la condición de rol en USING y en WITH CHECK.
-- Las políticas de UPDATE no estaban afectadas: para actualizar se evalúan USING (fila vieja) y
-- WITH CHECK (fila nueva), y USING ya exigía el rol.

drop policy if exists business_units_write on public.business_units;
create policy business_units_write on public.business_units
  for all to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  )
  with check (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  );

drop policy if exists channels_write on public.channels;
create policy channels_write on public.channels
  for all to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  )
  with check (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  );

drop policy if exists sector_members_write on public.sector_members;
create policy sector_members_write on public.sector_members
  for all to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  )
  with check (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  );

drop policy if exists sectors_write on public.sectors;
create policy sectors_write on public.sectors
  for all to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  )
  with check (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  );

drop policy if exists tags_write on public.tags;
create policy tags_write on public.tags
  for all to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'operator')
  )
  with check (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'operator')
  );

drop policy if exists case_tags_write on public.case_tags;
create policy case_tags_write on public.case_tags
  for all to authenticated
  using (
    exists (select 1 from public.cases c where c.id = case_tags.case_id)
    and (select private.current_user_role()) in ('superadmin', 'operator')
  )
  with check (
    organization_id = (select private.current_org_id())
    and exists (select 1 from public.cases c where c.id = case_tags.case_id)
    and (select private.current_user_role()) in ('superadmin', 'operator')
  );
