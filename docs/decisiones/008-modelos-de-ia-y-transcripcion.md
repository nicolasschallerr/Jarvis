# ADR-008: Modelos de IA por tarea y transcripción de audio

**Estado:** propuesta (2026-10-21). Se confirma con evals en la Fase 8; la transcripción se decide en la Fase 7.

## Contexto

Distintas tareas tienen distinto volumen y exigencia. Usar siempre el modelo más grande es caro
y lento; usar siempre el más chico degrada la calidad de la atención. Los audios de los
asociados (muchos de personas mayores, con ruido, en español rioplatense) necesitan transcripción.

## Decisión (provisoria)

| Tarea | Perfil de modelo |
|---|---|
| Clasificación y etiquetado | Más chico y barato |
| Atención al asociado y resumen de casos | Intermedio |
| Agente Analítico | Más capaz (bajo volumen, razona sobre datos) |
| Evaluación de conversaciones | Intermedio, con rúbrica fija |

- Cada llamada al modelo registra **modelo, tokens de entrada y salida, costo y herramientas
  usadas**, de modo que cambiar de modelo no requiere cambiar el esquema.
- La **transcripción** se decide en la Fase 7 comparando opciones con audios reales (Whisper de
  OpenAI, Deepgram, Google). El esquema guarda el audio, el texto y qué servicio lo generó.
- Los identificadores y precios vigentes de los modelos se verifican en la documentación
  oficial en el momento de usarlos; no se asumen.

## Alternativas descartadas

- **Un único modelo para todo:** simple, pero caro o de baja calidad según cuál se elija.
- **Fijar el proveedor de transcripción ahora:** sin audios reales para comparar sería una apuesta.

## Consecuencias

- Hay que construir evals (Fase 8) antes de dar por buena la asignación.
- La capa de llamadas a IA debe aceptar el modelo como configuración, no como constante.
- Mientras no haya API key cargada, el resto del sistema se prueba con respuestas simuladas.
