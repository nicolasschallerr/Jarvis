# Fase 8: Evaluaciones del agente

**Estado:** cerrada el 2026-10-26 (tag `fase-08`)
**Fechas:** 2026-10-24 a 2026-10-26

## Objetivo
Poder medir si el agente responde bien antes de ponerlo frente a la gente, y repetir la medición cada vez que se cambia el
prompt, el conocimiento o el modelo.

## Qué se construyó
| Pieza | Resultado | Dónde |
|---|---|---|
| Runner de evals | Corre cada caso contra el agente real (mismo prompt, herramientas y mensaje final que en producción) y lo evalúa un modelo juez | `src/lib/evals/*`, `scripts/correr-evals.mts`, ADR-020 |
| Casos por cliente | Conversaciones inventadas con lo que se espera: acción (responder, juntar datos, derivar, consultar al área), sector, qué debe incluir y qué no | `clientes/<slug>/evals/casos.yaml` (plantilla en `clientes/_plantilla`) |
| Mismo mensaje que recibe la persona | El runner incluye el aviso oficial de derivación y el canal, como producción | `composeReply` (lección 57) |
| Canal simulado | `--canal whatsapp`, `instagram`, `messenger` o `telegram` | `scripts/correr-evals.mts` |

## Resultado con Claude real
- Cliente piloto: **17 de 17** casos aprobados (agente y juez `claude-sonnet-5-5`); los que dependían del juez se repitieron varias veces.
- Cuesta dinero: unos 12 mil tokens de entrada y 12 mil de salida por corrida completa. No escribe nada en la base.

## Cómo se resolvió
1. El runner prueba el **mismo** camino que producción (prompt, herramientas, mensaje final), no uno parecido.
2. Los criterios del juez se escriben en positivo y concretos; si un caso falla con una explicación que lo contradice, se arregla el criterio (lección 58).
3. Lo que falla en los evals se arregla donde corresponde: contenido del cliente, prompt del producto o motor.

## Problemas encontrados y solución
Lecciones 57 y 58.

## Pendiente
- Evaluación automática de conversaciones reales (muestreo en producción) y su panel: no construido.
- Casos de las otras ramas con más variantes (errores de tipeo, audios, mensajes largos) y de cada canal.
- Poner el tag `fase-08` con `/cerrar-fase` (necesita la confirmación del dueño del proyecto).
