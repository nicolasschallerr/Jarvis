# ADR-020: Evals del agente de atención

**Estado:** aceptada (2026-10-24). Construida y probada con modelos simulados; falta correrla con Claude real.

## Contexto

Las pruebas con un modelo simulado demuestran que el circuito funciona (lección 39), no que el agente atienda
bien. Para cambiar el prompt, el conocimiento o el modelo sin romper lo que ya andaba hace falta un conjunto de
conversaciones fijas que se puedan volver a correr y comparar. Los casos de cada cliente ya tienen un formato
(`clientes/<slug>/evals/casos.yaml`).

## Decisión

- **Un runner offline** (`src/lib/evals/`, `scripts/correr-evals.mts`): le escribe al agente los mensajes de cada
  caso, de a uno, con el mismo contexto y las mismas herramientas que en producción, y lo evalúa. **No toca la
  base**: las herramientas escriben en una memoria que solo anota qué pidió el agente.
- **Lo comprobable con código se comprueba con código**: si derivó, si consultó al área y a qué sector. `responder`
  y `juntar_datos` exigen no escalar.
- **Lo que no se puede comprobar con código lo juzga otro modelo** con una rúbrica fija y una sola herramienta
  (`registrar_veredicto`), así el veredicto llega estructurado. La rúbrica es estricta: ante la duda, no cumple /
  infringe.
- **Una evaluación dudosa nunca aprueba**: si el juez no responde con la herramienta, devuelve un formato
  inválido o no cubre todos los criterios, el caso falla con ese motivo. Lo mismo si el agente no respondió.
- **Sale con código 1 si algún caso falla**, para poder usarlo como control antes de publicar un cambio.
- **El modelo es configuración**: el agente usa `ia.modelo_atencion`; el juez, un valor por defecto del perfil
  intermedio (ADR-008) que se podrá mover a la configuración.
- **Cuesta dinero y se corre a mano**: no forma parte de `npm test`. Las pruebas automáticas cubren el runner con
  agente y juez simulados.

## Alternativas descartadas

- **Comparar texto exacto:** las respuestas de un modelo varían; sirve solo para acciones, no para el contenido.
- **Correr los evals en `npm test`:** gasto en cada ejecución y resultados no deterministas.
- **Escribir en la base de desarrollo durante los evals:** ensucia los datos y hace falta limpiar.

## Consecuencias

- Un juez también se equivoca: los resultados orientan, no reemplazan leer algunas conversaciones.
- Los casos de la plantilla son pocos (5) y de ejemplo; el valor real depende de los casos que escriba cada cliente
  con conversaciones reales (sin datos personales).
- Cada caso gasta varias llamadas (una por mensaje, más las herramientas, más el juez): conviene correr un caso
  suelto con `--caso <id>` mientras se ajusta el prompt.
- Faltan: guardar los resultados para comparar entre corridas, repetir cada caso varias veces para medir la
  variación, y evaluar conversaciones reales con `conversation_evaluations` (Fase 8).
