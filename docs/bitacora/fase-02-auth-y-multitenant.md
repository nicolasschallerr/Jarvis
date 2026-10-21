# Fase 2: Auth, multi-tenant y perfiles con RLS

**Estado:** cerrada
**Fechas:** 2026-10-21

## Objetivo

Que las personas puedan iniciar sesión, que cada una quede atada a una organización con un rol,
y demostrar con pruebas que un cliente no puede ver datos de otro.

## Qué se construyó

| Paso | Resultado | Archivos / commits |
|---|---|---|
| 2.1 | Clientes de Supabase (navegador, servidor, administrador) y tipos generados | `src/lib/supabase/*` (`96da376`) |
| 2.2 | Proxy que refresca la sesión con `getClaims()` y protege las rutas | `src/proxy.ts`, `src/lib/supabase/proxy.ts` (`db00682`) |
| 2.3 | Login, cierre de sesión e inicio con el perfil | `src/app/login/*`, `src/app/page.tsx` (`f046a4d`) |
| 2.4 | Script para crear organización y superadministrador | `scripts/crear-superadmin.mts` (`269e223`) |
| 2.5 | 15 pruebas de RLS por organización, rol y sector | `tests/rls.test.ts` (`a559fb8`) |
| 2.6 | ADR-011, lecciones 11 a 14, esta bitácora | — |

## Cómo se resolvió

1. Clientes separados por contexto de ejecución; el administrador marcado `server-only`.
2. Verificación de identidad con `getClaims()` (verifica la firma), según la documentación de Supabase.
3. Páginas adaptadas a Cache Components (lectura de sesión dentro de `Suspense`).
4. Pruebas de integración con datos descartables creados y borrados en cada corrida.

## Problemas encontrados y solución

Ver [lecciones.md](../lecciones.md), 11 a 14: Cache Components y Suspense, conflicto de `@types/node`,
cadena de comandos cortada por `grep -c`, pasos confirmados sin ejecutarse.

## Tiempo invertido

[COMPLETAR]

## Qué haría distinto la próxima vez

- Verificar el estado real (conteos en la base) antes de dar un paso por hecho.
- Pasar las páginas por `npm run build` desde el primer archivo: con Cache Components, algunos errores solo aparecen al compilar.

## Deuda técnica pendiente

- Crear el superadministrador real con `scripts/crear-superadmin.mts` (la base está vacía).
- Recuperación de contraseña, alta de usuarios desde el CRM y doble factor.
- Pruebas de visibilidad de chats por sector (ADR-009) cuando se resuelva.
- Las pruebas corren contra el proyecto de desarrollo; si una corrida se corta pueden quedar datos `zz-test-`.
- Proteger y probar cada ruta `/api/*` que se agregue (fuera del proxy).
