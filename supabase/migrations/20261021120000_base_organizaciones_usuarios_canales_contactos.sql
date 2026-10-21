-- Fase 1, paso 1.3: base multi-tenant.
-- Organizaciones, perfiles de usuario, canales y contactos, con RLS en todas las tablas.
-- Toda tabla de negocio lleva organization_id. Las funciones auxiliares viven en el esquema
-- "private", que no está expuesto por la API de Supabase.

-- ---------------------------------------------------------------------------
-- Esquema privado y funciones auxiliares
-- ---------------------------------------------------------------------------

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create type public.app_role as enum ('superadmin', 'operator', 'viewer');

create type public.channel_type as enum (
  'whatsapp', 'instagram', 'messenger', 'email', 'telegram'
);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------------

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  timezone text not null default 'America/Argentina/Buenos_Aires',
  -- Configuración editable (horarios, textos). La estructura vive en clientes/<slug>/.
  settings jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_set_updated_at
  before update on public.organizations
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- profiles: un usuario de Auth pertenece a una sola organización
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete restrict,
  full_name text not null,
  role public.app_role not null default 'operator',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_organization_id_idx on public.profiles (organization_id);

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

-- Funciones que leen el perfil del usuario autenticado. SECURITY DEFINER para que las
-- políticas de profiles no se llamen a sí mismas en bucle.

create or replace function private.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organization_id
  from public.profiles
  where id = (select auth.uid()) and is_active
$$;

create or replace function private.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select role
  from public.profiles
  where id = (select auth.uid()) and is_active
$$;

revoke all on function private.current_org_id() from public, anon;
revoke all on function private.current_user_role() from public, anon;
grant execute on function private.current_org_id() to authenticated;
grant execute on function private.current_user_role() to authenticated;

-- ---------------------------------------------------------------------------
-- channels: cada número o cuenta por canal. El número es configuración, no código.
-- ---------------------------------------------------------------------------

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  type public.channel_type not null,
  name text not null,
  -- Identificador del canal en el proveedor (WhatsApp: phone_number_id). El webhook lo usa
  -- para saber a qué organización pertenece un mensaje entrante.
  external_id text not null,
  -- Datos NO secretos (WABA id, número visible, etc.).
  config jsonb not null default '{}'::jsonb,
  -- Nombre de la variable de entorno o del secreto que guarda el token. Nunca el token.
  secret_ref text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (type, external_id)
);

create index channels_organization_id_idx on public.channels (organization_id);

create trigger channels_set_updated_at
  before update on public.channels
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- contacts: ficha única del afiliado (una por persona, sin importar el canal)
-- ---------------------------------------------------------------------------

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  display_name text,
  -- Dato personal: solo se completa cuando la gestión lo requiere (minimización, Ley 25.326).
  document_number text,
  locality text,
  -- Consentimiento para notificaciones masivas con plantillas.
  opted_in_at timestamptz,
  opted_out_at timestamptz,
  -- Vínculo opcional con el registro del afiliado en la base del cliente.
  client_record_id text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index contacts_organization_id_idx on public.contacts (organization_id);
create index contacts_document_idx on public.contacts (organization_id, document_number)
  where document_number is not null;

create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- contact_identities: cómo se identifica un contacto en cada canal
-- ---------------------------------------------------------------------------

create table public.contact_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  channel_type public.channel_type not null,
  -- WhatsApp: teléfono en formato internacional sin "+"; otros canales: handle o email.
  identifier text not null,
  created_at timestamptz not null default now(),
  unique (organization_id, channel_type, identifier)
);

create index contact_identities_contact_id_idx on public.contact_identities (contact_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.organizations enable row level security;
alter table public.profiles enable row level security;
alter table public.channels enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_identities enable row level security;

-- organizations: cada usuario ve solo la suya.
create policy organizations_select on public.organizations
  for select to authenticated
  using (id = (select private.current_org_id()));

create policy organizations_update on public.organizations
  for update to authenticated
  using (id = (select private.current_org_id()) and (select private.current_user_role()) = 'superadmin')
  with check (id = (select private.current_org_id()));

-- profiles: todos ven a los de su organización; solo el superadmin gestiona.
create policy profiles_select on public.profiles
  for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy profiles_insert on public.profiles
  for insert to authenticated
  with check (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  );

create policy profiles_update on public.profiles
  for update to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  )
  with check (organization_id = (select private.current_org_id()));

create policy profiles_delete on public.profiles
  for delete to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  );

-- channels: todos leen; solo el superadmin escribe.
create policy channels_select on public.channels
  for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy channels_write on public.channels
  for all to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  )
  with check (organization_id = (select private.current_org_id()));

-- contacts: todos leen; operadores y superadmin crean y editan; solo superadmin borra.
create policy contacts_select on public.contacts
  for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy contacts_insert on public.contacts
  for insert to authenticated
  with check (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'operator')
  );

create policy contacts_update on public.contacts
  for update to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'operator')
  )
  with check (organization_id = (select private.current_org_id()));

create policy contacts_delete on public.contacts
  for delete to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  );

-- contact_identities: mismas reglas que contacts.
create policy contact_identities_select on public.contact_identities
  for select to authenticated
  using (organization_id = (select private.current_org_id()));

create policy contact_identities_insert on public.contact_identities
  for insert to authenticated
  with check (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'operator')
  );

create policy contact_identities_update on public.contact_identities
  for update to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'operator')
  )
  with check (organization_id = (select private.current_org_id()));

create policy contact_identities_delete on public.contact_identities
  for delete to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  );
