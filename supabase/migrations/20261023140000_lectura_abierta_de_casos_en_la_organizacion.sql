-- Fase 5, paso 5.0 (ADR-016): todos los usuarios de una organización pueden LEER todos los casos,
-- sin importar el sector. Antes un operador solo veía los casos asignados a él o de sus sectores.
--
-- Las tablas hijas (case_events, case_tags, followups, area_queries, internal_notes) heredan la
-- visibilidad con una subconsulta sobre cases, así que cambia solo esta política. Conversaciones y
-- mensajes ya se leían por organización.
--
-- Escribir NO cambia: modificar un caso sigue limitado al superadmin, al asignado y a los miembros
-- del sector (política cases_update).

drop policy if exists cases_select on public.cases;

create policy cases_select on public.cases
  for select to authenticated
  using (organization_id = (select private.current_org_id()));
