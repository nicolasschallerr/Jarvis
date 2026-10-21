# ADR-002: Next.js (App Router) + TypeScript estricto, desplegado en Vercel

**Estado:** aceptada (2026-10-20)

## Contexto

Una sola persona desarrolla, con unas 10 horas por semana. Hace falta frontend (CRM) y backend
(webhooks de Meta, API) con una URL pública HTTPS desde el principio, porque los webhooks lo exigen.

## Decisión

- Next.js 16 con App Router, `src/` y alias `@/*`, en un solo proyecto para frontend y backend.
- TypeScript con `strict` y `noUncheckedIndexedAccess`.
- Despliegue en Vercel conectado a GitHub: cada push genera un deployment; cada rama, una vista previa.
- npm como gestor de paquetes.

## Alternativas descartadas

- **Backend separado (Express u otro):** más piezas que mantener para una sola persona.
- **VPS propio:** mantenimiento de servidor, certificados y deploys a mano.
- **pnpm/yarn:** no aportan lo suficiente para este proyecto; npm ya venía instalado.

## Consecuencias

- Una sola base de código y un solo deploy.
- Vercel es serverless: las tareas largas (IA, transcripción, seguimientos) no pueden correr
  dentro del request del webhook. Hace falta una cola o un sistema de trabajos (decisión pendiente, Fase 1).
- El plan gratuito de Vercel no admite uso comercial: antes de producción hay que pasar a un plan pago.
- Next.js 16 trae cambios incompatibles con versiones anteriores: antes de escribir código de
  Next se consulta `node_modules/next/dist/docs/` (ver `AGENTS.md`).
