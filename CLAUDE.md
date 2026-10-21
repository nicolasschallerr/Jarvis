# Jarvis

@AGENTS.md

## Producto

Jarvis es una plataforma SaaS multi-cliente con tres componentes:

1. **Agente de atención**: atiende a los asociados del cliente por WhatsApp (y luego otros canales)
   24/7, entiende texto, audios, imágenes y PDF, resuelve con la base de conocimiento, junta los
   datos de cada gestión y deriva al sector correcto con un resumen. Puede consultar a un sector
   de forma asincrónica y responder después en el mismo chat.
2. **CRM omnicanal**: bandeja unificada en tiempo real, sectores, estados de caso, copiloto IA,
   ficha del asociado, plantillas de Meta y envíos masivos con consentimiento.
3. **Agente Analítico**: preguntas de negocio en lenguaje natural sobre la base del cliente, solo lectura.

Transversales: consumo por créditos (1 crédito = 1 conversación de 24 h con un contacto),
métricas, evaluación automática de conversaciones, configuración por cliente.

## Arquitectura

- Next.js 16 (App Router, `src/`, alias `@/*`) + TypeScript estricto (`strict`, `noUncheckedIndexedAccess`), deploy en Vercel.
- Base de Jarvis: Supabase propio (Postgres, Auth, RLS, Realtime, Storage, pgvector, pg_cron).
  Multi-tenant: `organization_id` en todas las tablas + RLS.
- Base del cliente: separada; el agente accede con permisos acotados, el Agente Analítico con un rol solo `SELECT`.
- IA: Claude API con tool use (`@anthropic-ai/sdk`).
- Canales: WhatsApp Cloud API directa de Meta; luego Instagram, Messenger, email y Telegram.
- Decisiones registradas en `docs/decisiones/` (ADRs). Antes de cambiar una, escribir un ADR nuevo que la reemplace.

## Estructura de carpetas

```
src/                      código del producto (igual para todos los clientes)
supabase/                 config.toml y migraciones SQL versionadas
scripts/                  scripts de soporte (ej. test-claude.mts)
clientes/
  README.md               cómo dar de alta un cliente
  _plantilla/             configuración de ejemplo con datos inventados
  <slug>/                 configuración real: repo privado aparte, IGNORADO por este repo
docs/
  bitacora/               una entrada por fase (fase-XX-nombre.md)
  decisiones/             ADRs numerados (NNN-titulo.md)
  lecciones.md            problemas reales y cómo se resolvieron
  playbook-implementacion.md
.claude/commands/         comandos del proyecto (/cerrar-fase)
```

## Regla de separación producto / cliente

- Nada específico de un cliente en `src/`, `supabase/`, `docs/`, tests ni evals del producto:
  ni nombres de sectores reales, ni textos, prompts, reglas, horarios, responsables, URLs o IDs.
- Todo lo propio de un cliente es configuración en `clientes/<slug>/` y, en runtime, en la base por `organization_id`.
- Si un dato de cliente obliga a tocar código, falta un campo de configuración: se agrega a
  `clientes/_plantilla/` (y al esquema), nunca un `if` por cliente.
- En la documentación del producto se habla de "cliente piloto", sin nombrarlo.

## Confidencialidad (obligatoria)

- Hay un acuerdo de confidencialidad con el cliente piloto. Fuera de `clientes/<slug>/` no puede
  quedar ningún dato real suyo: ni datos de asociados, ni precios internos, ni nombres o contactos
  de responsables, ni detalles de sus sistemas.
- Nunca guardar DNI, teléfonos ni datos personales reales en ningún repo, tampoco en tests o
  evals: siempre datos inventados con formato evidente de prueba ("Ana Prueba", `XX.XXX.XXX`).
- Secretos (API keys, tokens, contraseñas) solo en `.env.local` y en las variables de entorno de
  Vercel. `.gitignore` excluye `.env*`. Si aparece un secreto en el código o en el historial,
  avisar antes de hacer cualquier otra cosa.

## Convenciones

- Código simple y legible por sobre soluciones ingeniosas.
- Commits: conventional commits en español (`feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`),
  un cambio lógico por commit.
- Ramas: `main` estable; trabajo en ramas `tipo/descripcion` (ej. `refactor/separar-producto-cliente`).
- Tags al cerrar cada fase: `fase-XX` (solo con confirmación del dueño del proyecto).
- No inventar APIs, endpoints, parámetros ni precios: verificar en la documentación oficial
  (Meta, Supabase, Anthropic, Vercel). Para Next.js, leer `node_modules/next/dist/docs/`.
- Decisiones de negocio que no se pueden tomar: marcar `DECISIÓN PENDIENTE` y seguir con un valor por defecto.

## Forma de trabajo

- El dueño del proyecto (Nicolás) está aprendiendo: explicar el porqué de cada decisión.
- Una fase a la vez; cada paso con objetivo, por qué, instrucciones exactas, verificación,
  errores comunes y checkpoint. Esperar confirmación antes de seguir.
- Entorno: Windows 11 + PowerShell. Los comandos de `npm`, `npx` y `git` se ejecutan **dentro de
  la carpeta del repo** (`...\Proyecto Jarvis\jarvis`), nunca en la carpeta padre.
- Al terminar una fase: ejecutar `/cerrar-fase`.

## Comandos útiles

```
npm run dev                                          servidor local en http://localhost:3000
npm run build                                        build de producción (incluye chequeo de tipos)
npm run lint                                         ESLint
npx tsc --noEmit                                     chequeo de tipos
npx tsx --env-file=.env.local scripts/test-claude.mts  prueba de la API key de Anthropic
npx supabase migration new <nombre>                  crear una migración
npx supabase db push                                 aplicar migraciones al proyecto enlazado
```
