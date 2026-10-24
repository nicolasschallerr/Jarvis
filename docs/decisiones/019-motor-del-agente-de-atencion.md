# ADR-019: Motor del agente de atención

**Estado:** aceptada (2026-10-24). Verificada con un modelo simulado; falta la prueba con Claude real.

## Contexto

La Fase 6 pone a conversar al agente de atención. Hay que decidir cómo se arma el turno, de dónde sale
lo que el agente sabe, cómo escribe en los casos y cómo se distingue su trabajo del de un operador o del
sistema, sin escribir nada de un cliente en el código (regla de separación producto / cliente).

## Decisión

- **Una capa de IA propia** (`src/lib/ai/`): una interfaz `ModelClient` con tipos propios. Hay un cliente
  real de Claude y un cliente simulado que devuelve respuestas armadas. El motor no conoce el SDK, así que
  se prueba sin API key ni gasto y se puede cambiar de proveedor.
- **Bucle con herramientas** (`src/lib/agent/loop.ts`): se le pregunta al modelo, se ejecutan las
  herramientas que pida y se repite hasta que conteste con texto. Máximo 6 pasos por turno. El error de una
  herramienta vuelve al modelo como resultado con error; no corta el turno.
- **Tres herramientas** (`tools.ts`): guardar datos del caso, derivar a un sector con resumen y consultar al
  área. Los sectores y unidades válidos salen de la configuración del cliente y se pasan como `enum`.
- **El modelo nunca toca las tablas.** Las herramientas llaman funciones de la base (`agent_save_case_data`,
  `agent_handoff_case`, `agent_ask_area`), con permiso solo para la clave de servicio. Cada una fija
  `jarvis.actor = 'agent'` dentro de su transacción y el disparador de historial lo lee: el actor "agente"
  queda distinto de "sistema" (resuelve la deuda del ADR-017).
- **Configuración versionada**: `agent_configs` guarda prompt, modelo y `settings` (unidades, sectores,
  horario, temas sensibles, conocimiento por unidad). La carga el script `cargar-configuracion.mts` desde
  `clientes/<slug>/`; solo crea versión nueva si algo cambió y conserva las anteriores.
- **El conocimiento va completo en las instrucciones** (con caché del proveedor), no con búsqueda por
  similitud. Con pocas unidades y documentos cortos es más simple y más fiable; se pasa a búsqueda
  (pgvector) cuando el conocimiento no entre cómodo.
- **El modelo es configuración** (`ia.modelo_atencion`, por defecto el perfil intermedio del ADR-008).
  El costo en USD se calcula solo si el cliente configura los precios; sin precios queda vacío.
- **Se responde un mensaje a la vez**: no se contesta si el último mensaje no es del asociado, si la IA está
  apagada en la conversación o el agente está apagado, y se descarta la respuesta si mientras tanto llegó un
  mensaje más nuevo (esa otra ejecución contesta con el contexto completo).
- **Consultas al área, ida y vuelta**: el sector responde desde el panel del caso (solo sus miembros o el
  superadmin). El trabajador, en cada pasada, toma las respuestas sin enviar, el agente las redacta **sin
  herramientas** (solo transmite lo que confirmó el sector) y las manda por el mismo chat. Cada respuesta se
  reserva marcando `reply_sent_at` antes de enviar y se libera si algo falla, para no mandarla dos veces.
  Si un operador tomó el chat o la conversación está fuera de la ventana de 24 h, queda a la vista en el caso.
- **Sin API key el sistema sigue funcionando**: recibe y guarda mensajes, solo no contesta solo. Se quitó
  el modo eco.

## Alternativas descartadas

- **El modelo escribe SQL o actualiza tablas:** demasiado riesgo; las funciones validan y registran.
- **Búsqueda por similitud desde ya:** complejidad sin necesidad con poco contenido.
- **Una constante con el modelo y los precios:** rompería "el modelo es configuración".

## Consecuencias

- Todo cambio de comportamiento de las herramientas pasa por una migración de las funciones.
- El estado del agente en el CRM hoy usa `working` mientras trabaja y `paused` en reposo; un agente
  encendido y ocioso se ve "en pausa". Falta un estado propio de reposo (deuda).
- Audios, imágenes y PDF se mencionan al agente como "todavía no puedo escucharlo": se resuelven en la Fase 7.
- Si el envío falla después de que el canal ya entregó el mensaje (por ejemplo, al cerrarlo en la base), la
  respuesta del área se libera y puede salir dos veces. Es poco probable y se acepta por ahora.
- Las respuestas del área que quedan pendientes (chat tomado por un operador, fuera de ventana) se vuelven a
  revisar en cada pasada del trabajador; falta marcarlas como "las transmitió un operador".
- Los evals (Fase 8) usan el mismo `ModelClient` para correr los casos de `evals/casos.yaml`.
