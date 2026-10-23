# Fase 3: Recepción y envío de mensajes

**Estado:** cerrada
**Fechas:** 2026-10-21 a 2026-10-22

## Objetivo
Recibir mensajes de los canales de forma segura y sin perder ninguno, guardarlos con su contacto,
conversación y crédito, poder contestar, y recibir archivos. Decisión intermedia: desarrollar con
Telegram y dejar WhatsApp para la Fase 14 (ADR-013).

## Qué se construyó
| Paso | Resultado | Archivos principales |
|---|---|---|
| 3.1 | Webhook de WhatsApp: verificación GET y POST con firma HMAC | `src/app/api/webhooks/whatsapp/route.ts`, `src/lib/whatsapp/*` |
| 3.2 | Bandeja durable `webhook_events` con deduplicación y reclamo con `skip locked` | migraciones `…160000`, `…22100000` |
| 3.3 | Procesamiento multicanal: contacto, conversación, mensaje, ventana de crédito | `src/lib/inbound/*` |
| 3.4 | Canal de Telegram (webhook con secreto, normalizador, script de alta) | `src/app/api/webhooks/telegram/[botId]/route.ts`, `scripts/configurar-telegram.mts` |
| 3.5 | Envío con reglas por canal, trazabilidad y errores reintentables | `src/lib/outbound/*`, migración `…23100000` |
| 3.6 | Trabajador automático con pg_cron y Vault (ADR-014) | migración `…23110000`, `src/app/api/worker/messages/route.ts` |
| 3.7 | Multimedia de Telegram al bucket privado `media` | `src/lib/inbound/media.ts` (`7c031c4`) |
| — | Seguridad: `rls_auto_enable` sin EXECUTE para anon/authenticated | migración `…23120000` |

Pruebas: 86 en 12 archivos, todas pasan. `tsc`, `lint` y `build` sin errores.

## Cómo se resolvió
1. Responder 200 rápido y guardar el evento crudo; procesar aparte (idempotente por `external_id`).
2. Una sola puerta de salida (`sendTextMessage`): valida la regla del canal, guarda `queued`, envía y cierra.
3. Verificación real en cada paso: Telegram de punta a punta (~5 s), foto `image/jpeg` y voz `audio/ogg`.

## Problemas encontrados y solución
Ver lecciones 15 a 21 (variables en Vercel, secreto en Vault, `.env.local`, pruebas contra el trabajador real, confidencialidad en un ADR). Además: la cuenta de pruebas de Meta quedó restringida (error 131031) hasta verificar el negocio.

## Tiempo invertido
[COMPLETAR]

## Qué haría distinto la próxima vez
- Probar con el canal real desde el primer paso en lugar de esperar a Meta.
- Generar con script todo SQL que lleve un secreto.

## Deuda técnica pendiente
- Estados de entrega de WhatsApp (`sent/delivered/read`) y descarga de adjuntos de WhatsApp: Fase 14.
- Envío saliente de imágenes y audios: no implementado (solo texto).
- Modo eco temporal (`JARVIS_ECHO_MODE`): se elimina en la Fase 6.
- Retención de `webhook_events.payload` (datos personales): sin política todavía.
- Rotar la clave de servicio de Supabase y `WORKER_SECRET` antes de producción (expuestas en chats).
- DECISIÓN PENDIENTE: región de Supabase (hoy `us-west-2`) frente a la residencia de datos (Ley 25.326).
- Protección contra contraseñas filtradas desactivada (depende del plan de Supabase).
- Verificación del negocio en Meta en curso (tarea de Nicolás).
