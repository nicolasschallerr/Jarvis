# Conectar WhatsApp, Instagram y Facebook Messenger

Orbita AI recibe y responde mensajes de los tres canales de Meta con **un solo webhook** y **una sola aplicación de Meta**. Esta guía es el paso a paso para conectar cuentas reales. El código ya está construido y probado con un Meta falso (ADR-039); lo que falta es configurar Meta y probar con cuentas de verdad.

> Lo que dice esta guía sobre los paneles de Meta está tomado de su documentación oficial, pero Meta cambia los paneles seguido. Si una pantalla no coincide, buscá el mismo concepto con otro nombre y avisame.

## 0. Qué necesitás

| Para | Qué hace falta |
|---|---|
| Todos | Una cuenta de Facebook personal y un **portfolio comercial** (Meta Business). |
| Messenger | Una **página de Facebook** (puede ser una de prueba). |
| Instagram | Una cuenta de Instagram **profesional** (Empresa o Creador). Si la querés vincular a la página, también sirve. |
| WhatsApp | Nada para empezar: Meta da un **número de prueba** gratis. Para producción, un número propio y la verificación del negocio. |

Con la aplicación en **modo desarrollo** podés probar los tres canales **sin verificación de negocio ni revisión de Meta**, pero solo escriben (y reciben respuesta) las personas que tienen un rol en la aplicación (administradores, desarrolladores, testers). Para atender al público hace falta pasar a producción (sección 7).

## 1. Crear la aplicación

1. Entrá a https://developers.facebook.com con tu cuenta y creá una app de tipo **Negocios** (Business).
2. En el panel de la app, agregá los productos: **WhatsApp**, **Messenger** e **Instagram** (con inicio de sesión de Instagram).
3. En **Configuración de la app → Básica** copiá el **secreto de la app**. Va a la variable `META_APP_SECRET` (ya existe en `.env.local` y en Vercel; si creás una app nueva, actualizalo).
4. Si usás Instagram con inicio de sesión de Instagram, ese producto muestra además su propio **secreto de la app de Instagram**: guardalo como `INSTAGRAM_APP_SECRET`. Meta firma con uno u otro; el webhook acepta los dos.

## 2. Webhook (una sola dirección para los tres)

- **URL de devolución de llamada:** `https://orbitaai.vercel.app/api/webhooks/meta`
  (la dirección vieja, `/api/webhooks/whatsapp`, sigue funcionando y hace lo mismo).
- **Token de verificación:** el valor de `META_WEBHOOK_VERIFY_TOKEN` (el mismo que ya usás).

Configurala en cada producto y suscribí estos campos:

| Producto | Dónde | Campo a suscribir |
|---|---|---|
| WhatsApp | WhatsApp → Configuración | `messages` (trae mensajes y estados de entrega) |
| Messenger | Messenger → Configuración de la API | `messages` |
| Instagram | Instagram → Configuración de la API con inicio de sesión de Instagram | `messages` |

Después, **suscribí tu página a la aplicación** (Messenger). Con el token de la página:

```
POST https://graph.facebook.com/v23.0/<ID_DE_LA_PAGINA>/subscribed_apps?subscribed_fields=messages
```

(Authorization: Bearer con el token de la página. Permisos: `pages_messaging` y `pages_manage_metadata`.) Si el webhook falla durante una hora seguida, Meta desactiva la suscripción y hay que volver a crearla.

## 3. Tokens y variables de entorno

El sistema **nunca guarda un token en la base**: el canal guarda solo el *nombre* de la variable de entorno donde está. El nombre tiene que ser uno de estos (con un sufijo si hay más de un canal del mismo tipo):

| Canal | Variable | Qué token es |
|---|---|---|
| WhatsApp | `WHATSAPP_ACCESS_TOKEN` | Token de **usuario del sistema** (permanente): Business Settings → Usuarios del sistema → asignar la app y la cuenta de WhatsApp → generar token con `whatsapp_business_messaging`, `whatsapp_business_management` y `business_management`. El token temporal del panel dura poco. |
| Messenger | `MESSENGER_ACCESS_TOKEN` | Token de acceso de la **página** (Messenger → Configuración → generar token), con `pages_messaging`. |
| Instagram | `INSTAGRAM_ACCESS_TOKEN` | Token de la cuenta de Instagram: Instagram → Configuración de la API → *Generar token* (dura **60 días**: ver "Pendientes"), con `instagram_business_basic` e `instagram_business_manage_messages`. |

Con varios clientes: `INSTAGRAM_ACCESS_TOKEN_CLIENTE1`, `MESSENGER_ACCESS_TOKEN_CLIENTE1`, etc. (mayúsculas y números). Cargalos **en dos lugares**: `.env.local` (para las pruebas) y Vercel (producción). Tokens y secretos los cargás vos; yo no los toco.

## 4. Registrar el canal en Orbita AI

Cada canal se identifica por un id de Meta (no por el teléfono ni el nombre):

| Canal | `--external-id` | Dónde se ve |
|---|---|---|
| WhatsApp | **ID del número de teléfono** (*phone number ID*) | WhatsApp → Configuración de la API |
| Messenger | **ID de la página** | Página de Facebook → Información; o en Messenger → Configuración |
| Instagram | **ID de la cuenta de Instagram** (el mismo `id` que llega en los webhooks) | `GET https://graph.instagram.com/v23.0/me?fields=user_id,username` con el token |

Desde la carpeta `jarvis`:

```bash
npx tsx --env-file=.env.local scripts/crear-canal.mts --org-slug orbita-ai --type messenger --name "Página de prueba" --external-id 123456789012345
npx tsx --env-file=.env.local scripts/crear-canal.mts --org-slug orbita-ai --type instagram --name "Instagram de prueba" --external-id 17841400000000000
npx tsx --env-file=.env.local scripts/crear-canal.mts --org-slug orbita-ai --type whatsapp --name "Número de prueba" --external-id 105000000000000 --waba-id 104000000000000
```

Opciones útiles: `--api facebook_login` (Instagram con el token de la página vinculada, en vez de la cuenta), `--human-agent` (ver sección 6), `--secret-ref INSTAGRAM_ACCESS_TOKEN_CLIENTE1`. Repetir el comando no duplica: completa lo que falte.

## 5. Probar

1. Mandá un mensaje **desde una cuenta con rol en la app** a la página, a la cuenta de Instagram o al número de prueba de WhatsApp.
2. En el CRM (**Conversaciones**) tiene que aparecer en pocos segundos, con el canal correcto (filtro por canal arriba) y el nombre de la persona.
3. Si el agente está encendido, responde solo. Si no aparece nada: mirá en Vercel los registros de `/api/webhooks/meta` (¿llegó el POST? ¿401 = firma?) y la tabla `webhook_events` (columna `error`).
4. Mandá una foto y un audio: se guardan y el agente la ve (los audios necesitan transcriptor, hoy sin proveedor).

## 6. Reglas de cada canal

- **Ventana de 24 horas** (WhatsApp, Messenger e Instagram): solo se puede escribir texto libre dentro de las 24 h desde el último mensaje de la persona. El CRM muestra "Ventana abierta/cerrada". Fuera de ella: en WhatsApp, plantillas aprobadas (Fase 9); en Messenger e Instagram, nada hasta que la persona vuelva a escribir.
- **Respuesta manual hasta 7 días (agente humano):** Messenger e Instagram permiten que **una persona** (nunca la IA) responda entre las 24 h y los 7 días con la etiqueta `HUMAN_AGENT`. Hay que pedirle a Meta el permiso *Human Agent* (App Review); cuando lo tengas, activalo con `--human-agent` en el canal.
- **Largo de los mensajes:** WhatsApp 4096 caracteres, Messenger 2000, Instagram 1000 *bytes*. Un texto más largo se parte solo en varios mensajes.
- **Formato:** el agente escribe sin Markdown; en WhatsApp la negrita sale con un asterisco y en el resto sin símbolos.
- **Teléfono:** WhatsApp lo da; en Instagram y Messenger el agente lo pide con los demás datos.
- **Un contacto por canal:** la misma persona que escribe por WhatsApp y por Instagram aparece como dos contactos; se unen a mano desde la ficha (Fase 12).

## 7. Pasar a producción (atender al público)

Esto es trabajo de Meta, no de código, y suele llevar días:

1. **Verificación del negocio** en Meta Business (documentos de la organización).
2. **Revisión de la app** (*App Review*) para el acceso avanzado a: `pages_messaging` (Messenger), `instagram_business_manage_messages` (Instagram) y `whatsapp_business_messaging` / `whatsapp_business_management` (WhatsApp). Meta pide una política de privacidad pública y un video que muestre el uso.
3. Instagram: **acceso avanzado** si la app va a atender cuentas que no administrás vos.
4. Un **número de WhatsApp propio** del cliente (no puede estar en uso en la app de WhatsApp), con su nombre visible aprobado.
5. Poner la app en modo **Activo/Live**.

## 8. Qué hay que confirmar con cuentas reales

El código sigue la documentación oficial y está probado con respuestas inventadas, pero estos puntos solo se confirman con Meta de verdad (si alguno falla, es un ajuste chico):

- Con qué secreto firma Meta los webhooks de Instagram (se aceptan los dos).
- Que la forma de los webhooks de Instagram es la misma que la de Messenger (según la documentación, lo es).
- Que `POST /me/messages` con el token de la cuenta funciona en `graph.instagram.com` (inicio de sesión de Instagram) y en `graph.facebook.com` (Messenger y Facebook Login).
- Que el nombre de la persona se obtiene con el permiso que tengas; si no, la ficha queda "Sin nombre" (no rompe).
- Los límites de caracteres de cada canal con mensajes reales.

## 9. Pendientes (a propósito fuera de esta entrega)

- **Renovar el token de Instagram** antes de los 60 días (o pasar a *Business Login*, con renovación automática). Hoy es un recordatorio manual.
- **Mensajes que manda una persona desde la app de Meta** (Business Suite, Instagram): hoy no entran al CRM (los "ecos" se ignoran).
- **Botones, respuestas rápidas, reacciones, respuestas a historias, compartidos y reels**: llegan como "mensaje no compatible" y se guardan sin perderse.
- **Lectura y entrega en Messenger e Instagram** (hoy solo hay estados de entrega para WhatsApp).
- **Un token por cliente en variables de entorno** no escala a muchos clientes: a partir de varios clientes conviene guardar los tokens cifrados en la base (Vault).
