# ADR-046: El agente de stock como compañero visible

**Estado:** aceptada (2026-10-27). Completa ADR-043 y ADR-045.

## Contexto
El stock ya se consultaba como una capacidad del agente de atención (ADR-043) y se podía conectar desde el CRM (ADR-045),
pero en Agentes no aparecía nada: el equipo no veía que ese "agente" existía, ni podía encenderlo o apagarlo.

## Decisión
- **Un tipo de agente más**: `agent_kind` gana `stock`, con su fila en `agents` por organización (nombre, frase, encendido),
  su color (violeta: turquesa es la atención, ámbar el análisis, y el verde queda para estados de éxito) y su tarjeta en
  Agentes y en el Panorama. La tarjeta resume cuántos productos y fuentes hay y lleva a la sección Stock.
- **Sigue sin ser un modelo aparte que conversa.** Una sola voz atiende al cliente: pasarle la pregunta a otro modelo
  duplicaría la demora y el costo de cada respuesta (ADR-043). El interruptor del agente de stock decide si el agente de
  atención tiene las herramientas del catálogo (`buscar_en_catalogo`, `ver_ficha_del_catalogo`).
- **El interruptor manda sobre la configuración del cliente.** Encendido, el agente de atención consulta el catálogo aunque
  su configuración no lo pidiera; apagado, no lo consulta aunque la configuración lo activara. Una organización sin fila
  de stock (anterior a esto) sigue como diga su configuración.
- **Migraciones**: el valor del enum va en su propia migración (Postgres no deja usarlo en la misma transacción) y la
  siguiente crea la fila para cada organización existente. Quienes ya usaban el catálogo (con productos cargados o activado
  en su configuración) la reciben **encendida**, así nada cambia para ellas; las demás, apagada. Un disparador crea la fila,
  apagada, para las organizaciones nuevas.
- Los tipos internos (resumen, clasificador, copiloto, evaluador) siguen sin mostrarse: `toAgentKind` filtra los que
  son compañeros visibles.

## Pendiente
Lectura de sitios web y conexión a la base Supabase del cliente (ADR-045).
