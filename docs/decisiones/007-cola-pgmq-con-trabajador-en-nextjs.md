# ADR-007: Cola de trabajos con pgmq + pg_cron, trabajador como ruta de Next.js

**Estado:** aceptada (2026-10-21)

## Contexto

Jarvis necesita trabajo en segundo plano que sobreviva a reinicios: procesar mensajes con IA,
transcribir audios, esperar la respuesta de un sector ("consulta al área"), enviar seguimientos
a las 24, 48 y 72 h y reintentar lo que falla. El webhook de Meta debe responder rápido y no
puede esperar a la IA. El presupuesto es de unos USD 50 por mes y desarrolla una sola persona.

## Decisión

- La cola es **Supabase Queues (`pgmq`)**, dentro de la base de Jarvis.
- **`pg_cron`** (con `pg_net`) invoca periódicamente un **trabajador**: una ruta de Next.js
  (`src/app/api/...`) protegida con un secreto, que lee un lote corto de mensajes, los procesa
  y los borra al terminar. Si falla, el mensaje no se borra y se vuelve a leer tras la ventana
  de visibilidad (reintento).
- Los seguimientos y las esperas largas se modelan como **filas con fecha de vencimiento** en
  tablas propias; el trabajador las pone en la cola cuando vencen.
- El trabajador procesa en lotes cortos. Con Fluid Compute, Vercel permite hasta 300 s por
  función en el plan Hobby (800 s en Pro); un lote cabe holgadamente.

Fuentes: documentación de Supabase Queues y de duración de funciones de Vercel (verificadas el 2026-10-21).

## Alternativas descartadas

- **Trabajador como Edge Function de Supabase:** quita el límite de Vercel, pero agrega un
  segundo entorno de ejecución (Deno), código separado de Next.js y más difícil de probar.
  Plan B: la cola es la misma, así que migrar no cambia el esquema.
- **Inngest:** maneja esperas largas y reintentos por diseño, pero es un servicio externo
  adicional con datos de afiliados y un costo que no verificamos.
- **n8n:** otro servidor que mantener; difícil de testear y de aislar por cliente.
- **Solo `pg_cron`:** dispara tareas, pero no maneja reintentos ni estado de cada mensaje.

## Consecuencias

- Todo en Postgres: un solo proveedor, cola transaccional junto a los datos, sin costo extra.
- El código del trabajador está en TypeScript, en este repo, y se prueba con el resto.
- Hay que diseñar el trabajador **idempotente** (un mensaje puede procesarse dos veces).
- La latencia depende de la frecuencia del cron; para respuestas inmediatas, el webhook puede
  además invocar al trabajador directamente después de encolar.
- Riesgo: si el volumen crece mucho, el trabajador en Vercel pasa a ser el cuello de botella
  y habría que moverlo (Edge Function o servicio dedicado).
