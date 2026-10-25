# Fase 12: Unir contactos duplicados

**Estado:** cerrada
**Fechas:** 2026-10-24 (construcción) y 2026-10-25 (ajuste con las columnas protegidas)

## Objetivo
Que la misma persona que escribe por dos canales, o con dos números, deje de ser dos contactos con historiales
separados: poder unirlos sin perder nada, sin romper la facturación por créditos y sin dejar datos a medias.

## Qué se construyó
| Paso | Qué | Dónde |
|------|-----|-------|
| 12.1 | Función de la base `merge_contacts(conservar, absorber)`: corre en una sola transacción, solo la ejecuta un superadmin y lo exige la propia función | `supabase/migrations/20261024170000_unir_contactos.sql` |
| 12.2 | Qué se mueve: identidades, conversaciones, casos, seguimientos y envíos masivos; si hay conversación en el mismo canal, se juntan mensajes, notas y consultas en la del contacto conservado | ídem |
| 12.3 | La ficha se completa sin pisar lo existente; se conservan la baja y el alta de consentimiento más recientes; el contacto absorbido queda vacío y marcado (`merged_into`, `merged_at`) | ídem |
| 12.4 | Las ventanas de crédito del absorbido siguen a su nombre (historial de facturación); queda registro en `audit_log` (`contact.merged`) | ídem |
| 12.5 | Detección de posibles duplicados por documento igual y pantalla de unión con confirmación explícita, solo para el superadmin | `src/lib/crm/contact-merge.ts`, `conversaciones/[id]/duplicate-contacts.tsx` |
| 12.6 | El directorio de contactos y la ficha excluyen a los contactos ya unidos | `src/lib/crm/contact-directory.ts` |
| 12.7 | Pruebas: 10 casos (unión entre canales y en el mismo canal, caso abierto en conflicto, permisos, otra organización, duplicados) | `tests/contact-merge.test.ts` |

Decisiones: ADR-024.

## Problemas encontrados y cómo se resolvieron
- **Las columnas protegidas bloquearon la unión.** Al endurecer las tablas (ADR-027) el disparador no distinguía entre una
  persona editando directamente y una función de la base que corre en su nombre: 6 pruebas fallaron. Se resolvió haciendo
  que el guardia solo actúe cuando la sentencia corre como el usuario de la sesión (lección 47).
- **Dos conversaciones del mismo canal con caso abierto:** no se pueden unir sin decidir cuál sigue; se exige resolver una
  antes y no se cambia nada.

## Tiempo invertido
[COMPLETAR]

## Qué haría distinto la próxima vez
Correr la suite completa justo después de agregar cada disparador de protección: las pruebas de una función lejana fueron
las que mostraron el problema, y recién aparecieron al día siguiente.

## Deuda técnica pendiente
- Una unión equivocada **no se puede deshacer**: por eso solo la hace el superadmin y pide confirmar.
- Solo se proponen duplicados por documento igual; no hay detección por otros datos que confirme el cliente.
- La unión se hace desde la ficha de una conversación; falta ofrecerla desde la página del contacto.
- El historial de uniones está en `audit_log` pero todavía no hay pantalla para verlo (queda para la auditoría completa).
