# ADR-017: Historial de casos y auditoría de contactos con disparadores en la base

**Estado:** aceptada (2026-10-23). Complementa el ADR-009 y el ADR-016.

## Contexto
Cada cambio de un caso (estado, prioridad, sector, asignación) y cada edición de datos personales de un
contacto tiene que dejar rastro. Los usuarios del CRM no tienen permiso de escritura sobre `case_events` ni
sobre `audit_log` (solo el servidor escribe ahí), y los cambios pueden venir de la pantalla, de un proceso
del servidor o, más adelante, del agente.

## Decisión
- **Disparadores `SECURITY DEFINER`** escriben el rastro dentro de la misma transacción del cambio:
  - `cases`: `private.log_case_events()` registra alta y cambios de estado, prioridad, sector y asignación
    en `case_events`; `private.cases_sync_resolved_at()` mantiene `resolved_at` (se completa al resolver y
    se borra al reabrir).
  - `contacts`: `private.audit_contact_changes()` registra en `audit_log` **qué campos** cambiaron, sin
    sus valores (nombre, documento, localidad y notas son datos personales).
- **El actor sale de la sesión** (`auth.uid()`): una persona del CRM queda como `operator`; un proceso del
  servidor, sin usuario, como `system` (y sin actor en la auditoría).
- **Un solo caso abierto por conversación**, con un índice único parcial
  (`cases_one_open_per_conversation`). El agente se va a apoyar en esta regla.
- Las notas internas no se editan ni se borran desde el CRM (sin políticas de `UPDATE` ni `DELETE`), y su
  alta exige que la conversación y el caso existan para quien escribe.

## Alternativas descartadas
- Escribir el historial desde el código de cada pantalla: cualquier camino nuevo (el agente, un script) podría
  olvidarse de auditar, y la acción de servidor tendría que usar la clave de servicio solo para eso.
- Guardar los valores anteriores y nuevos de los datos personales en la auditoría: duplica datos que viven más
  tiempo que la ficha y complica el derecho de supresión (Ley 25.326).
- Un historial genérico con `to_jsonb(old)` y `to_jsonb(new)`: más fácil de escribir, pero filtra datos
  personales y es difícil de mostrar al usuario.

## Consecuencias
- El historial no puede quedar a medias ni olvidarse: o se guarda con el cambio o el cambio falla.
- Un error dentro de un disparador bloquea la escritura que lo dispara. Pasó una vez (ver lección 28): todo
  disparador nuevo se prueba por **cada** camino de escritura.
- El actor "agente" todavía no se distingue de "sistema"; se agrega con el motor de la Fase 6 (por ejemplo,
  con un valor de sesión que el servidor fije antes de escribir).
- `audit_log` cubre hoy solo contactos; otras entidades sensibles se suman cuando haga falta.
