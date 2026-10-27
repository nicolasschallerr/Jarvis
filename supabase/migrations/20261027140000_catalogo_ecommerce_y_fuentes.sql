-- Catálogo para e-commerce y fuentes de stock (ADR-045).
--
-- 1) catalog_items gana lo propio de una tienda: SKU, marca y unidades en stock.
-- 2) catalog_sources: de dónde sale el stock de cada organización (una planilla de Google Sheets, un archivo,
--    una web o una base). Cada ítem recuerda de qué fuente vino, así la baja lógica ("ya no está en la fuente")
--    se hace por fuente y una tienda puede combinar varias sin que una pise a la otra.

alter table public.catalog_items
  add column sku text,
  add column brand text,
  -- null = la fuente no informa unidades (solo "disponible"); 0 = agotado.
  add column stock_quantity integer check (stock_quantity is null or stock_quantity >= 0);

create table public.catalog_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('sheet', 'file', 'web', 'supabase')),
  name text not null check (length(name) between 1 and 80),
  -- Lo propio de cada tipo (por ejemplo, la dirección de la planilla). Nunca claves: ver ADR-045.
  config jsonb not null default '{}'::jsonb,
  -- Cada cuántas horas se vuelve a leer; null = solo a mano.
  sync_every_hours integer check (sync_every_hours is null or sync_every_hours between 1 and 168),
  last_synced_at timestamptz,
  last_status text check (last_status in ('ok', 'error')),
  last_message text,
  item_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index catalog_sources_org_idx on public.catalog_sources (organization_id);

create trigger catalog_sources_set_updated_at
  before update on public.catalog_sources
  for each row execute function private.set_updated_at();

alter table public.catalog_sources enable row level security;

-- El equipo ve las fuentes (página Stock). Solo el servidor las crea, lee y sincroniza.
create policy catalog_sources_select on public.catalog_sources
  for select to authenticated
  using (organization_id = (select private.current_org_id()));

alter table public.catalog_items
  add column source_id uuid references public.catalog_sources (id) on delete set null;

create index catalog_items_source_idx on public.catalog_items (source_id);
