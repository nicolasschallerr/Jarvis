# Arquitectura de Jarvis

Documento vivo. Se actualiza al cerrar cada fase. Decisiones de fondo en `docs/decisiones/`.

## Componentes

```
Afiliado ──(WhatsApp)──> Meta Cloud API ──(webhook firmado)──> Vercel: ruta de webhook
                                                                     │ guarda y encola
Operador ──(navegador)──> Vercel: CRM web <──(Realtime)──┐           ▼
                                  │                       │    Supabase de Jarvis
                                  └─────── lee/escribe ───┴──> Postgres + RLS (organization_id)
                                                                 Cola pgmq + pg_cron
                                                                 Realtime, Storage, Auth
                                                                     ▲
pg_cron ──(pg_net)──> Vercel: trabajador ──> lee la cola, llama a la API de Claude,
                                              envía por Meta, escribe en Postgres
                                              consulta la base del cliente (rol acotado)
```

| Pieza | Responsabilidad | Dónde corre |
|---|---|---|
| Ruta de webhook | Verifica la firma de Meta, guarda el mensaje crudo (idempotente) y lo encola. Responde 200 rápido. | Vercel (`src/app/api/...`) |
| Trabajador | Lee lotes cortos de la cola; transcribe audios, ejecuta el agente, envía mensajes, procesa seguimientos y consultas al área. Idempotente. | Vercel (ruta protegida), invocada por `pg_cron` y por el webhook |
| CRM web | Bandeja en tiempo real, casos, sectores, copiloto, paneles. | Vercel (`src/app/...`) |
| Base de Jarvis | Fuente de verdad: organizaciones, usuarios, canales, contactos, conversaciones, mensajes, casos, créditos, trazas de IA. RLS por `organization_id`. | Supabase |
| Cola y cron | Trabajo asincrónico y programado que sobrevive a reinicios. | Supabase (pgmq, pg_cron) |
| Realtime y Storage | Actualización en vivo de la bandeja; audios, imágenes y documentos. | Supabase |
| API de Claude | Agente de atención, resúmenes, clasificación, analítica, evaluación. | Anthropic |
| Base del cliente | Datos propios del cliente; acceso con rol acotado (atención) o solo `SELECT` (analítica). | Supabase del cliente |

## Flujos principales

### 1. Mensaje entrante
1. Meta envía el mensaje al webhook (puede reintentar y repetir).
2. El webhook valida la firma, guarda el mensaje con su identificador de Meta como clave única
   (si ya existe, lo ignora) y encola un trabajo `procesar_mensaje`.
3. Responde 200.
4. El trabajador toma el trabajo: transcribe si es audio, carga el contexto, decide si responde
   la IA o está tomada por un humano, ejecuta el agente y envía la respuesta.
5. Cada paso queda en la base; la bandeja se actualiza por Realtime.

### 2. Derivación a un sector
El agente junta los datos de la gestión, arma el caso, genera el resumen y lo asigna al sector;
cambia el estado a "nuevo" y notifica a los responsables. El historial completo queda en la ficha.

### 3. Consulta asincrónica al área
El agente crea una consulta interna al sector y deja la conversación "esperando área". Cuando el
responsable contesta desde el CRM, un trabajo `responder_consulta` redacta la respuesta y la
envía al afiliado en el mismo chat. Todo el estado vive en la base, por eso sobrevive a reinicios.

### 4. Seguimiento a las 24, 48 y 72 h
Al quedar una gestión a medias se crean filas de seguimiento con su fecha de vencimiento. `pg_cron`
revisa las vencidas y encola los envíos; si la ventana de 24 h de WhatsApp ya cerró, se usa una
plantilla aprobada. Si el afiliado responde antes, los seguimientos pendientes se cancelan.

## Reglas transversales
- Todas las tablas llevan `organization_id` y RLS.
- Los trabajos son idempotentes: procesarlos dos veces no duplica efectos.
- Cada llamada a IA registra modelo, tokens, costo y herramientas usadas.
- Los secretos solo en variables de entorno (ver `.env.example`).
