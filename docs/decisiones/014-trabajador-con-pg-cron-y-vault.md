# ADR-014: Trabajador de mensajes disparado por pg_cron, con secretos en Vault

**Estado:** aceptada (complementa el ADR-007 y el ADR-012)

## Contexto
La bandeja `webhook_events` (ADR-012) necesita un proceso que la vacíe. Vercel (plan Hobby) no
ofrece crons de alta frecuencia, y el webhook debe responder rápido sin procesar.

## Decisión
- `pg_cron` ejecuta cada 10 segundos `private.invoke_message_worker()`, que llama con `pg_net` a
  `/api/worker/messages` de la aplicación.
- La URL y el secreto del trabajador están en **Supabase Vault** (`jarvis_app_url`,
  `jarvis_worker_secret`), nunca en las migraciones. Sin secretos, la función no hace nada.
- La ruta exige `Authorization: Bearer <WORKER_SECRET>` (comparación en tiempo constante).
- Los adjuntos se descargan en el mismo trabajador y se guardan en el bucket privado `media`
  con ruta `organización/conversación/mensaje.ext`; un fallo reintenta con la bandeja.

## Alternativas descartadas
- Cron de Vercel: en Hobby solo corre una vez al día.
- Procesar dentro del webhook: arriesga timeouts y reintentos de Meta/Telegram.
- Un servicio aparte (worker dedicado): más infraestructura sin necesidad hoy.

## Consecuencias
- Latencia de hasta ~10 s desde que llega un mensaje (medida real: ~5 s).
- El trabajador comparte base con las pruebas (ver lección 19).
- Hay que rotar `WORKER_SECRET` en Vercel y en Vault a la vez.
- Si la carga crece, se reevalúa (pgmq u otro trabajador); `FOR UPDATE SKIP LOCKED` ya permite varios.
