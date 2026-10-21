-- Fase 1, paso 1.5: núcleo del CRM. Sectores, unidades de negocio, casos, etiquetas, notas,
-- consultas al área y notificaciones.
-- Depende de las dos migraciones anteriores.

create type public.case_status as enum (
  'new', 'in_progress', 'waiting_contact', 'waiting_area', 'resolved'
);

create type public.case_priority as enum ('low', 'normal', 'high', 'urgent');

create type public.area_query_status as enum (
  'pending', 'answered', 'cancelled', 'expired'
);

-- ---------------------------------------------------------------------------
-- sectors y sector_members: a quién se deriva
-- ---------------------------------------------------------------------------

create table public.sectors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create trigger sectors_set_updated_at
  before update on public.sectors
  for each row execute function private.set_updated_at();

create table public.sector_members (
  sector_id uuid not null references public.sectors (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  is_lead boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (sector_id, profile_id)
);

create index sector_members_profile_idx on public.sector_members (profile_id);
create index sector_members_organization_idx on public.sector_members (organization_id);

-- ---------------------------------------------------------------------------
-- business_units: los motivos de consulta de cada cliente (la lista sale de clientes/<slug>/)
-- ---------------------------------------------------------------------------

create table public.business_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  -- Sector al que se deriva por defecto.
  default_sector_id uuid references public.sectors (id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, slug)
);

create trigger business_units_set_updated_at
  before update on public.business_units
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- Función auxiliar: ¿el usuario pertenece al sector?
-- ---------------------------------------------------------------------------

create or replace function private.is_sector_member(p_sector_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.sector_members
    where sector_id = p_sector_id and profile_id = (select auth.uid())
  )
$$;

revoke all on function private.is_sector_member(uuid) from public, anon;
grant execute on function private.is_sector_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- cases: la gestión armada por el agente o por un operador
-- ---------------------------------------------------------------------------

create table public.cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  unit_id uuid references public.business_units (id) on delete set null,
  sector_id uuid references public.sectors (id) on delete set null,
  status public.case_status not null default 'new',
  priority public.case_priority not null default 'normal',
  assigned_to uuid references public.profiles (id) on delete set null,
  title text,
  -- Resumen generado por IA al derivar.
  summary text,
  -- Datos juntados en la conversación (monto, fechas, destino, etc.). Su forma depende de la unidad.
  collected_data jsonb not null default '{}'::jsonb,
  resolution text,
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index cases_organization_status_idx on public.cases (organization_id, status);
create index cases_sector_status_idx on public.cases (sector_id, status);
create index cases_contact_idx on public.cases (contact_id);
create index cases_assigned_idx on public.cases (assigned_to) where assigned_to is not null;

create trigger cases_set_updated_at
  before update on public.cases
  for each row execute function private.set_updated_at();

-- case_events: historial y trazabilidad de decisiones (derivaciones, cambios de estado).
create table public.case_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  actor_type public.message_sender not null,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  event_type text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index case_events_case_idx on public.case_events (case_id, created_at);

-- ---------------------------------------------------------------------------
-- tags y case_tags
-- ---------------------------------------------------------------------------

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  color text,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table public.case_tags (
  case_id uuid not null references public.cases (id) on delete cascade,
  tag_id uuid not null references public.tags (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (case_id, tag_id)
);

create index case_tags_tag_idx on public.case_tags (tag_id);

-- ---------------------------------------------------------------------------
-- internal_notes: notas internas, nunca visibles para el afiliado
-- ---------------------------------------------------------------------------

create table public.internal_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid references public.cases (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  author_id uuid references public.profiles (id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  check (case_id is not null or conversation_id is not null)
);

create index internal_notes_case_idx on public.internal_notes (case_id);
create index internal_notes_conversation_idx on public.internal_notes (conversation_id);

-- ---------------------------------------------------------------------------
-- area_queries: "consulta al área". El agente pregunta al sector, queda en espera y,
-- cuando un responsable contesta, un trabajo responde al afiliado en el mismo chat.
-- El estado vive acá, por eso el flujo sobrevive a reinicios.
-- ---------------------------------------------------------------------------

create table public.area_queries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  sector_id uuid not null references public.sectors (id) on delete restrict,
  question text not null,
  status public.area_query_status not null default 'pending',
  answer text,
  answered_by uuid references public.profiles (id) on delete set null,
  answered_at timestamptz,
  -- Cuándo se envió al afiliado la respuesta ya redactada (null = todavía no).
  reply_sent_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index area_queries_sector_status_idx on public.area_queries (sector_id, status);
create index area_queries_case_idx on public.area_queries (case_id);
create index area_queries_unsent_idx on public.area_queries (answered_at)
  where status = 'answered' and reply_sent_at is null;

create trigger area_queries_set_updated_at
  before update on public.area_queries
  for each row execute function private.set_updated_at();

-- ---------------------------------------------------------------------------
-- notifications: avisos a los responsables
-- ---------------------------------------------------------------------------

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  type text not null,
  case_id uuid references public.cases (id) on delete cascade,
  title text not null,
  body text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index notifications_profile_idx
  on public.notifications (profile_id, created_at desc) where read_at is null;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.sectors enable row level security;
alter table public.sector_members enable row level security;
alter table public.business_units enable row level security;
alter table public.cases enable row level security;
alter table public.case_events enable row level security;
alter table public.tags enable row level security;
alter table public.case_tags enable row level security;
alter table public.internal_notes enable row level security;
alter table public.area_queries enable row level security;
alter table public.notifications enable row level security;

-- sectors, sector_members, business_units: todos leen; solo el superadmin escribe.
create policy sectors_select on public.sectors
  for select to authenticated
  using (organization_id = (select private.current_org_id()));
create policy sectors_write on public.sectors
  for all to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  )
  with check (organization_id = (select private.current_org_id()));

create policy sector_members_select on public.sector_members
  for select to authenticated
  using (organization_id = (select private.current_org_id()));
create policy sector_members_write on public.sector_members
  for all to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  )
  with check (organization_id = (select private.current_org_id()));

create policy business_units_select on public.business_units
  for select to authenticated
  using (organization_id = (select private.current_org_id()));
create policy business_units_write on public.business_units
  for all to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  )
  with check (organization_id = (select private.current_org_id()));

-- cases: cada responsable ve lo de sus sectores y lo que tiene asignado. Superadmin y
-- consulta/reportes ven todo.
create policy cases_select on public.cases
  for select to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (
      (select private.current_user_role()) in ('superadmin', 'viewer')
      or assigned_to = (select auth.uid())
      or (sector_id is not null and (select private.is_sector_member(sector_id)))
    )
  );

create policy cases_insert on public.cases
  for insert to authenticated
  with check (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'operator')
  );

create policy cases_update on public.cases
  for update to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (
      (select private.current_user_role()) = 'superadmin'
      or (
        (select private.current_user_role()) = 'operator'
        and (
          assigned_to = (select auth.uid())
          or (sector_id is not null and (select private.is_sector_member(sector_id)))
        )
      )
    )
  )
  with check (organization_id = (select private.current_org_id()));

create policy cases_delete on public.cases
  for delete to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  );

-- Tablas hijas: la visibilidad se hereda de cases (la subconsulta ya pasa por su RLS).
create policy case_events_select on public.case_events
  for select to authenticated
  using (exists (select 1 from public.cases c where c.id = case_id));

create policy case_tags_select on public.case_tags
  for select to authenticated
  using (exists (select 1 from public.cases c where c.id = case_id));
create policy case_tags_write on public.case_tags
  for all to authenticated
  using (
    exists (select 1 from public.cases c where c.id = case_id)
    and (select private.current_user_role()) in ('superadmin', 'operator')
  )
  with check (
    organization_id = (select private.current_org_id())
    and exists (select 1 from public.cases c where c.id = case_id)
  );

create policy internal_notes_select on public.internal_notes
  for select to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (
      case_id is null
      or exists (select 1 from public.cases c where c.id = case_id)
    )
  );
create policy internal_notes_insert on public.internal_notes
  for insert to authenticated
  with check (
    organization_id = (select private.current_org_id())
    and author_id = (select auth.uid())
    and (select private.current_user_role()) in ('superadmin', 'operator')
  );

create policy area_queries_select on public.area_queries
  for select to authenticated
  using (exists (select 1 from public.cases c where c.id = case_id));
-- Responde quien pertenece al sector consultado, o el superadmin.
create policy area_queries_update on public.area_queries
  for update to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (
      (select private.current_user_role()) = 'superadmin'
      or (
        (select private.current_user_role()) = 'operator'
        and (select private.is_sector_member(sector_id))
      )
    )
  )
  with check (organization_id = (select private.current_org_id()));

-- tags: todos leen; operadores y superadmin crean.
create policy tags_select on public.tags
  for select to authenticated
  using (organization_id = (select private.current_org_id()));
create policy tags_write on public.tags
  for all to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'operator')
  )
  with check (organization_id = (select private.current_org_id()));

-- notifications: cada usuario ve y marca como leídas solo las suyas. Las crea el servidor.
create policy notifications_select on public.notifications
  for select to authenticated
  using (profile_id = (select auth.uid()));
create policy notifications_update on public.notifications
  for update to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.cases;
alter publication supabase_realtime add table public.area_queries;
alter publication supabase_realtime add table public.notifications;
