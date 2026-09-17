-- Esquema mínimo aislado para probar migraciones/RPC Schedule (no Production).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid()
);

CREATE TABLE public.projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id)
);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  phone text,
  name text,
  email text,
  meta_ads_consent boolean,
  meta_ads_consent_at timestamptz
);

CREATE SEQUENCE IF NOT EXISTS public.meta_ads_consent_version_seq AS bigint START WITH 1;

CREATE TABLE public.meta_ads_consent_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_key text,
  lead_id uuid,
  ads_consent boolean NOT NULL,
  consent_version bigint NOT NULL,
  nest_status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  status text NOT NULL,
  channel text,
  confirmed_by_client boolean,
  confirmed_at timestamptz
);

CREATE TABLE public.meta_capi_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  event_id uuid NOT NULL,
  event_name text NOT NULL CHECK (event_name IN ('ViewContent', 'Lead', 'Schedule')),
  event_time bigint NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'forwarded', 'cancelled', 'dead', 'needs_review')),
  delivery_lane text NOT NULL DEFAULT 'live'
    CHECK (delivery_lane IN ('test', 'live')),
  lead_id uuid,
  visitor_key text,
  ads_consent_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  forwarded_at timestamptz,
  last_error text
);

-- Rol service_role simbólico para GRANT de migraciones.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
END $$;
