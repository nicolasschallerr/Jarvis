# ADR-038: Envíos masivos con consentimiento

**Estado:** aceptada (2026-10-25).

## Contexto
La propuesta incluye avisos y campañas con plantillas oficiales. Escribirle en masa a alguien que no aceptó recibirlo
rompe la Ley 25.326, la política de WhatsApp (puede costar la cuenta) y la confianza de los contactos.

## Decisión
### Consentimiento
- **Solo se le escribe en masa a quien aceptó recibir mensajes y no pidió dejar de recibirlos** (`opted_in_at` y
  `opted_out_at`: vigente si aceptó y no se dio de baja después). Se vuelve a comprobar **al enviar a cada persona**, no
  solo al armar la lista: puede haberse dado de baja en el medio.
- **Cómo se registra:** en la ficha del contacto (superadmin u operador), **anotando cómo aceptó** (queda en la auditoría
  con quién lo anotó). Las columnas siguen siendo del servidor (ADR-027): una persona no las marca por su cuenta.
- **Baja por el contacto:** frases inequívocas ("STOP", "no recibir más", "dejar de recibir"…), por coincidencia exacta del
  mensaje entero. Se registra la baja, se confirma por el mismo chat y el agente no contesta ese mensaje.
  **"Baja" a secas no cuenta**: en una mutual o un gremio suele ser darse de baja de un servicio, que es otra gestión y tiene
  que llegar al agente o al equipo.
- Quien pidió no recibir más tampoco recibe plantillas sueltas desde la conversación.

### Envíos
- **Los crea, programa y cancela el superadmin** (escriben a mucha gente y cada conversación se cobra). Las políticas de
  escritura de las personas se quitaron: todo pasa por el servidor, que comprueba el rol.
- **Flujo:** borrador → revisar (a cuántas personas llega, vista previa del mensaje y aviso de costo) → enviar ahora o
  programar → en curso → terminado o cancelado. Nada sale sin confirmar.
- **Plantilla aprobada de un canal de WhatsApp activo.** `{{1}}` o `{{nombre}}` se completa con el primer nombre de cada
  contacto; las demás variables las escribe quien crea el envío. Un contacto sin nombre se omite con el motivo.
- **Filtro** por localidad (los comodines de la base se limpian). Tope de 5.000 destinatarios por envío.
- **El trabajador** (cada 10 segundos): empieza los programados que ya les toca, arma la lista con el consentimiento de ese
  momento y envía un lote de 20 por envío. Los destinatarios se reservan en la base con `skip locked`: dos pasadas a la vez
  **no mandan mensajes dobles** (probado). Una falla pasajera de Meta se reintenta hasta 3 veces; el resto queda "sin
  enviar" con su motivo.
- Cancelar deja sin enviar lo que faltaba (no se puede deshacer lo ya enviado). Todo queda en la auditoría.

## Consecuencias
- Un envío puede consumir hasta tantos créditos como destinatarios: la pantalla lo avisa antes de confirmar.
- Mientras Meta no esté conectado, se probó con un Meta falso; la prueba real necesita el número verificado.
- Falta: segmentos por sector o por estado de caso, medir respuestas a un envío y enviar por otros canales.
