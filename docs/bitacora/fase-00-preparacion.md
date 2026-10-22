# Fase 0: Preparación

**Estado:** cerrada con dos pasos pospuestos (0.6a y 0.7)
**Fechas:** 2026-10-20 a 2026-10-21

## Objetivo

Dejar listas las cuentas, las herramientas y el repositorio para que cada fase siguiente
se ocupe solo de construir.

## Qué se construyó

| Paso | Resultado | Archivos / commits |
|---|---|---|
| 0.1 | Node.js 24 LTS (v24.22.0), npm 11 y Git 2.56 operativos en Windows 11 | — |
| 0.2 | Identidad de Git, rama por defecto `main`, `core.autocrlf=true`, repo privado en GitHub | — |
| 0.3 | Proyecto Next.js 16 (App Router, Turbopack, Tailwind, `src/`, alias `@/*`) con TypeScript estricto + `noUncheckedIndexedAccess` | `a719b76`, `a3cdc25`, `tsconfig.json` |
| 0.4 | Proyecto en Vercel conectado a GitHub: cada push despliega | — |
| 0.5 | Proyecto Supabase `jarvis-dev` (São Paulo) enlazado con la Supabase CLI como dependencia del repo | `a37ba04`, `supabase/config.toml` |
| 0.6a | App de Meta "Jarvis dev" en modo desarrollo con número de prueba creado y destinatario cargado | **Parcial**: el mensaje de prueba no llegó al celular; se retoma en la Fase 3 con el webhook |
| 0.7 | SDK de Anthropic y script de prueba | `bb64d31`, `scripts/test-claude.mts`. **Pospuesto** a la Fase 6 para no gastar todavía (API key y ejecución pendientes) |
| 0.8 | Variables de entorno y secretos | `03ddb6c`, `.env.example`; `.env.local` con las variables de Supabase. Las de Vercel quedaron sin cargar hasta la Fase 2 (lección 15) |
| 0.9 | Convenciones del repo | Adelantado: estructura producto/cliente/aprendizaje, `CLAUDE.md`, `/cerrar-fase` |

## Cómo se resolvió

1. Diagnóstico de la PC antes de instalar nada (qué había y qué faltaba).
2. Instalación con `winget` en lugar de instaladores manuales.
3. Proyecto creado en una subcarpeta `jarvis/` para dejar fuera del repo los documentos comerciales.
4. Despliegue por integración GitHub → Vercel ("push = deploy").
5. Supabase en la nube + CLI con migraciones versionadas, sin Docker por ahora.
6. Reorganización temprana en tres capas (producto / cliente / aprendizaje) antes de escribir lógica de negocio.

## Problemas encontrados y solución

Ver [lecciones.md](../lecciones.md): terminal con PATH viejo, Execution Policy, winget 1603,
email de ejemplo en `git config`, comandos corridos en la carpeta padre, `project_id` derivado de la carpeta.

## Tiempo invertido

[COMPLETAR]

## Qué haría distinto la próxima vez

- Abrir VS Code directamente en la carpeta del repo desde el primer minuto: evita todos los errores de "carpeta equivocada".
- Pedir al cliente desde el día uno la documentación para la verificación de Meta, porque es lo único que corre en paralelo y tarda.
- Crear la estructura `clientes/` + `docs/` junto con el esqueleto del proyecto.

## Deuda técnica pendiente

- 0.6a: confirmar que un mensaje del número de prueba llega al celular (revisar el formato del número argentino, con o sin el `9`) y que los entrantes llegan al webhook.
- 0.7: crear la API key en el workspace `jarvis-dev` con límite de gasto y correr `scripts/test-claude.mts` (Fase 6).
- Riesgo aceptado: la clave secreta de Supabase quedó visible en una conversación con el asistente (nunca llegó a git ni a GitHub) y no se rotó por decisión del dueño del proyecto. Rotarla antes de producción.
- Script de carga y esquema de validación de la configuración de cliente (Fase 5).
- Revisar el plan de Vercel antes de producción: el plan gratuito no admite uso comercial.
