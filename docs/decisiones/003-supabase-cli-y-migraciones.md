# ADR-003: Supabase en la nube + CLI con migraciones versionadas (sin Docker por ahora)

**Estado:** aceptada (2026-10-20)

## Contexto

El desarrollo es en Windows. Correr Supabase en local requiere Docker Desktop, que agrega
complejidad. El proyecto de Supabase se creó con una cuenta distinta a la conectada al
asistente de IA, así que el conector MCP no tiene acceso a ese proyecto.

## Decisión

- Se trabaja directo contra un proyecto Supabase en la nube (`jarvis-dev`, región São Paulo).
- La Supabase CLI se instala como dependencia de desarrollo del repo (versión fija para cualquiera que clone).
- Todo cambio de esquema es una **migración SQL versionada** en `supabase/migrations/`, aplicada con la CLI.
- El conector MCP de Supabase es opcional: se puede sumar si el debug de RLS se vuelve lento por ida y vuelta.

## Alternativas descartadas

- **Supabase local con Docker:** más fiel para testear, pero agrega instalación y consumo de
  recursos. Se reevalúa en la Fase 13.
- **Cambios desde el panel web sin migraciones:** no quedan versionados ni son reproducibles.

## Consecuencias

- El esquema es reproducible desde el repo.
- Se prueba contra la nube: hay que cuidar no romper datos de desarrollo.
- El plan gratuito tiene límites (pausa por inactividad, sin backups diarios); producción requiere plan pago.
