# ADR-027: Endurecimiento tras la auditoría

**Estado:** aceptada (2026-10-24).

## Contexto

Con las fases 1 a 7 y el agente analítico construidos, se hizo una auditoría completa de seguridad y lógica. Aparecieron
problemas que RLS sola no cubre (RLS decide qué filas, no qué columnas) y carreras entre procesos que corren en paralelo
(el trabajador cada 10 s, el webhook y las respuestas del área).

## Decisión

1. **Tokens de canal.** `channels.secret_ref` solo lo define el servidor, y solo con la forma de un token de canal
   (`TELEGRAM_BOT_TOKEN…`, `WHATSAPP_ACCESS_TOKEN…`, `CHANNEL_TOKEN…`). El código lee la variable solo si el nombre pasa
   la misma lista (`channelToken`). Antes un superadmin podía apuntar su canal a la variable de otro cliente o a la clave de
   servicio.
2. **Columnas protegidas.** Un disparador por tabla rechaza, cuando hay una persona en la sesión, los cambios en columnas
   que solo escribe el sistema: las referencias (organización, canal, contacto, caso), las marcas de tiempo de la
   conversación (`last_inbound_at` decide la ventana de 24 h), el turno del agente, el consentimiento y las marcas de
   unión de un contacto, y de las consultas al área y los avisos todo menos la respuesta o la lectura. Una persona solo
   puede cambiar lo que su pantalla cambia. Las funciones de la base (`security definer`, como `merge_contacts`) no
   quedan alcanzadas: el disparador solo actúa cuando `current_user` es `authenticated` (lección 47).
3. **Turno del agente por conversación.** `claim_agent_turn` / `release_agent_turn` con vencimiento (120 s). Si entran
   mensajes mientras responde, la misma ejecución los toma (hasta 3 vueltas). Evita respuestas duplicadas cuando dos
   pasadas se superponen.
4. **Respuestas del área con tope.** Cada consulta respondida se intenta enviar hasta 3 veces (`reply_attempts`,
   `reply_error`); antes de llamar al modelo se verifica que el canal pueda enviar (`checkSendable`), para no pagar una
   redacción que no va a salir.
5. **Registro sin datos personales.** Lo que se guarda de cada herramienta del agente (`ai_calls`) es la forma, no el
   contenido: de "guardar datos" solo los nombres de los datos; de "derivar", sector y prioridad.
6. **Datos libres acotados.** Los datos que el agente guarda sin definición previa tienen nombres simples (letras,
   números y guion bajo, hasta 40), no pueden empezar con "_" (son internos), hasta 30 por caso y 500 caracteres por valor.
7. **Otros arreglos.** Mensajes fallidos fuera del historial que ve el modelo; orden por la hora del canal; deduplicación
   de Telegram por bot; zona horaria de la organización tomada del archivo del cliente.

## Alternativas descartadas

- **Revocar `update` y pasar todo por funciones de la base:** más seguro en teoría, pero obliga a reescribir cada
  formulario del CRM. Los disparadores cubren el mismo riesgo con menos cambios.
- **Candado en memoria del proceso:** no sirve en Vercel (cada invocación es otro proceso).

## Consecuencias

- Al agregar una columna hay que decidir si la puede cambiar una persona; si no, va a `private.guard_user_columns`.
- Los cambios de esas columnas desde scripts o el trabajador siguen funcionando (entran sin usuario).
- Pruebas: `tests/endurecimiento.test.ts`.
