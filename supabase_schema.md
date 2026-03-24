-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.appointment_units (
  appointment_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT appointment_units_pkey PRIMARY KEY (appointment_id, unit_id),
  CONSTRAINT appointment_units_appointment_id_fkey FOREIGN KEY (appointment_id) REFERENCES public.appointments(id),
  CONSTRAINT appointment_units_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id)
);
CREATE TABLE public.appointments (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  lead_id uuid,
  responsible_id uuid,
  title text,
  start_time timestamp with time zone NOT NULL,
  end_time timestamp with time zone,
  status text NOT NULL DEFAULT 'pendiente'::text CHECK (status = ANY (ARRAY['pendiente'::text, 'aceptado'::text, 'reprogramado'::text, 'atendido'::text, 'cancelado'::text])),
  office_id uuid,
  project_id uuid,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT appointments_pkey PRIMARY KEY (id),
  CONSTRAINT appointments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT appointments_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id),
  CONSTRAINT appointments_responsible_id_fkey FOREIGN KEY (responsible_id) REFERENCES public.profiles(id),
  CONSTRAINT appointments_office_id_fkey FOREIGN KEY (office_id) REFERENCES public.offices(id),
  CONSTRAINT appointments_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.contract_units (
  contract_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  CONSTRAINT contract_units_pkey PRIMARY KEY (contract_id, unit_id),
  CONSTRAINT contract_units_contract_id_fkey FOREIGN KEY (contract_id) REFERENCES public.contracts(id),
  CONSTRAINT contract_units_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id)
);
CREATE TABLE public.contracts (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  lead_id uuid,
  contract_number text,
  status text NOT NULL DEFAULT 'pendiente'::text CHECK (status = ANY (ARRAY['pendiente'::text, 'firmado'::text, 'anulado'::text])),
  pdf_url text,
  anticipo_amount numeric,
  anticipo_date date,
  anticipo_proof_url text,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT contracts_pkey PRIMARY KEY (id),
  CONSTRAINT contracts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT contracts_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id),
  CONSTRAINT contracts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id)
);
CREATE TABLE public.lead_interactions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  responsible_id uuid,
  type text NOT NULL DEFAULT 'seguimiento'::text CHECK (type = ANY (ARRAY['llamada'::text, 'whatsapp'::text, 'visita'::text, 'propuesta'::text, 'seguimiento'::text, 'email'::text, 'otro'::text])),
  content text,
  result text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT lead_interactions_pkey PRIMARY KEY (id),
  CONSTRAINT lead_interactions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT lead_interactions_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id),
  CONSTRAINT lead_interactions_responsible_id_fkey FOREIGN KEY (responsible_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.lead_units (
  lead_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  priority integer DEFAULT 0,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT lead_units_pkey PRIMARY KEY (lead_id, unit_id),
  CONSTRAINT lead_units_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id),
  CONSTRAINT lead_units_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id)
);
CREATE TABLE public.leads (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  phone text,
  status text NOT NULL DEFAULT 'nuevo'::text CHECK (status = ANY (ARRAY['nuevo'::text, 'interesado'::text, 'en_contacto'::text, 'agendado'::text, 'en_negociacion'::text, 'reservado'::text, 'vendido'::text, 'no_interesado'::text])),
  budget numeric,
  financing boolean DEFAULT false,
  assigned_to uuid,
  source text,
  resume text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  kommo_id integer,
  CONSTRAINT leads_pkey PRIMARY KEY (id),
  CONSTRAINT leads_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT leads_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id)
);
CREATE TABLE public.n8n_chat_histories (
  id bigint NOT NULL DEFAULT nextval('n8n_chat_histories_id_seq'::regclass),
  session_id text,
  message jsonb,
  CONSTRAINT n8n_chat_histories_pkey PRIMARY KEY (id)
);
CREATE TABLE public.offices (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  address text,
  phone text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT offices_pkey PRIMARY KEY (id),
  CONSTRAINT offices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  full_name text,
  avatar_url text,
  role text DEFAULT 'asesor'::text,
  phone text,
  email text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);
CREATE TABLE public.project_salespeople (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  salesperson_id uuid NOT NULL,
  role_in_project text DEFAULT 'asesor'::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT project_salespeople_pkey PRIMARY KEY (id),
  CONSTRAINT project_salespeople_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT project_salespeople_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT project_salespeople_salesperson_id_fkey FOREIGN KEY (salesperson_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.projects (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  address text,
  estimated_projection_date date,
  architects text,
  plan_type text,
  policies_json jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT projects_pkey PRIMARY KEY (id),
  CONSTRAINT projects_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id)
);
CREATE TABLE public.showroom_visit_units (
  showroom_visit_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT showroom_visit_units_pkey PRIMARY KEY (showroom_visit_id, unit_id),
  CONSTRAINT showroom_visit_units_showroom_visit_id_fkey FOREIGN KEY (showroom_visit_id) REFERENCES public.showroom_visits(id),
  CONSTRAINT showroom_visit_units_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id)
);
CREATE TABLE public.showroom_visits (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  salesperson_id uuid,
  -- Origen de la visita (no es el lugar físico).
  -- Valores nuevos:
  -- - organica, redes_sociales, referido, agendada, otro
  -- Valores heredados (compatibilidad con registros previos):
  -- - oficina, proyecto, mixto
  source text DEFAULT 'organica'::text CHECK (source = ANY (ARRAY['organica'::text, 'redes_sociales'::text, 'referido'::text, 'agendada'::text, 'otro'::text, 'oficina'::text, 'proyecto'::text, 'mixto'::text])),
  office_id uuid,
  project_id uuid,
  lead_id uuid,
  client_name text,
  phone text,
  visit_start timestamp with time zone DEFAULT now(),
  visit_end timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT showroom_visits_pkey PRIMARY KEY (id),
  CONSTRAINT showroom_visits_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT showroom_visits_salesperson_id_fkey FOREIGN KEY (salesperson_id) REFERENCES public.profiles(id),
  CONSTRAINT showroom_visits_office_id_fkey FOREIGN KEY (office_id) REFERENCES public.offices(id),
  CONSTRAINT showroom_visits_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id),
  CONSTRAINT showroom_visits_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id)
);
CREATE TABLE public.tenants (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  ruc text,
  address text,
  phone text,
  email text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT tenants_pkey PRIMARY KEY (id)
);
CREATE TABLE public.unit_media (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  unit_id uuid NOT NULL,
  type text DEFAULT 'gallery'::text,
  url text NOT NULL,
  sort_order integer DEFAULT 0,
  CONSTRAINT unit_media_pkey PRIMARY KEY (id),
  CONSTRAINT unit_media_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id)
);
CREATE TABLE public.unit_sales_closings (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  unit_id uuid NOT NULL UNIQUE,
  lead_id uuid,
  sold_by_id uuid,
  published_price_snapshot numeric,
  sale_price_final numeric NOT NULL,
  sale_at timestamp with time zone DEFAULT now(),
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT unit_sales_closings_pkey PRIMARY KEY (id),
  CONSTRAINT unit_sales_closings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT unit_sales_closings_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id),
  CONSTRAINT unit_sales_closings_lead_id_fkey FOREIGN KEY (lead_id) REFERENCES public.leads(id),
  CONSTRAINT unit_sales_closings_sold_by_id_fkey FOREIGN KEY (sold_by_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.units (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id uuid NOT NULL,
  project_id uuid NOT NULL,
  category text NOT NULL DEFAULT 'Departamento'::text,
  unit_number text NOT NULL,
  unit_subtype text,
  floor text,
  area_internal_m2 numeric,
  area_terrace_m2 numeric DEFAULT 0,
  parking_assigned integer DEFAULT 0,
  cost_per_m2_internal numeric,
  published_commercial_price numeric,
  status text NOT NULL DEFAULT 'disponible'::text CHECK (status = ANY (ARRAY['disponible'::text, 'en_preventa'::text, 'reservado'::text, 'en_proceso'::text, 'bajo_contrato'::text, 'vendido'::text, 'deshabilitado'::text])),
  description text,
  slug text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  area_total_m2 numeric,
  area_terrace_covered_m2 numeric DEFAULT 0,
  area_terrace_open_m2 numeric DEFAULT 0,
  CONSTRAINT units_pkey PRIMARY KEY (id),
  CONSTRAINT units_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES public.tenants(id),
  CONSTRAINT units_project_id_fkey FOREIGN KEY (project_id) REFERENCES public.projects(id)
);
CREATE TABLE public.units_embeddings (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  unit_id uuid NOT NULL,
  content text NOT NULL,
  metadata jsonb NOT NULL,
  embedding USER-DEFINED,
  CONSTRAINT units_embeddings_pkey PRIMARY KEY (id),
  CONSTRAINT units_embeddings_unit_id_fkey FOREIGN KEY (unit_id) REFERENCES public.units(id)
);