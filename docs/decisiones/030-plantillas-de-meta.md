# ADR-030: Plantillas de Meta para escribir fuera de la ventana de 24 h

**Estado:** aceptada (2026-10-25). Fase 9.

## Contexto

WhatsApp deja escribir texto libre solo dentro de las 24 h posteriores al último mensaje del contacto. Fuera de esa
ventana solo se pueden enviar plantillas aprobadas por Meta. Sin ellas, el CRM no podía retomar una conversación y
los seguimientos automáticos quedaban "omitidos".

Verificado en la documentación oficial (developers.facebook.com, 2026-10-25):
- Envío: `POST https://graph.facebook.com/<versión>/<phone-number-id>/messages` con `type: "template"`,
  `template.name`, `template.language.code` y `components[{ type: "body", parameters }]`. Los parámetros son
  posicionales (`{ type: "text", text }`, en orden) o con nombre (con `parameter_name`).
- Listado: `GET /<waba-id>/message_templates` con `fields`, `limit` y paginación (`paging.next`). Estados vistos:
  APPROVED, PENDING, REJECTED, PAUSED y DISABLED; `parameter_format` NAMED o POSITIONAL.
- La respuesta del envío trae `messages[0].id`; aceptado no es entregado (la entrega llega por el webhook).

## Decisión

- **Las plantillas se crean y se aprueban en Meta**, no en Orbita AI: acá se sincronizan (`/plantillas`, botón
  "Sincronizar con Meta", solo superadmin) y se usan. Las que Meta ya no devuelve quedan "desactivadas" (pueden estar
  en mensajes viejos).
- **Configuración del canal:** token en una variable de entorno (`secret_ref`, como siempre) y el id de la cuenta de
  WhatsApp Business en `channels.config.waba_id` (`scripts/crear-canal.mts --waba-id`). Versión de la Graph API en
  `META_GRAPH_VERSION` (por defecto `v23.0`).
- **Enviar una plantilla** (`sendTemplateMessage`) exige: canal de WhatsApp, plantilla **aprobada** de la misma
  organización, contacto que **no se dio de baja** y todas las variables completas (Meta rechaza saltos de línea y
  espacios de más: se limpian). El mensaje queda en la conversación con el texto ya completado y `template_id`.
- **En el CRM**, con la ventana cerrada aparece el formulario de plantillas: se elige, se completan las variables
  (la primera, o la llamada `nombre`, viene con el nombre del contacto) y se ve cómo le llega. Quien la envía toma el
  chat, igual que al responder a mano (ADR-028).
- **Seguimientos:** fuera de la ventana salen con la plantilla de `seguimientos.plantilla` si está aprobada. Sus
  variables se completan con lo conocido: `{{1}}`/`nombre` el contacto, `{{2}}`/`nombre_agente` el agente,
  `{{3}}`/`nombre_organizacion` la organización. Si pide otra cosa, no se usa y el seguimiento se omite.
- **Las respuestas del área no usan plantillas**: son texto redactado por el agente; esperan a que el contacto escriba.

## Consecuencias

- Hasta tener el número verificado por Meta (verificación de negocio en curso), todo esto se probó con un Meta falso.
  Al conectarlo: crear las plantillas en Meta, cargar `waba_id`, sincronizar y probar un envío real.
- El texto libre por WhatsApp (dentro de la ventana) sigue en la Fase 14.
- Falta: plantillas con encabezado multimedia o botones con variables, y los envíos masivos (que también usan
  plantillas).
