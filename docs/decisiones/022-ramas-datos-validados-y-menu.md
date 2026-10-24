# ADR-022: Ramas por carpeta, datos validados, guardián y comando MENÚ

**Estado:** aceptada (2026-10-24). Probada con modelos simulados; falta verla con Claude real.

## Contexto

El cliente piloto describió su atención como un árbol de 8 "ramas" (áreas de negocio) con un menú numerado,
datos obligatorios con reglas de formato, límites de reintentos, un comando para volver al inicio y mensajes
de derivación fijos. El pedido del dueño del proyecto es distinto del menú: que el agente **entienda desde el
primer mensaje a qué área se refiere**, derive al sector correspondiente y **guarde los datos en la base**.
Hay que conservar las reglas del cliente sin convertir al agente en un menú rígido.

## Decisión

- **Una rama es una unidad, con su carpeta.** El conocimiento de cada unidad puede ser un archivo
  (`conocimiento/<unidad>.md`) o una carpeta (`conocimiento/<unidad>/*.md`, unida en orden alfabético); se pueden
  mezclar. Así cada rama separa información, datos a juntar y mensajes fijos.
- **El área se deduce del texto libre.** El prompt del cliente lista las áreas y le pide al agente clasificar
  desde el primer mensaje, preguntar una sola cosa si hay duda y atender de a uno si hay varios temas. Las
  reglas del cliente (tono, qué no inventar, orden de los datos) quedan como límites, no como un menú.
- **Los datos se definen en el YAML del cliente** (`campos`): nombre, regex, ayuda, `limpiar: digitos`, dónde se
  guardan (ficha del asociado: nombre, documento, localidad; o datos del caso), en qué unidades se piden y si son
  obligatorios. Es configuración, no código: un dato nuevo no requiere tocar el producto.
- **La herramienta valida.** `guardar_datos_del_caso` limpia y valida cada dato; guarda lo válido, rechaza lo
  inválido con la ayuda del cliente y **cuenta los intentos fallidos** en el caso (`collected_data._reintentos`).
  Al superar `validacion.reintentos_por_campo` manda derivar a una persona. Los datos que no están definidos se
  guardan tal cual como datos libres.
- **Guardián antes de derivar.** `derivar_a_sector` no deriva si faltan datos obligatorios de la unidad (los
  generales y los propios), salvo `datos_incompletos_ok` para temas sensibles o intentos agotados. Informar no
  exige datos: se responde primero y se piden al derivar.
- **Textos fijos que manda el sistema, sin modelo.** El mensaje oficial de derivación (general o propio de una
  unidad, con `{{sector}}`) lo envía el sistema justo después del mensaje del agente, así sale idéntico siempre.
  Lo mismo el menú principal ante el comando **MENÚ**, que además reinicia los intentos y hace que el historial
  del agente empiece en ese MENÚ (se conserva junto con el menú para entender un "3" que lo contesta).
- **Las "líneas" son los sectores del CRM.** Derivar a la línea correspondiente es derivar al sector de la
  unidad; números de WhatsApp separados dependen de la Fase 14.
- **Los datos del agente quedan visibles**: el resumen y los datos juntados se muestran en el panel del caso, y
  la auditoría de contactos distingue si el cambio lo hizo el agente.
- **Contenido real del cliente solo en `clientes/<slug>/`** (git lo ignora) y sin cargarlo a la base de
  desarrollo hasta definir la región y la privacidad.

## Alternativas descartadas

- **Máquina de estados con menús numerados:** fiel al documento del cliente, pero contradice el pedido de
  entender texto libre y rompe ante mensajes informales o con varios temas.
- **Validar solo con el prompt ("pedí un DNI de 7 u 8 dígitos"):** el modelo se equivoca; la regla en código es
  determinista y se prueba.
- **Que el modelo escriba el mensaje de derivación:** varía de una vez a otra; el cliente lo declaró inmutable.
- **Pedir los datos antes de responder cualquier consulta (como el documento del cliente):** retrasa la respuesta
  de una consulta informativa. Se pide al derivar. Si el cliente exige lo contrario, se ajusta el prompt.

## Consecuencias

- **La obligatoriedad es la misma para todas las unidades donde se pide el dato**: no se puede exigir `motivo`
  solo al pedir un asesor y no al pedir un turno. Queda como dato opcional y lo exige el prompt.
- La derivación siempre pasa por el guardián: si se quiere derivar a pedido del asociado sin todos los datos, el
  agente debe declararlo con `datos_incompletos_ok`.
- Los reintentos se cuentan por caso, no por conversación: un caso nuevo empieza de cero.
- No hay validación de opciones cerradas (por ejemplo, los 4 regalos): se describen en el conocimiento y la
  ayuda; una lista de valores permitidos en `campos` sería la mejora natural.
- Cuando los sectores del cliente no tienen personas cargadas, los avisos no le llegan a nadie: falta cargarlas.
- Ninguna de estas reglas se probó aún con Claude real; se afinan con los evals del cliente.
