-- Fase 1, paso 1.6: agentes, trazabilidad de IA, seguimientos, plantillas y envíos masivos,
-- evaluaciones y auditoría.
-- Depende de las tres migraciones anteriores.

create type public.agent_kind as enum (
  'attention', 'copilot', 'summarizer', 'classifier', 'analytic', 'evaluator'
);

create type public.followup_status as enum ('pending', 'sent', 'cancelled', 'skipped');

create type public.template_meta_status as enum (
  'draft', 'submitted', 'approved', 'rejected', 'paused'
);

create type public.broadcast_status as enum (
  'draft', 'scheduled', 'sending', 'done', 'cancelled'
);

-- Costos de Meta por tipo de mensaje (categoría de cobro informada por el proveedor).
alter table public.messages add column pricing jsonb;

-- ---------------------------------------------------------------------------
-- agent_configs: configuración versionada de cada agente por organización.
-- Se carga desde clientes/<slug>/; los cambios estructurales los hace el proveedor.
-- ---------------------------------------------------------------------------

create table public.agent_configs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind public.agent_kind not null,
  version integer not null default 1 check (version > 0),
  -- El modelo es configuración, no una constante en el código.
  model text not null,
  prompt text not null,
  settings jsonb not null default '{}'::jsonb,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organization_id, kind, version)
);

-- Una sola versión activa por organización y tipo de agente.
create unique index agent_configs_active_key
  on public.agent_configs (organization_id, kind) where is_active;

-- ---------------------------------------------------------------------------
-- ai_calls y ai_tool_calls: trazabilidad de cada llamada al modelo
-- ---------------------------------------------------------------------------

create table public.ai_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  case_id uuid references public.cases (id) on delete set null,
  message_id uuid references public.messages (id) on delete set null,
  agent_kind public.agent_kind not null,
  agent_config_id uuid references public.agent_configs (id) on delete set null,
  provider text not null default 'anthropic',
  model text not null,
  input_tokens integer,
  output_tokens integer,
  cache_read_tokens integer,
  cache_write_tokens integer,
  cost_usd numeric(12, 6),
  latency_ms integer,
  stop_reason text,
  request_id text,
  error text,
  -- Decisiones relevantes (derivar, escalar, consultar al área) y detalle opcional. Minimizar:
  -- no guardar datos personales innecesarios y definir un período de retención.
  decision jsonb,
  trace jsonb,
  created_at timestamptz not null default now()
);

create index ai_calls_organization_created_idx
  on public.ai_calls (organization_id, created_at desc);
create index ai_calls_conversation_idx on public.ai_calls (conversation_id);
create index ai_calls_case_idx on public.ai_calls (case_id);

create table public.ai_tool_calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  ai_call_id uuid not null references public.ai_calls (id) on delete cascade,
  tool_name text not null,
  input jsonb,
  output jsonb,
  is_error boolean not null default false,
  duration_ms integer,
  created_at timestamptz not null default now()
);

create index ai_tool_calls_ai_call_idx on public.ai_tool_calls (ai_call_id);

-- ---------------------------------------------------------------------------
-- followups: seguimientos automáticos a las 24, 48 y 72 h (reglas configurables por cliente)
-- ---------------------------------------------------------------------------

create table public.followups (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null references public.cases (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete set null,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  step_hours integer not null check (step_hours > 0),
  due_at timestamptz not null,
  status public.followup_status not null default 'pending',
  sent_at timestamptz,
  message_id uuid references public.messages (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (case_id, step_hours)
);

-- pg_cron busca los vencidos con este índice.
create index followups_due_idx on public.followups (due_at) where status = 'pending';
create index followups_organization_idx on public.followups (organization_id);

-- ---------------------------------------------------------------------------
-- message_templates, broadcasts y broadcast_recipients: plantillas de Meta y envíos masivos
-- ---------------------------------------------------------------------------

create table public.message_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  channel_id uuid references public.channels (id) on delete set null,
  name text not null,
  language text not null default 'es_AR',
  category text,
  body text not null,
  -- Variables {{1}}, {{2}}... con una descripción de cada una.
  variables jsonb not null default '[]'::jsonb,
  meta_status public.template_meta_status not null default 'draft',
  meta_template_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name, language)
);

create trigger message_templates_set_updated_at
  before update on public.message_templates
  for each row execute function private.set_updated_at();

create table public.broadcasts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  template_id uuid not null references public.message_templates (id) on delete restrict,
  name text not null,
  -- Filtros de segmentación. Solo se envía a contactos con consentimiento (opted_in_at).
  segment jsonb not null default '{}'::jsonb,
  status public.broadcast_status not null default 'draft',
  scheduled_at timestamptz,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger broadcasts_set_updated_at
  before update on public.broadcasts
  for each row execute function private.set_updated_at();

create table public.broadcast_recipients (
  broadcast_id uuid not null references public.broadcasts (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  message_id uuid references public.messages (id) on delete set null,
  status public.message_status not null default 'queued',
  error text,
  primary key (broadcast_id, contact_id)
);

create index broadcast_recipients_organization_idx
  on public.broadcast_recipients (organization_id);

-- ---------------------------------------------------------------------------
-- conversation_evaluations: evaluación automática con rúbrica, comparable con el desempeño humano
-- ---------------------------------------------------------------------------

create table public.conversation_evaluations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  case_id uuid references public.cases (id) on delete cascade,
  evaluator text not null check (evaluator in ('ai', 'human')),
  rubric_version text not null,
  resolved_effectively boolean,
  rules_compliance_score numeric(4, 3) check (rules_compliance_score between 0 and 1),
  scores jsonb not null default '{}'::jsonb,
  notes text,
  ai_call_id uuid references public.ai_calls (id) on delete set null,
  created_at timestamptz not null default now(),
  check (conversation_id is not null or case_id is not null)
);

create index conversation_evaluations_org_idx
  on public.conversation_evaluations (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- audit_log: registro de accesos y acciones sobre datos personales (Ley 25.326).
-- Solo se escribe desde el servidor; solo se lee como superadmin. Sin políticas de
-- escritura, nadie puede modificarlo desde el navegador.
-- ---------------------------------------------------------------------------

create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  actor_profile_id uuid references public.profiles (id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_organization_created_idx
  on public.audit_log (organization_id, created_at desc);
create index audit_log_entity_idx on public.audit_log (entity_type, entity_id);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.agent_configs enable row level security;
alter table public.ai_calls enable row level security;
alter table public.ai_tool_calls enable row level security;
alter table public.followups enable row level security;
alter table public.message_templates enable row level security;
alter table public.broadcasts enable row level security;
alter table public.broadcast_recipients enable row level security;
alter table public.conversation_evaluations enable row level security;
alter table public.audit_log enable row level security;

-- agent_configs: solo el superadmin las ve; las edita el proveedor con la clave de servicio.
create policy agent_configs_select on public.agent_configs
  for select to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  );

-- ai_calls, ai_tool_calls, conversation_evaluations: lectura para superadmin y consulta/reportes.
create policy ai_calls_select on public.ai_calls
  for select to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'viewer')
  );

create policy ai_tool_calls_select on public.ai_tool_calls
  for select to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'viewer')
  );

create policy conversation_evaluations_select on public.conversation_evaluations
  for select to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'viewer')
  );

-- followups: la visibilidad se hereda de cases. Las crea y actualiza el servidor.
create policy followups_select on public.followups
  for select to authenticated
  using (exists (select 1 from public.cases c where c.id = case_id));

-- message_templates: todos leen; el alta y el envío a Meta los hace el servidor.
create policy message_templates_select on public.message_templates
  for select to authenticated
  using (organization_id = (select private.current_org_id()));

-- broadcasts y destinatarios: lectura para superadmin y operadores; borradores por operadores.
create policy broadcasts_select on public.broadcasts
  for select to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'operator', 'viewer')
  );

create policy broadcasts_insert on public.broadcasts
  for insert to authenticated
  with check (
    organization_id = (select private.current_org_id())
    and created_by = (select auth.uid())
    and status = 'draft'
    and (select private.current_user_role()) in ('superadmin', 'operator')
  );

create policy broadcasts_update on public.broadcasts
  for update to authenticated
  using (
    organization_id = (select private.current_org_id())
    and status = 'draft'
    and (select private.current_user_role()) in ('superadmin', 'operator')
  )
  with check (
    organization_id = (select private.current_org_id())
    and status in ('draft', 'scheduled')
  );

create policy broadcast_recipients_select on public.broadcast_recipients
  for select to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'operator', 'viewer')
  );

-- audit_log: solo lectura para el superadmin.
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) = 'superadmin'
  );
