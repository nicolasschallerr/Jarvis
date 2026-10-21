# ADR-011: Autenticación con Supabase Auth, verificación con `getClaims()` en el proxy

**Estado:** aceptada (2026-10-21)

## Contexto

El CRM necesita iniciar sesión, mantenerla y proteger las páginas. Los datos de cada
organización ya están aislados por RLS; falta que el navegador actúe con la identidad correcta.
Los webhooks de Meta no tienen usuario y no pueden pasar por el login.

## Decisión

- Supabase Auth con email y contraseña; el email del superadmin se confirma al crearlo (lo crea un administrador).
- `@supabase/ssr` guarda la sesión en cookies. Tres clientes: navegador (clave pública), servidor
  (como el usuario, con RLS) y administrador (clave de servicio, `import "server-only"`).
- `src/proxy.ts` (nombre de Next.js 16, antes `middleware`) refresca la sesión y verifica con
  `getClaims()`, nunca con `getSession()`, que lee la cookie sin validarla.
- Las rutas `/api/*` quedan fuera del proxy: cada una valida su propio acceso (firma de Meta,
  secreto del trabajador, etc.).
- El primer superadministrador se crea con un script que pide la contraseña sin mostrarla.
- Mensaje de error único en el login para no revelar si un email existe.

## Alternativas descartadas

- **Proveedores externos (Google, Microsoft):** más cómodo para el usuario, pero agrega configuración por cliente; se puede sumar luego.
- **Autoregistro:** los usuarios los crea un administrador; un CRM interno no es abierto.
- **Proteger solo en cada página:** un olvido dejaría una ruta abierta; el proxy es una red de seguridad central.

## Consecuencias

- Sin sesión nadie ve nada; el aislamiento por organización lo garantiza RLS, no el código de la página.
- Los endpoints de `/api` no están protegidos por el proxy: cada uno debe validar su acceso y tener su prueba.
- Deuda: recuperación de contraseña, alta de usuarios desde el CRM y autenticación en dos pasos.
