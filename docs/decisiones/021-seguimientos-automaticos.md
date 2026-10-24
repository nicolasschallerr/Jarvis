# ADR-021: Seguimientos automáticos de gestiones a medias

**Estado:** aceptada (2026-10-24). Probada con reloj controlado y un canal falso; falta verla con el agente real.

## Contexto

Cuando una gestión queda esperando datos del asociado, muchas se abandonan en silencio. La configuración de cada
cliente ya prevé recordatorios (`seguimientos.horas`, por ejemplo 24, 48 y 72) y la tabla `followups` existe desde
la Fase 1. Hay que decidir cuándo se programan, cuándo se cancelan y cuándo salen, sin molestar al asociado ni
mandar nada de más.

## Decisión

- **Dónde corre:** en cada pasada del trabajador (`src/lib/followups/run.ts`), con tres pasos: programar, cancelar
  y enviar. No usa el modelo: el texto es fijo y configurable por cliente (`textos_editables.seguimiento`, con
  variables `{{nombre_agente}}` y `{{nombre_organizacion}}`), así es predecible y no gasta.
- **Cuándo se programa:** un caso en estado "esperando al asociado" (`waiting_contact`) recibe un recordatorio por
  cada hora configurada, contada desde el último cambio de estado a ese valor (se lee del historial del caso). Si
  vuelve a esperar más tarde, los recordatorios se reinician.
- **Cuándo se cancela:** si el asociado escribe después de que el caso quedó esperando, o si el caso deja de esperar
  (cambia de estado o se resuelve).
- **Cuándo sale:** cuando vence y solo **dentro del horario de atención** del cliente; si no, queda pendiente hasta
  que se abra. No sale si la IA está apagada en la conversación (un operador tomó el chat) ni si el agente está
  apagado o los seguimientos están desactivados.
- **Sin ventana de 24 h (WhatsApp):** se marca "omitido", porque ahí solo se puede escribir con una plantilla de
  Meta. Cuando estén aprobadas (Fase 9 y verificación de negocio) se usará `seguimientos.plantilla`.
- **Sin duplicados ni bucles:** cada recordatorio se reserva antes de enviar; si el canal rechaza el pedido de forma
  definitiva se omite, y si falla de forma pasajera se reintenta a los 15 minutos, no en cada pasada.
- **Un fallo de los seguimientos no tira abajo el trabajador**: los mensajes ya quedaron procesados.

## Alternativas descartadas

- **Que el agente redacte cada recordatorio:** más natural, pero gasta en cada envío y hace al comportamiento menos
  predecible. Se puede sumar más adelante como opción.
- **Un trabajo de pg_cron aparte, dentro de la base:** el envío necesita el canal y sus secretos, que viven en la
  aplicación.
- **Programar con un disparador de la base al cambiar el estado:** las horas viven en la configuración del cliente,
  no en una tabla; leerlas desde SQL complica sin ganar nada.

## Consecuencias

- **Nadie pone todavía el caso en "esperando al asociado" de forma automática**: hoy lo hace una persona desde el
  CRM. Falta que el agente lo haga cuando pide datos (herramienta o regla en el prompt), y se decide cuando se pruebe
  con Claude real.
- Los recordatorios omitidos por la ventana quedan registrados con estado "omitido" y no se reintentan.
- El horario se evalúa con la zona horaria del cliente; los feriados salen de su configuración.
- Falta una pantalla para ver los seguimientos programados de un caso y poder cancelarlos a mano.
