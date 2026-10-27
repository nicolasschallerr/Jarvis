-- Catálogo de stock del cliente (ADR-043): lo que tiene disponible para ofrecer (por ejemplo, las propiedades de una
-- inmobiliaria). El agente de atención lo consulta con sus herramientas para responder con datos reales en vez de
-- inventar. Se carga con scripts/cargar-catalogo.mts desde un archivo con el formato genérico de Orbita AI; cómo se
-- lee el sitio de cada cliente es configuración de ese cliente, no código del producto.
--
-- Las columnas cubren lo común de un catálogo inmobiliario (operación, tipo, zona, precio, superficie, ambientes);
-- lo que sea propio de cada fuente va en `details`.

create table public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Identificador del ítem en la fuente del cliente (ej. el id de la ficha en su web). Único por organización.
  external_id text not null,
  url text,
  operation text,
  category text,
  title text not null,
  zone text,
  locality text,
  price numeric,
  currency text,
  -- El precio tal como lo publica el cliente (ej. "$ 600.000 +imp. +exp." o "Consultar").
  price_text text,
  area_m2 numeric,
  bedrooms integer,
  bathrooms integer,
  description text,
  details jsonb not null default '{}'::jsonb,
  photos text[] not null default '{}',
  -- false cuando dejó de aparecer en la fuente: se conserva para que las conversaciones viejas sigan teniendo sentido.
  is_available boolean not null default true,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, external_id)
);

create index catalog_items_org_available_idx on public.catalog_items (organization_id, is_available);

create trigger catalog_items_set_updated_at
  before update on public.catalog_items
  for each row execute function private.set_updated_at();

alter table public.catalog_items enable row level security;

-- El equipo lo ve (página Stock del CRM). Solo el servidor lo escribe (carga del catálogo, con la clave de servicio).
create policy catalog_items_select on public.catalog_items
  for select to authenticated
  using (organization_id = (select private.current_org_id()));
