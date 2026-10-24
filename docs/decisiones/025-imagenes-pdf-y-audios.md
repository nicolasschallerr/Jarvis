# ADR-025: Imágenes, PDF y audios en la atención

**Estado:** aceptada (2026-10-24). Imágenes y PDF listos y probados con un modelo simulado; el proveedor de
transcripción de audio sigue pendiente (ADR-008).

## Contexto

Los asociados mandan fotos (comprobantes, documentos), PDF y audios, muchos de personas mayores. Hasta ahora el
agente solo veía texto y a todo lo demás le respondía "no puedo verlo". Los adjuntos de Telegram ya se descargan y se
guardan en un bucket privado (`media_files`).

## Decisión

- **Imágenes y PDF los lee el propio modelo**, enviados como bloques base64 en el historial. No hace falta un
  servicio aparte: la capa de IA (`ChatMessage`) ahora admite bloques de imagen y de documento, y el cliente de Claude
  los traduce al formato del proveedor.
- **Solo los adjuntos recientes se muestran en línea**: los 3 más recientes del asociado, de tipos que el modelo
  entiende (JPEG, PNG, GIF, WebP y PDF) y de hasta 5 MB. Cada adjunto se reenvía (y se paga) en cada turno, así que no
  se acumulan; los más viejos o pesados se mencionan ("ya no se muestra"). Un archivo que falla al bajar se omite sin
  cortar el turno. El tope de 5 MB es conservador y **hay que verificarlo contra los límites vigentes de Anthropic**
  antes de producción.
- **El audio se transcribe antes de que el agente responda**, y el texto queda guardado en el mensaje junto con el
  servicio que lo generó (`transcription`, `transcription_provider`). El agente lo recibe como `[Audio transcripto]`
  y se le indica que puede tener errores. La transcripción es idempotente: un reproceso no vuelve a pagar. Un audio
  sin voz no guarda texto vacío.
- **La transcripción es una interfaz** (`TranscriptionClient`), igual que el modelo: se prueba con un transcriptor
  simulado y el servicio real se elige con audios reales. **Hoy no hay ninguno configurado** (`transcriptionClientFromEnv`
  devuelve `null`): los audios se guardan y el agente le pide con amabilidad al asociado que escriba su consulta.
- **Un fallo de transcripción no invalida el mensaje**: queda guardado, se informa el motivo (nunca el contenido) y
  el turno sigue.
- **Datos sensibles:** se le indica al agente que no repita ni guarde datos sensibles de un adjunto que no necesite
  para la gestión.

## Alternativas descartadas

- **Extraer el texto de imágenes y PDF con OCR propio:** más piezas y menos fiable que dejar que el modelo lea el
  adjunto con el contexto de la conversación.
- **Mostrar todos los adjuntos del historial:** costo creciente en cada turno y riesgo de pasar el límite de tamaño.
- **Fijar ya el proveedor de transcripción:** sin audios reales para comparar sería una apuesta.

## Consecuencias

- Un turno con imágenes o PDF gasta más tokens; el panel de consumo (ADR-023) lo refleja.
- Los adjuntos de WhatsApp se descargan recién en la Fase 14; hasta entonces el agente los ve como "no se pudo ver".
- Falta elegir el servicio de transcripción (comparar con audios reales en español rioplatense, con ruido y voces
  mayores), medir su costo y conectar su variable de entorno.
- Falta cubrir otros tipos (video, planillas, documentos de texto) y reducir imágenes grandes antes de enviarlas.
- Con documentos de identidad en fotos, el contenido pasa por el proveedor de IA: debe constar en el contrato y en
  la política de privacidad (Ley 25.326).
