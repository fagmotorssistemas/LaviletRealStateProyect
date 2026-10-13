-- La tabla ya fue creada en producción desde el SQL Editor. Mantener esta
-- migración idempotente permite incorporarla al historial sin recrearla.
create table if not exists public.construction_updates (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  title text not null,
  description text not null default '',
  media jsonb not null default '[]'::jsonb,
  sort_order integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.construction_updates enable row level security;
grant select, insert, delete on public.construction_updates to service_role;
