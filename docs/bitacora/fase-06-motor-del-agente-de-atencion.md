# Fase 6: Motor del agente de atención

**Estado:** en curso (circuito construido y probado con un modelo simulado; falta la prueba con Claude real)
**Fechas:** desde 2026-10-24

## Objetivo
Que el agente de atención conteste a los asociados: lea el historial, use la base de conocimiento del cliente,
junte datos, derive al sector con un resumen o consulte al área, y deje todo registrado y trazable.

## Qué se construyó
| Paso | Resultado | Archivos principales |
|---|---|---|
| 6.1 | Funciones de la base con las que el agente escribe casos, y actor "agente" en el historial | migración `…20261024100000`, `database.types.ts` (`2159fcc`) |
| 6.2 | Capa de IA con interfaz propia, cliente real de Claude y cliente simulado | `src/lib/ai/*` (`2360dee`) |
| 6.3 | Bucle con herramientas, contexto (prompt, historial, horario) y registro en `ai_calls` | `src/lib/agent/*` (`2360dee`) |
| 6.4 | Carga versionada del prompt, el conocimiento y el modelo del cliente | `src/lib/client-config/attention.ts`, `scripts/cargar-configuracion.mts`, ADR-019 (`d2f58c0`) |
| 6.5 | El procesador de mensajes responde con el agente; se quita el modo eco | `src/lib/inbound/process.ts` (`4ee604d`) |
| 6.6 | Pantalla de Agentes: nombre, frase y encendido, solo superadmin | `src/app/(crm)/agentes/*`, `src/lib/crm/agents.ts` (`9800cda`) |
| 6.7 | El sector responde las consultas del agente desde el panel del caso | `src/lib/crm/area-queries.ts`, `conversaciones/[id]/area-*` (`7df15da`) |
| 6.8 | El agente le transmite al asociado la respuesta del área por el mismo chat | `src/lib/agent/area-replies.ts`, `src/lib/agent/load.ts`, ruta del trabajador |

Pruebas: **208** en 27 archivos con el modelo simulado (189 al cierre de la Fase 5). `build`, `lint` y tipos sin errores.

## Cómo se resolvió
1. El modelo nunca toca las tablas: sus herramientas llaman funciones de la base que validan y fijan el actor (ADR-019, lección 37).
2. La capa de IA no conoce el SDK: se prueba con respuestas armadas y se puede cambiar de proveedor.
3. La configuración del cliente se versiona en `agent_configs`; el modelo y los precios son configuración.
4. Sin API key el sistema sigue recibiendo y guardando mensajes; solo no contesta solo.

## Problemas encontrados y solución
Ver lecciones 37 a 39.

## Tiempo invertido
[COMPLETAR]

## Qué haría distinto la próxima vez
- Crear la API key antes de empezar la fase para poder validar el circuito con el modelo real desde el primer paso.

## Pendiente para cerrar la fase
- Crear la API key en el workspace `jarvis-dev` con límite de gasto (ADR-006) y correr `scripts/test-claude.mts`.
- Encender a Jarvis desde `/agentes` y probar una conversación real por Telegram (juntar datos, derivar, consultar al
  área, responder la consulta desde el caso y ver que el agente se la transmite al asociado).
- Ajustar el prompt y el modelo según lo observado.
- Confirmar con el dueño del proyecto cómo se ve la pantalla de Agentes (no se vio en navegador).
- Poner el tag `fase-06` con `/cerrar-fase`.

## Deuda técnica pendiente
- **Estado de reposo:** un agente encendido y sin trabajar se ve "en pausa"; falta un estado propio.
- **Adjuntos:** audio, imagen y PDF se le presentan al agente como "todavía no puedo escucharlo" (Fase 7).
- **Conocimiento:** va completo en las instrucciones; pasar a búsqueda por similitud cuando no entre cómodo.
- **Historial largo:** se muestran los últimos 30 mensajes; falta resumir conversaciones largas.
- **Respuestas del área pendientes:** si un operador tomó el chat o se cerró la ventana de 24 h, la respuesta queda
  sin enviar y se revisa en cada pasada; falta poder marcarla como "transmitida por un operador".
- **Avisos al sector:** el sector no recibe una notificación cuando el agente le hace una consulta; hoy la ve al
  abrir el caso (tabla `notifications` sin usar, Fase 9).
- **Auditoría:** `audit_log` sigue cubriendo solo contactos.
- **Heredado:** estados y adjuntos de WhatsApp (Fase 14), retención de la bandeja de eventos, rotar claves antes de producción.
