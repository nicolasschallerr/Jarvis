# ADR-029: Segunda ronda de endurecimiento

**Estado:** aceptada (2026-10-25). Complementa el ADR-027.

## Contexto

Una revisión independiente del proyecto (sin ver la auditoría anterior) encontró problemas que aparecen con
volumen o con procesos superpuestos: colas que se traban, el agente escribiendo encima de una persona y columnas de
los casos que una persona podía cambiar saltándose la pantalla.

## Decisión

1. **Respuestas del área postergables.** Si hoy no pueden salir (chat tomado, canal sin envío, ventana cerrada), se
   marcan con `reply_next_attempt_at` (+15 min) y el motivo en `reply_error`, sin gastar un intento. Antes quedaban
   primeras en la cola y, con 50 así, ninguna otra respuesta salía.
2. **Turno del agente también para las respuestas del área**, y renovable (`extend_agent_turn`, 180 s por vuelta):
   una respuesta larga no pierde el turno a mitad ni compite con otra en el mismo chat.
3. **El agente no escribe encima de una persona.** Justo antes de enviar vuelve a leer `ai_enabled` y el último
   mensaje (en cualquier dirección): si alguien tomó el chat o respondió mientras el modelo pensaba, no envía.
4. **No se paga el modelo si el mensaje no puede salir** (`checkSendable` antes de llamar al modelo), y un canal sin
   envío es un error definitivo, no algo que se reintenta cada 15 minutos.
5. **Seguimientos que no tapan la cola.** Los de organizaciones con seguimientos apagados se omiten; los que ya no
   corresponden (el caso dejó de esperar o el contacto escribió) se cancelan al momento de enviar; los que caen fuera
   de horario se corren 15 minutos.
6. **Tiempo máximo del trabajador** (`maxDuration = 60`): pasados 30 s, las tareas que pueden esperar quedan para la
   próxima pasada.
7. **Columnas protegidas en los casos**: desde la pantalla solo se cambian estado, prioridad, asignación, sector,
   título y resolución.
8. **Identidades de contacto solo del sistema**: cambiar un teléfono a mano mandaría los mensajes a otra persona.
9. **Asignaciones dentro de la organización**: solo a personas activas del equipo (no de consulta).

## Consecuencias

- Respuestas del área y seguimientos no se pierden: se demoran hasta que se puedan enviar.
- El rendimiento con miles de conversaciones se resolvió en el ADR-032 (último mensaje guardado en la conversación e
  índices). Sigue pendiente, si hiciera falta: programar seguimientos en una sola consulta y que el agente analítico
  agregue en SQL.
