# ADR-024: Unir contactos duplicados

**Estado:** aceptada (2026-10-24). Adelanto de la Fase 12.

## Contexto

La misma persona puede escribir por dos canales, o con dos números, y quedar como dos contactos con sus propias
conversaciones y casos. Hasta ahora el CRM solo avisaba "ya hay otra ficha con ese documento" (Fase 5). Hay que poder
unirlas sin perder historial, sin romper la facturación por créditos (ADR-010) y sin que un error deje datos a medias.

## Decisión

- **La unión es una función de la base** (`merge_contacts(conservar, absorber)`) que corre en **una sola transacción**:
  o se une todo o no se toca nada. Solo la ejecuta un superadmin, y lo vuelve a exigir la propia función (no depende de
  la pantalla). Los dos contactos tienen que ser de la misma organización.
- **Qué se mueve al contacto conservado:** las identidades (así un mensaje nuevo del número absorbido cae en él), las
  conversaciones, los casos, los seguimientos y los envíos masivos. Si los dos tienen conversación en el mismo canal, se
  juntan los mensajes, notas, consultas y demás en la del conservado y se elimina la otra.
- **La ficha se completa, no se pisa:** el conservado mantiene sus datos y recibe los que le faltaban; las notas se
  concatenan. Del consentimiento para envíos se conservan la baja más reciente y el alta más reciente.
- **El absorbido no se borra:** queda vacío y marcado (`merged_into`, `merged_at`). Sus **ventanas de crédito siguen a
  su nombre**: son el historial de facturación y no se reescriben ni se superponen con las del conservado (la restricción
  de no superposición del ADR-010 lo impediría). Sus datos personales se vacían porque ya están en el conservado.
- **Un caso abierto por conversación:** si los dos tienen un caso abierto en el mismo canal no se unen (habría que decidir
  cuál sigue); se pide resolver uno antes y no se cambia nada.
- **Queda registrado** en `audit_log` (`contact.merged`) con quién lo hizo y cuánto se movió.
- **Detección:** se proponen como duplicados las fichas con el **mismo documento** ya confirmado; no se adivina por
  nombre. La pantalla de la conversación muestra los candidatos solo al superadmin, con una confirmación explícita
  porque **no se puede deshacer**.

## Alternativas descartadas

- **Borrar el contacto absorbido:** arrastraría su historial de créditos (borrado en cascada) y rompería la
  facturación.
- **Mover también las ventanas de crédito:** chocan con la restricción de no superposición cuando las dos personas
  escribieron el mismo día, y reescribirían el historial de cobro.
- **Detectar duplicados por nombre o teléfono parecido:** falsos positivos; unir mal es peor que no unir.
- **Deshacer la unión:** exigiría guardar una copia del estado anterior; se descartó por ahora y la confirmación
  previa es la protección.

## Consecuencias

- Una unión equivocada **no se revierte**: hay que corregirla a mano. Por eso solo la hace el superadmin y pide confirmar.
- Las ventanas de crédito del contacto absorbido siguen contándose aparte; el consumo total no cambia.
- Los contactos absorbidos quedan en la tabla marcados; cualquier lista nueva de contactos debe excluir `merged_into`.
- Falta: unir desde una búsqueda de contactos (hoy solo desde la ficha de una conversación), detectar duplicados por
  otros datos que confirme el cliente, y poder ver el historial de uniones.
