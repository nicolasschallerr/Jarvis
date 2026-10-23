# ADR-015: Bandeja del CRM con vista `security_invoker` y tiempo real por refresco

**Estado:** aceptada (complementa el ADR-009 y el ADR-011)

## Contexto
La bandeja necesita, por conversación: contacto, canal, último mensaje y si la ventana de 24 h
sigue abierta, y tiene que actualizarse sin recargar. Los usuarios no pueden escribir mensajes
desde el navegador (RLS); el envío lo hace el servidor.

## Decisión
- Una vista `conversation_summaries` con `security_invoker = true`: se ejecuta con los permisos de
  quien consulta, así que RLS de las tablas de origen sigue aplicando. Sin sesión no se lee nada.
- Los adjuntos se muestran con URL firmadas (1 hora) pedidas con la sesión del usuario; la política
  de Storage solo deja firmar archivos cuya carpeta inicial es su organización.
- Responder es una acción de servidor que valida rol, existencia de la conversación con RLS, largo y
  reglas del canal, y envía con la clave de servicio (`sendTextMessage`) firmando al operador.
  Toda la lógica está en `src/lib/crm/reply.ts`, probada sin depender de la pantalla.
- Tiempo real: el navegador escucha `messages` y `conversations` con Supabase Realtime (con RLS) y,
  ante un cambio, pide a Next `router.refresh()` (con espera de 400 ms para juntar eventos). No se
  guarda estado de mensajes en el cliente.

## Alternativas descartadas
- Mantener la lista de mensajes en el estado del cliente y fusionar eventos: más código y más
  casos de borde (orden, duplicados, reconexiones) para una bandeja que hoy es chica.
- Polling cada pocos segundos: más carga y menos inmediato.
- Denormalizar el último mensaje en `conversations`: obliga a tocar las funciones de ingesta y envío.

## Consecuencias
- Cada evento provoca una relectura de la página (hasta 200 mensajes). Si una conversación muy
  larga o muchos operadores simultáneos lo vuelven pesado, se pasa a fusionar eventos en el cliente.
- La visibilidad de conversaciones y mensajes sigue siendo por organización, no por sector
  (DECISIÓN PENDIENTE del ADR-009): se resuelve en la Fase 5 junto con los casos.
- El rol de consulta ve las conversaciones pero no puede responder.
