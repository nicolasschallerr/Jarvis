-- Fase 5, paso 5.5: notas internas.
--
-- 1) La política de alta comprobaba organización, autor y rol, pero no que la conversación o el caso al
--    que apunta la nota existan para quien escribe. Con los ids de otra organización se podía crear una
--    nota que los referenciara (y averiguar si existían). Ahora el WITH CHECK exige que se puedan ver:
--    las subconsultas respetan RLS, así que solo "ven" lo de la propia organización.
--
-- 2) Sin políticas de UPDATE ni DELETE: las notas no se editan ni se borran desde el CRM (queda el
--    rastro de lo que se anotó). Solo desaparecen en cascada si se borra la conversación o el caso.
--
-- 3) Las notas entran a Realtime para que el equipo las vea sin recargar.

drop policy if exists internal_notes_insert on public.internal_notes;

create policy internal_notes_insert on public.internal_notes
  for insert to authenticated
  with check (
    organization_id = (select private.current_org_id())
    and author_id = (select auth.uid())
    and (select private.current_user_role()) in ('superadmin', 'operator')
    and (
      conversation_id is null
      or exists (select 1 from public.conversations c where c.id = internal_notes.conversation_id)
    )
    and (
      case_id is null
      or exists (select 1 from public.cases cs where cs.id = internal_notes.case_id)
    )
  );

alter publication supabase_realtime add table public.internal_notes;
