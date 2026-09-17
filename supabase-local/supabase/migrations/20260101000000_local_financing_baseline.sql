-- Baseline LOCAL ONLY (supabase-local): tablas mínimas para tour identity + simulador.
-- No reemplaza el esquema remoto completo.

create extension if not exists "pgcrypto";

create or replace function public.normalize_phone(p text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '');
$$;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid,
  name text not null default '',
  phone text,
  email text,
  phone_normalized text,
  status text not null default 'new',
  temperature text not null default 'cold',
  temperature_score integer not null default 0,
  bot_enabled boolean not null default true,
  stage text not null default 'nuevo',
  stage_updated_at timestamptz not null default now(),
  tracking_consent boolean not null default false,
  handoff_status text not null default 'none',
  source text,
  channel_origin text,
  first_utm_source text,
  first_utm_medium text,
  first_utm_campaign text,
  first_salesperson_ref text,
  first_landing_path text,
  first_touch_at timestamptz,
  city text,
  country text,
  last_interaction_at timestamptz,
  meta_ads_consent boolean,
  meta_ads_consent_at timestamptz,
  meta_lead_event_id uuid,
  meta_lead_event_time bigint,
  meta_lead_delivery_lane text,
  meta_lead_payload jsonb,
  meta_lead_visitor_key text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.tour_visitors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  visitor_key text not null,
  lead_id uuid references public.leads(id),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, visitor_key)
);

create table if not exists public.tour_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  session_id text not null,
  lead_id uuid references public.leads(id),
  visitor_id uuid references public.tour_visitors(id),
  unit_id uuid,
  unit_type_id uuid,
  salesperson_id uuid,
  source text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  salesperson_ref text,
  referrer text,
  landing_path text,
  device_type text,
  user_agent text,
  screen_width integer,
  city text,
  country text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  total_seconds integer not null default 0,
  tracking_consent boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.tour_events (
  id uuid primary key default gen_random_uuid(),
  tour_session_id uuid not null references public.tour_sessions(id),
  event_type text not null,
  room text,
  finish_package_id uuid,
  light text,
  seconds integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  visitor_id uuid references public.tour_visitors(id),
  lead_id uuid references public.leads(id),
  unit_type_id uuid
);

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  category text not null default 'departamento',
  unit_number text not null,
  unit_subtype text,
  floor text,
  bedrooms smallint,
  bathrooms numeric,
  published_commercial_price numeric,
  status text not null default 'available',
  is_published boolean not null default true,
  typology_code text,
  floor_number smallint,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.financing_partners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  partner_name varchar not null,
  partner_type varchar,
  annual_interest_rate double precision,
  min_financing_years integer default 5,
  max_financing_years integer default 30,
  processing_days integer,
  contact_phone varchar,
  contact_email varchar,
  contact_person varchar,
  notes text,
  active boolean default true,
  is_recommended boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.financing_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  project_id uuid,
  annual_property_tax double precision default 0.1,
  annual_maintenance double precision default 1200,
  annual_insurance double precision default 400,
  vacancy_rate double precision default 0.05,
  avg_studio_rent double precision default 800,
  avg_one_bed_rent double precision default 1200,
  avg_two_bed_rent double precision default 1800,
  avg_three_bed_rent double precision default 2500,
  default_financing_partner_id uuid references public.financing_partners(id),
  allow_custom_interest_rate boolean default true,
  disclaimer_text text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.financing_scenarios (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  lead_id uuid references public.leads(id),
  unit_id uuid references public.units(id),
  financing_partner_id uuid references public.financing_partners(id),
  project_id uuid,
  down_payment_percent double precision,
  financing_years integer,
  estimated_monthly_rent numeric,
  unit_price numeric,
  down_payment_amount numeric,
  financed_amount numeric,
  applied_interest_rate double precision,
  monthly_payment numeric,
  annual_mortgage_paid numeric,
  annual_expenses numeric,
  annual_gross_rental numeric,
  annual_net_cash_flow numeric,
  roi_percent double precision,
  payback_years double precision,
  breakeven_month integer,
  is_profitable boolean,
  status varchar,
  ip_address inet,
  user_agent text,
  created_by_visitor_key text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- stubs Meta (identify_tour_lead_with_meta_outbox los consulta)
create table if not exists public.meta_ads_consent_ledger (
  id uuid primary key default gen_random_uuid(),
  visitor_key text,
  ads_consent boolean,
  consent_version integer default 1,
  created_at timestamptz default now()
);

create table if not exists public.meta_capi_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text unique,
  event_id uuid,
  event_name text,
  event_time bigint,
  payload jsonb,
  status text,
  delivery_lane text,
  lead_id uuid,
  visitor_key text,
  ads_consent_required boolean,
  last_error text,
  created_at timestamptz default now()
);

create or replace function public.identify_tour_lead(
  p_tenant_id uuid,
  p_visitor_key text,
  p_name text,
  p_email text,
  p_phone text,
  p_project_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_visitor uuid;
  v_lead uuid;
  v_phone text := normalize_phone(p_phone);
  v_first record;
begin
  insert into tour_visitors (tenant_id, visitor_key)
  values (p_tenant_id, p_visitor_key)
  on conflict (tenant_id, visitor_key) do update set last_seen_at = now()
  returning id into v_visitor;

  select s.* into v_first from tour_sessions s
   where s.visitor_id = v_visitor order by s.started_at asc limit 1;

  select l.id into v_lead from leads l
   where l.tenant_id = p_tenant_id
     and ( (v_phone is not null and l.phone_normalized = v_phone)
        or (p_email is not null and lower(l.email) = lower(p_email)) )
   order by l.created_at asc limit 1;

  if v_lead is null then
    insert into leads (
      tenant_id, project_id, name, email, phone, phone_normalized,
      source, channel_origin,
      first_utm_source, first_utm_medium, first_utm_campaign,
      first_salesperson_ref, first_landing_path, first_touch_at, city, country
    ) values (
      p_tenant_id, p_project_id, p_name, p_email, p_phone, v_phone,
      'showroom_360', 'web',
      v_first.utm_source, v_first.utm_medium, v_first.utm_campaign,
      v_first.salesperson_ref, v_first.landing_path, v_first.started_at,
      v_first.city, v_first.country
    ) returning id into v_lead;
  else
    update leads set
      email = coalesce(email, p_email),
      phone = coalesce(phone, p_phone),
      phone_normalized = coalesce(phone_normalized, v_phone),
      updated_at = now()
    where id = v_lead;
  end if;

  update tour_visitors set lead_id = v_lead, last_seen_at = now() where id = v_visitor;
  update tour_events   set lead_id = v_lead where visitor_id = v_visitor;
  update tour_sessions set lead_id = v_lead where visitor_id = v_visitor;

  insert into tour_events (tour_session_id, visitor_id, lead_id, event_type, metadata)
  select v_first.id, v_visitor, v_lead, 'lead_identificado', '{}'::jsonb
  where v_first.id is not null;

  update leads set last_interaction_at = now() where id = v_lead;
  return v_lead;
end
$function$;

create or replace function public.identify_tour_lead_with_meta_outbox(
  p_tenant_id uuid,
  p_visitor_key text,
  p_name text,
  p_email text,
  p_phone text,
  p_project_id uuid,
  p_ads_consent boolean default false,
  p_event_id uuid default null,
  p_event_time bigint default null,
  p_delivery_lane text default null,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_lead_id uuid;
begin
  v_lead_id := public.identify_tour_lead(
    p_tenant_id, p_visitor_key, p_name, p_email, p_phone, p_project_id
  );
  -- Local: no Meta outbox obligatorio
  update public.leads
  set meta_ads_consent = coalesce(p_ads_consent, false),
      meta_ads_consent_at = now()
  where id = v_lead_id;

  return jsonb_build_object(
    'lead_id', v_lead_id,
    'emit_meta_lead', false,
    'meta_event_id', null,
    'meta_event_time', null,
    'outbox_inserted', false
  );
end
$function$;

create or replace function public.start_tour_session(
  p_tenant_id uuid,
  p_visitor_key text,
  p_utm_source text default null,
  p_utm_medium text default null,
  p_utm_campaign text default null,
  p_salesperson_ref text default null,
  p_referrer text default null,
  p_landing_path text default null,
  p_device_type text default null,
  p_user_agent text default null,
  p_screen_width integer default null,
  p_city text default null,
  p_country text default null,
  p_tracking_consent boolean default false
) returns table(visitor_id uuid, session_id uuid)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_visitor uuid;
  v_session uuid;
begin
  insert into tour_visitors (tenant_id, visitor_key)
  values (p_tenant_id, p_visitor_key)
  on conflict (tenant_id, visitor_key) do update set last_seen_at = now()
  returning id into v_visitor;

  insert into tour_sessions (
    tenant_id, visitor_id, session_id, lead_id, source,
    utm_source, utm_medium, utm_campaign, salesperson_ref,
    referrer, landing_path, device_type, user_agent, screen_width,
    city, country, tracking_consent
  )
  select
    p_tenant_id, v_visitor, gen_random_uuid()::text,
    (select lead_id from tour_visitors where id = v_visitor),
    'showroom_360',
    p_utm_source, p_utm_medium, p_utm_campaign, p_salesperson_ref,
    p_referrer, p_landing_path, p_device_type, p_user_agent, p_screen_width,
    p_city, p_country, p_tracking_consent
  returning id into v_session;

  return query select v_visitor, v_session;
end
$function$;

-- Datos sintéticos
insert into public.financing_partners (
  id, tenant_id, partner_name, partner_type, annual_interest_rate,
  min_financing_years, max_financing_years, active, is_recommended
) values (
  'c1c1c1c1-0001-4000-8000-000000000001',
  'a1b2c3d4-0001-4000-8000-000000000001',
  'Banco Local Demo',
  'banco',
  7.8,
  5,
  30,
  true,
  true
) on conflict (id) do nothing;

insert into public.financing_config (
  id, tenant_id, project_id,
  annual_property_tax, annual_maintenance, annual_insurance, vacancy_rate,
  avg_studio_rent, avg_one_bed_rent, avg_two_bed_rent, avg_three_bed_rent,
  default_financing_partner_id, allow_custom_interest_rate, disclaimer_text
) values (
  'd1d1d1d1-0001-4000-8000-000000000001',
  'a1b2c3d4-0001-4000-8000-000000000001',
  'b1b2c3d4-0001-4000-8000-000000000001',
  0.1, 2400, 1480, 0.05,
  800, 1200, 1800, 2500,
  'c1c1c1c1-0001-4000-8000-000000000001',
  true,
  'Simulación local — no es oferta bancaria verificada.'
) on conflict (id) do nothing;

insert into public.units (
  id, tenant_id, project_id, category, unit_number, floor, bedrooms,
  published_commercial_price, status, is_published, typology_code, floor_number
) values
(
  'e1e1e1e1-0001-4000-8000-000000000101',
  'a1b2c3d4-0001-4000-8000-000000000001',
  'b1b2c3d4-0001-4000-8000-000000000001',
  'departamento', '101', '1', 1,
  310000, 'available', true, 'A', 1
),
(
  'e1e1e1e1-0001-4000-8000-000000000202',
  'a1b2c3d4-0001-4000-8000-000000000001',
  'b1b2c3d4-0001-4000-8000-000000000001',
  'departamento', '202', '2', 2,
  280000, 'available', true, 'B', 2
)
on conflict (id) do nothing;
