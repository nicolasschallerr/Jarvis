# Fase 1: Arquitectura y modelo de datos

**Estado:** cerrada
**Fechas:** 2026-10-21

## Objetivo

Decidir cómo se conectan las piezas de Jarvis y dejar creado el esquema completo de la base,
con aislamiento por organización, antes de escribir lógica.

## Qué se construyó

| Paso | Resultado | Archivos / commits |
|---|---|---|
| 1.1 | Decisiones: cola y trabajos (pgmq + pg_cron + trabajador en Next.js), modelos de IA y transcripción | ADR-007, ADR-008 (`b026f5f`) |
| 1.2 | Diagrama de componentes y cuatro flujos principales | `docs/arquitectura.md` (`be1877d`) |
| 1.3 | Organizaciones, perfiles, canales, contactos | migración `20261021120000_...` (`85d8c7e`) |
| 1.4 | Conversaciones, mensajes, multimedia, webhooks, créditos | migración `20261021130000_...` (`b5c8a87`) |
| 1.5 | Sectores, casos, etiquetas, notas, consultas al área, notificaciones | migración `20261021140000_...` (`1b2b94d`) |
| 1.6 | Agentes, trazabilidad de IA, seguimientos, plantillas, evaluaciones, auditoría | migración `20261021150000_...` (`e99d2ab`) |
| 1.7 | Las 4 migraciones aplicadas a `jarvis-dev` con `supabase db push` | — |
| 1.8 | Diccionario de datos, ADR-009 y ADR-010, esta bitácora | `docs/diccionario-de-datos.md` |

29 tablas, todas con `organization_id` y RLS.

## Cómo se resolvió

1. Primero las decisiones que condicionan el esquema (cola, IA), verificadas en la documentación de Supabase y Vercel.
2. Diagrama y flujos antes de las tablas, para saber qué tenía que guardar cada flujo.
3. Esquema en cuatro migraciones por bloques funcionales, cada una con sus políticas RLS.
4. Aplicación con simulación previa (`--dry-run`) y verificación con `migration list`.

## Problemas encontrados y solución

- Una función llamada `current_role()` habría fallado en Postgres (palabra reservada); se renombró a `current_user_role()` antes de aplicar.
- Un `grep -c` sin coincidencias devolvió código de salida 1 y cortó una cadena de comandos: el commit no se hizo hasta repetirlo.
- Las migraciones se aplicaron sin errores a la primera, pese a no poder ejecutarlas antes (sin Docker ni conector).

## Tiempo invertido

[COMPLETAR]

## Qué haría distinto la próxima vez

- Tener una base de prueba o el conector de Supabase disponibles antes de escribir SQL, para validar cada migración al escribirla.
- Escribir el diccionario de datos junto con cada migración, no al final.

## Deuda técnica pendiente

- Probar las políticas RLS con usuarios de distintos roles y organizaciones (Fase 2).
- Visibilidad de `conversations` y `messages` por sector (ADR-009).
- Base de conocimiento con `pgvector` (Fase 7).
- Definir retención de `ai_calls.trace` y `webhook_events.payload` (datos personales).
- Cambios en el esquema ya aplicado: siempre con migraciones nuevas, nunca editando las existentes.
