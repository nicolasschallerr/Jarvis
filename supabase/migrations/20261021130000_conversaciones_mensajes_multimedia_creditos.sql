-- Fase 1, paso 1.4: conversaciones, mensajes, multimedia, eventos de webhook y créditos.
-- Depende de 20261021120000_base_organizaciones_usuarios_canales_contactos.sql.

create extension if not exists btree_gist with schema extensions;

-- ---------------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------------

create type public.message_direction as enum ('inbound', 'outbound');

create type public.message_sender as enum ('contact', 'agent', 'operator', 'system');

create type public.message_type as enum (
  'text', 'audio', 'image', 'document', 'video', 'sticker',
  'location', 'template', 'interactive', 'reaction', 'unsupported'
);

create type public.message_status as enum (
  'queued', 'sent', 'delivered', 'read', 'failed'
);

-- ---------------------------------------------------------------------------
-- conversations: el hilo continuo de un contacto en un canal
-- ---------------------------------------------------------------------------

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  channel_id uuid not null references public.channels (id) on delete restrict,
  -- Interruptor IA: cuando un humano toma el chat, el agente deja de responder.
  ai_enabled boolean not null default true,
  assigned_to uuid references public.profiles (id) on delete set null,
  -- Último mensaje del contacto. La ventana de atención de WhatsApp es last_inbound_at + 24 h;
  -- pasada esa ventana solo se pueden enviar plantillas.
  last_inbound_at timestamptz,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (channel_id, contact_id)
);

create index conversations_organization_id_idx on public.conversations (organization_id);
create index conversations_contact_id_idx on public.conversations (contact_id);
create index conversations_inbox_idx
  on public.conversations (organization_id, last_message_at desc);

create trigger conversations_set_updated_at
  before update on public.conversations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  direction public.message_direction not null,
  sender public.message_sender not null,
  sender_profile_id uuid references public.profiles (id) on delete set null,
  type public.message_type not null default 'text',
  body text,
  -- Audios: texto transcrito y qué servicio lo generó.
  transcription text,
  transcription_provider text,
  template_name text,
  -- Identificador del mensaje en el proveedor (WhatsApp: wamid). Clave de idempotencia:
  -- si Meta reintenta, el mismo mensaje no se guarda dos veces.
  external_id text,
  status public.message_status not null default 'queued',
  status_updated_at timestamptz,
  error jsonb,
  -- Hora del mensaje según el proveedor. El orden de la bandeja usa esta hora, no la de llegada,
  -- porque los eventos pueden llegar fuera de orden.
  provider_timestamp timestamptz,
  -- Carga cruda del proveedor, para auditoría y reproceso.
  raw jsonb,
  created_at timestamptz not null default now()
);

create unique index messages_external_id_key
  on public.messages (organization_id, external_id)
  where external_id is not null;

create index messages_conversation_idx
  on public.messages (conversation_id, provider_timestamp, created_at);
create index messages_organization_id_idx on public.messages (organization_id);

-- ---------------------------------------------------------------------------
-- media_files: archivos guardados en Storage (audios, imágenes, documentos)
-- ---------------------------------------------------------------------------

create table public.media_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  message_id uuid not null references public.messages (id) on delete cascade,
  -- Ruta dentro del bucket: <organization_id>/<conversation_id>/<archivo>
  storage_path text not null unique,
  mime_type text not null,
  size_bytes bigint,
  sha256 text,
  -- Identificador del archivo en el proveedor (se descarga y se guarda; el enlace de Meta vence).
  provider_media_id text,
  created_at timestamptz not null default now()
);

create index media_files_message_id_idx on public.media_files (message_id);
create index media_files_organization_id_idx on public.media_files (organization_id);

-- Bucket privado. Las rutas empiezan con el id de la organización; las políticas lo usan.
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- webhook_events: registro crudo de lo que envía el proveedor (solo servidor)
-- ---------------------------------------------------------------------------

create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations (id) on delete cascade,
  channel_type public.channel_type not null,
  -- Clave que identifica el evento (ej. wamid, o wamid + estado). Evita procesarlo dos veces.
  dedupe_key text not null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (channel_type, dedupe_key)
);

create index webhook_events_pending_idx
  on public.webhook_events (received_at) where processed_at is null;

-- ---------------------------------------------------------------------------
-- conversation_windows: base de la facturación.
-- 1 crédito = 1 conversación de 24 h con un contacto, sin importar mensajes ni canal.
-- ---------------------------------------------------------------------------

create table public.conversation_windows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  initiated_by text not null check (initiated_by in ('contact', 'business')),
  opened_at timestamptz not null default now(),
  expires_at timestamptz not null,
  credits integer not null default 1 check (credits >= 0),
  created_at timestamptz not null default now(),
  check (expires_at = opened_at + interval '24 hours'),
  -- Un contacto no puede tener dos ventanas abiertas a la vez: evita cobrar dos veces.
  exclude using gist (
    contact_id with =,
    tstzrange(opened_at, expires_at) with &&
  )
);

create index conversation_windows_org_idx
  on public.conversation_windows (organization_id, opened_at desc);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.media_files enable row level security;
alter table public.webhook_events enable row level security;
alter table public.conversation_windows enable row level security;

-- conversations: todos leen; operadores y superadmin crean y editan (tomar el chat, interruptor IA).
create policy conversations_select on public.conversations
  for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy conversations_insert on public.conversations
  for insert to authenticated
  with check (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'operator')
  );

create policy conversations_update on public.conversations
  for update to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'operator')
  )
  with check (organization_id = (select private.current_org_id()));

-- messages: todos leen. Nadie escribe desde el navegador: los envíos pasan por el servidor,
-- que valida la ventana de 24 h, registra el consumo y llama a Meta.
create policy messages_select on public.messages
  for select to authenticated
  using (organization_id = (select private.current_org_id()));

-- media_files: lectura por organización.
create policy media_files_select on public.media_files
  for select to authenticated
  using (organization_id = (select private.current_org_id()));

-- Storage: lectura de archivos solo de la propia organización (primera carpeta de la ruta).
create policy media_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = (select private.current_org_id())::text
  );

-- conversation_windows: lectura por organización (panel de consumo). Escritura solo servidor.
create policy conversation_windows_select on public.conversation_windows
  for select to authenticated
  using (organization_id = (select private.current_org_id()));

-- webhook_events: sin políticas para usuarios. Solo el servidor (clave de servicio) accede.

-- ---------------------------------------------------------------------------
-- Realtime: la bandeja se actualiza en vivo (Realtime respeta RLS)
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.conversations;
alter publication supabase_realtime add table public.messages;
