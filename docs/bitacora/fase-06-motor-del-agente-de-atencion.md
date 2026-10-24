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
| 6.8 | El agente le transmite al asociado la respuesta del área por el mismo chat | `src/lib/agent/area-replies.ts`, `src/lib/agent/load.ts`, ruta del trabajador (`0e43cc8`, `2e40125`) |
| 6.9 | Avisos al sector cuando el agente deriva o consulta, visibles en Inicio | migración `…20261024110000`, `src/lib/crm/notifications.ts`, `(crm)/page.tsx` |
| 6.10 | Adelanto de la Fase 8: runner de evals con juez, probado con modelo simulado | `src/lib/evals/*`, `scripts/correr-evals.mts`, ADR-020 |
| 6.11 | Adelanto de la Fase 9: seguimientos a las 24, 48 y 72 h, probados con reloj controlado | `src/lib/followups/run.ts`, ADR-021 |
| 6.12 | Ramas por carpeta, datos validados con reintentos, guardián antes de derivar, comando MENÚ y mensaje oficial de derivación | `src/lib/agent/tools.ts`, `context.ts`, `client-config/*`, migraciones `…120000`, `…130000`, `…140000`, ADR-022 |
| 6.13 | Naturalidad: datos juntos en un mensaje, teléfono tomado del canal, un solo mensaje por turno y prompt como persona | `agent/context.ts`, `agent/tools.ts`, `agent/attention.ts`, migración `…150000`, ADR-022 |
| 6.14 | Adelanto de la Fase 11: panel de consumo (créditos y uso de IA por día) | migración `…160000`, `src/lib/crm/consumption.ts`, `(crm)/consumo/page.tsx`, ADR-023 |

Pruebas: **302** en 36 archivos con el modelo simulado (189 al cierre de la Fase 5). `build`, `lint` y tipos sin errores.

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
- **Ramas del cliente piloto:** el contenido real vive en `clientes/<slug>/` (ignorado por git, sin cargar a la base de desarrollo). Faltan datos del cliente marcados `[COMPLETAR]` (tipologías y tarifas del hotel, capacidad de los salones, tres beneficios) y `DECISIÓN PENDIENTE` (nombre del agente, feriados, temas sensibles, seguimientos). No se probó con Claude real.
- **Consumo:** el panel no tiene límites ni alertas, no incluye servicios distintos de Claude y no se exporta; el costo depende de los precios que cargue el cliente.
- **Seguimientos:** nadie pone aún el caso en "esperando al asociado" de forma automática (hoy lo hace una persona); falta que el agente lo haga al pedir datos. Fuera de la ventana de 24 h de WhatsApp quedan omitidos hasta tener plantillas de Meta. No hay pantalla para ver o cancelar los programados.
- **Avisos:** solo se ven en Inicio y se refrescan al recargar o al cambiar algo en vivo; no hay campana en el menú
  ni aviso por email o WhatsApp al responsable (Fase 9). Tampoco se avisa cuando el sector responde una consulta.
- **Auditoría:** `audit_log` sigue cubriendo solo contactos.
- **Heredado:** estados y adjuntos de WhatsApp (Fase 14), retención de la bandeja de eventos, rotar claves antes de producción.
