# ADR-012: `webhook_events` como bandeja de entrada durable para los eventos de WhatsApp

**Estado:** aceptada (2026-10-21). Ajusta ADR-007 para el flujo de entrada.

## Contexto

El webhook de Meta tiene que validar la firma, guardar y responder 200 rápido. Meta reintenta
durante hasta 7 días y puede repetir eventos; los mensajes pueden llegar fuera de orden. ADR-007
decidió una cola con pgmq. Al diseñar la recepción apareció una forma más simple de resolver lo
mismo para los eventos entrantes.

## Decisión

- Cada evento (mensaje o estado) se guarda en `webhook_events` con una clave de deduplicación
  única por canal (`msg:<id>` o `status:<id>:<estado>`). `processed_at` vacío = pendiente.
- La inserción usa `upsert` con `ignoreDuplicates`: los reintentos de Meta no duplican nada.
- El webhook valida primero la firma `X-Hub-Signature-256` (HMAC-SHA256 del cuerpo crudo con el
  secreto de la app, comparación en tiempo constante) y recién después interpreta el JSON.
- El `phone_number_id` del evento determina la organización (tabla `channels`). Un número sin canal
  registrado se guarda como procesado con un error, para auditar sin que el trabajador lo tome.
- Si la base falla, el webhook responde 500 para que Meta reintente.
- pgmq queda reservado para trabajos que el sistema se agenda a sí mismo (seguimientos,
  consultas al área, envíos).

## Alternativas descartadas

- **Encolar en pgmq desde el webhook:** agrega un segundo paso que puede fallar después de guardar
  y exige verificar la exposición de la API de colas; no aporta nada para eventos que ya están
  guardados de forma durable.
- **Procesar dentro del webhook:** si la IA tarda, Meta reintenta y se duplica el trabajo.

## Consecuencias

- Un solo lugar guarda el evento crudo, su estado de proceso y su error: fácil de auditar y reprocesar.
- El trabajador toma los pendientes con bloqueo (`for update skip locked`) para que dos instancias
  no procesen el mismo evento (paso 3.3).
- El `payload` contiene datos personales (teléfono, texto): hay que definir su retención.
- La firma y el 200 rápido no dependen de la IA ni de servicios externos.
