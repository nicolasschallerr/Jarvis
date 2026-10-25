# ADR-032: Rendimiento de la bandeja con miles de conversaciones

**Estado:** aceptada (2026-10-25). Resuelve lo pendiente del ADR-029.

## Contexto

La vista `conversation_summaries` buscaba el último mensaje de cada conversación con una subconsulta ordenada por fila,
y las cinco pestañas de la bandeja contaban filtrando sobre ese cálculo: cada carga recorría toda la organización. Con
miles de conversaciones eso crece sin límite. Además, la pantalla se recargaba con cada cambio de estado de un agente
(que el agente escribe en cada turno).

## Decisión

- **El último mensaje se guarda en la conversación** (`last_message_id`, `last_body`, `last_type`, `last_direction`,
  `last_sender`). Lo mantiene un disparador sobre `messages` al insertar y cuando cambian el estado o la hora (un envío
  fallido deja de ser "el último"). Se completó con lo existente.
- **Índices** para ordenar la bandeja por último mensaje y para las pestañas "Esperando respuesta" y "IA en pausa";
  índice parcial de mensajes que no fallaron y de ventanas por contacto.
- **Todo mensaje tiene hora** (`provider_timestamp` obligatorio): ordenar por esa hora ya no necesita tratar los nulos.
- **La vista queda sin subconsulta de mensajes**; mismos nombres de columnas, así que no cambia el código que la usa.
- **Las columnas nuevas son del sistema**: una persona no las puede escribir (guardia de columnas, ADR-027).
- **Refresco en vivo:** solo el Inicio escucha los cambios de los agentes; la bandeja y los casos, no.

## Consecuencias

- Cada mensaje guardado hace una consulta indexada más (la del último mensaje de su conversación).
- Siguen pendientes, si hiciera falta con mucho volumen: contar las pestañas con una sola consulta, programar los
  seguimientos con una función de la base y que el agente analítico agregue en SQL en vez de traer filas.
