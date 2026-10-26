# ADR-041: Copiloto: borrador de respuesta para el equipo

**Estado:** aceptada (2026-10-26).

## Contexto
Cuando una persona del equipo toma un chat (o el agente deriva), escribir cada respuesta desde cero es lento y propenso a
contradecir lo que sabe el agente. El producto prometía un "copiloto IA".

## Decisión
- Botón **"Sugerir respuesta"** en el cuadro de respuesta de una conversación: el copiloto redacta un **borrador** y lo
  deja en el cuadro; la persona lo lee, lo edita y lo **envía ella**. El copiloto **nunca envía** ni guarda datos ni deriva
  (sin herramientas).
- Usa el **mismo prompt y el mismo conocimiento** del agente de atención (más una instrucción interna de que es un borrador
  para una persona), el modelo configurado y el canal de la conversación. Si el agente no está configurado y encendido, no hay copiloto.
- Solo superadmin y operador (el rol de consulta no). La conversación tiene que ser visible para quien pide (RLS).
- Se registra en el consumo como `agent_kind = 'copilot'` (tokens y costo, sin el texto de la conversación).
- El borrador pasa por `formatForChannel` (sin Markdown suelto) y se acota a 1500 caracteres.

## Consecuencias
- Cada pedido paga una llamada al modelo con el historial de la conversación (últimos 30 mensajes): conviene mostrar el
  consumo del copiloto por separado (hoy se ve dentro del total de IA).
- No hay límite de pedidos por persona. Pendiente si hace falta.
- Pendiente: sugerir también un resumen de la conversación y la clasificación del tema.
