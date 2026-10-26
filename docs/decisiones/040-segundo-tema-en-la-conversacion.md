# ADR-040: Un segundo tema en la misma conversación

**Estado:** aceptada (2026-10-26), como solución mínima; la definitiva queda pendiente.

## Contexto
Una conversación tiene un solo caso abierto (índice `cases_one_open_per_conversation`; el agente, la bandeja, el tablero, los
seguimientos y la unión de contactos se apoyan en eso). En una prueba real por Telegram la persona pidió el gimnasio y
después el hotel: el agente derivó la segunda consulta y le cambió el sector y el resumen al caso, así que el primer sector
perdió su caso sin enterarse.

## Decisión
Si el caso **ya está en un sector** y el agente deriva a **otro**, el caso **no se mueve** (sigue en su sector, estado y
prioridad), el resumen del segundo tema se **suma** al del caso ("Otro tema, para <sector>: …", tope de 4000 caracteres)
y el sector nuevo recibe su **aviso** con el resumen de lo suyo. Si es el mismo sector, o el caso todavía no tenía sector, se
comporta como siempre (`agent_handoff_case`, migración `20261026140000`).

## Alternativas descartadas por ahora
- **Varios casos abiertos por conversación (uno por tema):** es la solución correcta, pero toca el índice único y todo lo que
  asume un caso por conversación (bandeja, tablero, panel del caso, seguimientos, agente, unir contactos, vistas). Es un
  cambio grande que conviene hacer con el dueño del proyecto mirando el diseño de la pantalla.
- **Cerrar el caso anterior y abrir otro:** el primer sector perdería un caso en curso.

## Consecuencias
- Nadie pierde un caso, pero el segundo sector ve el tema en un aviso y en el resumen de un caso que no es suyo: puede leerlo
  (lectura abierta, ADR-016) y escribirle a la persona solo si el equipo le asigna el caso. Mientras tanto lo coordinan las personas.
- Pendiente: casos por tema (ver arriba) y que el aviso lleve directo a la conversación.
