# ADR-004: Número de prueba de Meta como "línea unificada" durante el desarrollo

**Estado:** aceptada (2026-10-20)

## Contexto

El objetivo es reemplazar las múltiples líneas actuales del cliente por un único número
oficial. Ese número y la verificación del negocio del cliente en Meta todavía no existen.
Registrar un número en la Cloud API lo saca de la app de WhatsApp de ese teléfono.

## Decisión

- **Desarrollo:** el número de prueba que Meta crea automáticamente hace de "línea unificada"
  del cliente; el celular del desarrollador hace de asociado (se agrega a la lista de destinatarios).
- **Piloto con usuarios reales:** un chip prepago descartable, nunca un número personal.
- **Producción:** una línea nueva a nombre del cliente, en su propio portfolio de Meta y verificada.
- El número es **configuración** (tabla de canales con su `phone_number_id`), no código: cambiar
  de número es cambiar una fila.

## Alternativas descartadas

- **Registrar el número personal del desarrollador:** dejaría de funcionar en WhatsApp normal.
- **Migrar ya una de las líneas actuales del cliente:** riesgo sobre la atención en curso y sobre el historial; se planifica en la Fase 14.

## Consecuencias

- Cubre casi todo el desarrollo sin costo ni método de pago.
- Límites: el número de prueba solo trata con destinatarios cargados a mano y no muestra el nombre
  del cliente. Para abrirlo a terceros hacen falta la línea real y la verificación del cliente (Fase 14).
- Pendiente de verificar en la Fase 3: que el número de prueba entregue al webhook los mensajes entrantes.
