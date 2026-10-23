# ADR-013: Telegram como canal de desarrollo; WhatsApp se activa en producción

**Estado:** aceptada (2026-10-22)

## Contexto

Para probar el agente, el CRM y los flujos hace falta un canal por el que escribir y recibir
mensajes de verdad. La cuenta de WhatsApp Business del desarrollador quedó restringida: Meta exige
verificar el negocio antes de enviar, y además, mientras la app no esté publicada, no entrega
mensajes reales al webhook. Esperar esa verificación frena todo el avance, y el objetivo es llegar a
producción lo antes posible.

## Decisión

- Hasta la fase de producción, el canal de prueba es un **bot de Telegram**. Es gratis, no requiere
  verificar un negocio, entrega mensajes reales al webhook y soporta texto, audios, imágenes y documentos.
- El sistema ya es multicanal desde el diseño: `channels.type` incluye `telegram`, y la ingesta
  (`ingest_inbound_message`) recibe el tipo de canal. Cada canal tiene un normalizador que arma un
  mensaje común; guardado, créditos, agente y CRM no saben de qué canal vino.
- La URL del webhook de Telegram lleva el id del bot (`/api/webhooks/telegram/<id>`) y se valida con
  el secreto que se pasa a `setWebhook` (encabezado `X-Telegram-Bot-Api-Secret-Token`).
- Lo hecho para WhatsApp (verificación del webhook, firma, recepción) se conserva y sigue probado;
  se conectará en la Fase 14 cuando exista el número de producción verificado.
- Telegram es un canal de **desarrollo**, no un reemplazo de WhatsApp para el cliente final: los
  afiliados del cliente piloto usan WhatsApp.

## Alternativas descartadas

- **Esperar la verificación de Meta:** frena Fases 3 a 11 sin necesidad.
- **Un simulador local sin canal real:** no ejercita el webhook, los reintentos ni los audios reales.
- **Usar otro proveedor de WhatsApp (BSP):** contradice la decisión de ir directo a la API de Meta.

## Consecuencias

- Avance inmediato: se puede construir y probar el flujo completo con un canal real.
- **Riesgo:** lo propio de WhatsApp no se prueba hasta la Fase 14: la ventana de atención de 24 h
  con la obligación de usar plantillas fuera de ella, las plantillas aprobadas por Meta, los límites
  de envío y el comportamiento de los estados de entrega. Telegram no tiene esas restricciones.
  Hay que dejar esas reglas implementadas detrás de la capa de envío y cubiertas con pruebas, y
  validarlas con el número real en la Fase 14.
- Los créditos (1 conversación de 24 h por contacto) funcionan igual en ambos canales.
- Hay dos canales que mantener en el código de entrada.
