# Diccionario de datos de Jarvis

Esquema `public` de la base de Jarvis (29 tablas, creadas por las migraciones de `supabase/migrations/`).
Todas las tablas llevan `organization_id` y tienen RLS activado. La clave de servicio (servidor)
saltea RLS; el navegador usa siempre la sesión del usuario.

Roles: `superadmin`, `operator`, `viewer` (consulta/reportes). "Servidor" = solo escribe el servidor.

## Base multi-tenant (migración 1)

| Tabla | Qué guarda | Escritura |
|---|---|---|
| `organizations` | Un cliente: slug, nombre, zona horaria, ajustes | Superadmin edita la suya |
| `profiles` | Usuarios del CRM (1:1 con `auth.users`), rol, organización | Superadmin |
| `channels` | Un número o cuenta por canal. `external_id` (ej. `phone_number_id`) determina la organización de un mensaje entrante; `secret_ref` nombra el secreto, nunca lo guarda | Superadmin |
| `contacts` | Ficha única del afiliado: nombre, DNI (opcional), localidad, consentimiento, vínculo con la base del cliente | Superadmin y operador |
| `contact_identities` | Identificador del contacto en cada canal (teléfono, handle, email) | Superadmin y operador |

## Conversaciones y facturación (migración 2)

| Tabla | Qué guarda | Escritura |
|---|---|---|
| `conversations` | Hilo continuo contacto + canal; interruptor IA, asignación, `last_inbound_at` (ventana de 24 h de WhatsApp) | Superadmin y operador |
| `messages` | Mensajes entrantes y salientes. `external_id` único por organización (idempotencia); `provider_timestamp` ordena; `pricing` guarda la categoría de cobro de Meta | Servidor |
| `media_files` | Archivos del bucket privado `media` (audios, imágenes, documentos) | Servidor |
| `webhook_events` | Bandeja de entrada durable: lo que envía el proveedor, con `dedupe_key` único, `claimed_at` y `attempts` (reintentos; se descarta a los 5 intentos) | Servidor (sin acceso desde el navegador) |
| `conversation_windows` | 1 fila = 1 crédito = 1 ventana de 24 h de un contacto; una restricción impide ventanas superpuestas | Servidor |

## Casos y CRM (migración 3)

| Tabla | Qué guarda | Escritura |
|---|---|---|
| `sectors` | Sectores a los que se deriva | Superadmin |
| `sector_members` | Quién integra cada sector | Superadmin |
| `business_units` | Motivos de consulta del cliente, con sector por defecto | Superadmin |
| `cases` | Gestión armada: estado, prioridad, resumen de IA, `collected_data`. Cada responsable ve lo de sus sectores y lo asignado | Superadmin y operador (de su sector) |
| `case_events` | Historial y decisiones sobre el caso | Servidor |
| `tags`, `case_tags` | Etiquetas y su asignación a casos | Superadmin y operador |
| `internal_notes` | Notas internas (nunca llegan al afiliado) | Superadmin y operador |
| `area_queries` | Consulta al área: pregunta, estado, respuesta, `reply_sent_at` (pendiente de enviar al afiliado) | Crea el servidor; responde el sector |
| `notifications` | Avisos a responsables; cada usuario ve solo los suyos | Servidor |

## IA, seguimientos y auditoría (migración 4)

| Tabla | Qué guarda | Escritura |
|---|---|---|
| `agent_configs` | Prompt, modelo y ajustes por agente, versionados; una sola versión activa | Proveedor (servidor) |
| `ai_calls` | Cada llamada al modelo: tokens, costo, latencia, decisión | Servidor |
| `ai_tool_calls` | Herramientas usadas en cada llamada | Servidor |
| `followups` | Seguimientos 24/48/72 h con vencimiento | Servidor |
| `message_templates` | Plantillas de Meta y su estado de aprobación | Servidor |
| `broadcasts`, `broadcast_recipients` | Envíos masivos y destinatarios; operadores solo crean borradores | Servidor (envío) |
| `conversation_evaluations` | Evaluación con rúbrica, de IA o humana | Servidor |
| `audit_log` | Registro de accesos y acciones sobre datos personales | Servidor; lectura solo superadmin |

## Pendiente de diseñar
- Base de conocimiento por unidad con búsqueda semántica (`pgvector`): Fase 7.
- Visibilidad de `conversations` y `messages` por sector (hoy es por organización): ver [ADR-009](decisiones/009-multitenant-rls-y-visibilidad-por-sector.md).

## Funciones de base de datos (solo servidor)
- `claim_webhook_events(prefijo, límite)`: toma un lote de eventos pendientes con `for update skip locked`, cuenta el intento y descarta los que superaron 5.
- `ingest_inbound_message(...)`: en una transacción crea o reutiliza el contacto, la conversación, guarda el mensaje (idempotente por `external_id`), avanza el reloj de la conversación sin retroceder y abre una ventana de crédito si no hay una cubriendo ese momento.
