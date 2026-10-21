# ADR-010: Créditos como ventanas de 24 horas por contacto, con restricción de no superposición

**Estado:** aceptada (2026-10-21)

## Contexto

La facturación es por crédito: 1 crédito = 1 conversación de 24 h con un contacto, sin importar la
cantidad de mensajes ni el canal. Los contactos iniciados por el cliente también consumen crédito.
Un error de código que cobre dos veces el mismo contacto es un problema de facturación.

## Decisión

- Tabla `conversation_windows`: una fila por ventana, con `opened_at`, `expires_at` y quién la inició.
- La ventana es por **contacto**, no por canal ni por mensaje.
- `expires_at = opened_at + 24 horas` (restricción `check`).
- Una restricción de exclusión (`btree_gist`) impide que un contacto tenga dos ventanas superpuestas.
- Solo el servidor escribe; el panel de consumo lee desde esta tabla.

## Alternativas descartadas

- **Contar en cada mensaje:** no distingue ventanas y obliga a deducirlas a posteriori.
- **Garantizar la unicidad solo en el código:** una condición de carrera podría crear dos ventanas.
- **Ventana por día calendario:** no coincide con la definición acordada.

## Consecuencias

- El consumo se puede auditar y reconstruir; no se puede cobrar dos veces el mismo período por error.
- La ventana de **atención de WhatsApp** (`conversations.last_inbound_at + 24 h`) es otro concepto
  que se calcula aparte: responder dentro de ella no abre una ventana de crédito nueva.
- Si el modelo de cobro cambia, se modifica esta restricción y la lógica de apertura de ventanas.
