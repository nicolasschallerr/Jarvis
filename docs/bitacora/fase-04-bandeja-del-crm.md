# Fase 4: Bandeja del CRM

**Estado:** cerrada
**Fechas:** 2026-10-23

## Objetivo
Que un operador entre al CRM, vea las conversaciones, lea los mensajes con sus adjuntos, responda y
vea los cambios en vivo, todo respetando el aislamiento por organización.

## Qué se construyó
| Paso | Resultado | Archivos principales |
|---|---|---|
| 4.1 | Parte autenticada: menú lateral, bloque de usuario, cierre de sesión; la raíz redirige a la bandeja | `src/app/(crm)/layout.tsx`, `nav-link.tsx`, `src/lib/auth/profile.ts` (`9eae532`) |
| 4.2 | Lista de conversaciones con la vista `conversation_summaries` | migración `…23130000`, `src/app/(crm)/conversaciones/page.tsx` (`c1027f4`) |
| 4.3 | Conversación: burbujas por remitente, fotos, audios, videos y documentos con URL firmadas | `conversaciones/[id]/page.tsx`, `message-media.tsx` (`e0d44a1`) |
| 4.4 | Responder como operador con validación de rol, organización, largo y reglas del canal | `src/lib/crm/reply.ts`, `[id]/actions.ts`, `reply-form.tsx` (`63d77f5`) |
| 4.5 | Tiempo real con Supabase Realtime y refresco de la página | `src/app/(crm)/live-refresh.tsx`, `scroll-to-end.tsx` (`98c1232`) |

Pruebas: 98 en 15 archivos, todas pasan (nuevas: vista, acceso a adjuntos, respuesta del operador,
Realtime con RLS). `tsc`, `lint` y `build` sin errores.

## Cómo se resolvió
1. Una vista `security_invoker` para no duplicar reglas de seguridad ni tocar la ingesta (ADR-015).
2. La autorización de cada acción vive en una función probada (`sendOperatorReply`), no en la pantalla.
3. Tiempo real simple: escuchar cambios y volver a leer, sin estado de mensajes en el cliente.
4. Verificación con el sitio desplegado y Telegram real en cada paso.

## Problemas encontrados y solución
Ver lecciones 22 a 26: `usePathname()` fuera de `Suspense`, tipos viejos de `.next`, Realtime sin
`wait: true`, un "no aparece" que era de pantalla y no de datos, y comandos largos en el shell.

## Tiempo invertido
[COMPLETAR]

## Qué haría distinto la próxima vez
- Probar `npm run build` después de cada cambio de layout, no solo al final.
- Ante un "no aparece", consultar la base primero.

## Deuda técnica pendiente
- Visibilidad de conversaciones y mensajes por sector (ADR-009): Fase 5.
- Cada evento de Realtime relee la página; fusionar eventos en el cliente si crece la carga.
- Sin paginación de mensajes anteriores (se muestran los últimos 200) ni búsqueda de conversaciones.
- Sin notificaciones sonoras ni contador de no leídos.
- No hay asignación, estados de caso, notas ni ficha del asociado: Fase 5.
- Sin plantillas de Meta para responder fuera de las 24 h de WhatsApp: Fase 9.
- Respuestas solo de texto (sin enviar imágenes, audios o documentos).
- Aspecto básico, sin pasada de diseño ni accesibilidad en profundidad.
