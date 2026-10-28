-- Movimientos financieros y agente financiero (ADR-049).
--
-- Cada fila es un ingreso o un egreso de la organización: cobrado o pagado ("paid") o todavía pendiente ("pending",
-- con su vencimiento). "Vencido" no se guarda: es un pendiente cuyo vencimiento ya pasó. Lo cargan los procesos del
-- equipo de Orbita AI (importación o demo) con la clave de servicio; las personas solo leen.

create table public.finance_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  category text not null check (char_length(category) between 1 and 80),
  description text not null check (char_length(description) between 1 and 200),
  counterparty text check (char_length(counterparty) <= 120),
  amount numeric(14, 2) not null check (amount > 0),
  occurred_on date not null,
  due_on date,
  status text not null default 'paid' check (status in ('paid', 'pending')),
  created_at timestamptz not null default now(),
  check (status = 'paid' or due_on is not null)
);

create index finance_movements_org_date on public.finance_movements (organization_id, occurred_on);
create index finance_movements_org_pending on public.finance_movements (organization_id, due_on) where status = 'pending';

alter table public.finance_movements enable row level security;

-- Los números de la empresa son de la administración: superadmin y consulta y reportes (igual que Reportes y Consumo).
create policy finance_movements_select on public.finance_movements
  for select to authenticated
  using (
    organization_id = (select private.current_org_id())
    and (select private.current_user_role()) in ('superadmin', 'viewer')
  );

-- Una fila de agente financiero por organización, apagada: lo enciende el superadmin desde Agentes.
insert into public.agents (organization_id, kind, name, tagline, is_enabled)
select o.id, 'finance', 'Finanzas', 'Te cuento cómo vienen los números: ingresos, gastos y lo que falta cobrar.', false
from public.organizations o
on conflict (organization_id, kind) do nothing;

create or replace function private.create_finance_agent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.agents (organization_id, kind, name, tagline)
  values (new.id, 'finance', 'Finanzas', 'Te cuento cómo vienen los números: ingresos, gastos y lo que falta cobrar.')
  on conflict (organization_id, kind) do nothing;
  return new;
end;
$$;

revoke all on function private.create_finance_agent() from public, anon, authenticated;

create trigger organizations_create_finance_agent
  after insert on public.organizations
  for each row execute function private.create_finance_agent();
