# ADR-039: WhatsApp, Instagram y Facebook Messenger por un solo camino

**Estado:** aceptada (2026-10-26).

## Contexto
Telegram es solo el canal de desarrollo (ADR-013). El producto tiene que atender por **WhatsApp, Instagram y Facebook
Messenger**, los tres de Meta. Hasta ahora estaba hecha la recepción de WhatsApp; no se podía enviar texto libre por
WhatsApp ni existían los otros dos canales. Meta da un número de prueba gratis y permite probar Messenger e Instagram en
modo desarrollo, así que se puede construir y probar sin esperar la verificación del negocio.

## Decisión
### Un solo webhook y una sola aplicación de Meta
- `/api/webhooks/meta` recibe los tres productos; el cuerpo dice cuál es (`whatsapp_business_account`, `page`,
  `instagram`). `/api/webhooks/whatsapp` sigue respondiendo lo mismo para no romper la configuración existente.
- La firma se valida con `META_APP_SECRET` o `INSTAGRAM_APP_SECRET` (Instagram con inicio de sesión de Instagram tiene su
  propio secreto de aplicación). Se guarda rápido y se procesa aparte, como antes (webhook → `webhook_events` → trabajador).
- Cada evento lleva su prefijo de deduplicación (`msg:` WhatsApp, `fb:` Messenger, `ig:` Instagram, `tg:` Telegram) y el
  trabajador los toma por prefijo. Los ecos (lo que manda la propia página) se ignoran: lo que enviamos ya se guarda al enviarlo.
- El canal se identifica por el id de Meta (`phone_number_id`, id de la página, id de la cuenta de Instagram), igual que
  antes en WhatsApp; no hizo falta tocar el esquema de la base salvo ampliar los nombres de token permitidos.

### Envío
- `sendTextMessage` sigue siendo la única puerta de salida y ahora envía por WhatsApp (Cloud API), Messenger e Instagram
  (Send API, `/me/messages`). Los textos largos se parten solos según el límite de cada canal (WhatsApp 4096 caracteres,
  Messenger 2000, Instagram 1000 bytes) y se corta donde se nota menos.
- **Ventana de 24 h** en los tres canales (`sendMode` en `outbound/rules.ts`). Fuera de ella: WhatsApp pide plantilla;
  Messenger e Instagram no dejan escribir… salvo **respuesta manual de una persona hasta 7 días** con la etiqueta
  `HUMAN_AGENT`, solo si la cuenta lo tiene habilitado (`channels.config.human_agent`). **La IA y el sistema nunca la
  usan**: la etiqueta es para respuestas humanas y usarla de otro modo arriesga la cuenta.
- Instagram admite dos formas de conexión: con inicio de sesión de Instagram (`graph.instagram.com`, por defecto) o con
  el de Facebook (`graph.facebook.com`, token de la página): `channels.config.api`.
- Lo que escribe el agente se adapta al canal antes de enviarse: sin Markdown suelto (WhatsApp usa un asterisco para la
  negrita; los demás, texto plano) y el prompt le dice por qué canal escribe la persona (por ejemplo, que en Instagram y
  Messenger no tiene el teléfono).

### Recepción de adjuntos
- Messenger e Instagram mandan una dirección de descarga de corta vida; WhatsApp manda un id que se cambia por la dirección
  y se baja con el token. Se descarga **solo de los servidores de archivos de Meta** (`fbcdn.net`, `cdninstagram.com`,
  `fbsbx.com`, por https, sin seguir redirecciones, hasta 20 MB): una dirección armada por un tercero no puede hacer que el
  servidor pida otro sitio. Si la descarga falla en un canal de Meta, el mensaje queda guardado, el agente lo ve sin adjunto
  y le pide que lo reenvíe: reintentar horas no sirve porque la dirección caduca.
- El nombre de la persona se pide una sola vez al primer mensaje (el webhook no lo trae); si falla, la ficha queda sin nombre.

### Estados de entrega (WhatsApp)
- Los avisos `sent`/`delivered`/`read`/`failed` actualizan el mensaje que mandó el sistema. **El estado solo avanza**:
  un aviso tardío no lo hace retroceder. Un fallo guarda el código y el motivo en el mensaje.

### Tokens
- Siguen sin guardarse en la base: el canal guarda el **nombre** de la variable de entorno
  (`WHATSAPP_ACCESS_TOKEN…`, `MESSENGER_ACCESS_TOKEN…`, `INSTAGRAM_ACCESS_TOKEN…`, con sufijo por cliente), con la forma
  cerrada que ya exigía la base (ADR-027).

## Alternativas descartadas
- **Un webhook por canal:** triplica la configuración y el código de firma sin ganar nada; Meta permite una misma dirección.
- **Usar la etiqueta de agente humano para el agente de IA:** es una violación de la política de Meta y arriesga perder el
  acceso a la mensajería.
- **Reintentar las descargas de adjuntos:** las direcciones caducan; dejaba al asociado sin respuesta.

## Consecuencias
- Todo está probado con un Meta falso (50 pruebas nuevas entre unitarias y de integración). **Falta conectar cuentas reales**
  y confirmar los puntos que solo Meta responde (qué secreto firma Instagram, límites reales de caracteres, permisos); están
  listados en `docs/guia-conectar-meta.md`.
- Producción exige verificación del negocio y revisión de la app de Meta (días de trámite): hay que iniciarlas ya.
- Pendientes: renovar el token de Instagram (60 días), mensajes que una persona manda desde la app de Meta (hoy los ecos se
  ignoran), botones/reacciones/historias, estados de lectura en Messenger e Instagram y guardar los tokens cifrados en la base
  cuando haya varios clientes.
