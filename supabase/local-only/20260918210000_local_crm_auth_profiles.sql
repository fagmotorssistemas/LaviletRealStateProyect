-- LOCAL ONLY — bootstrap CRM auth/profiles for supabase_db_frontend.
-- NO aplicar a Production. Destino: 127.0.0.1:54322 (stack frontend).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM (
    'asesor', 'admin', 'contable', 'marketing', 'visitante'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

INSERT INTO public.tenants (id, name, is_active)
VALUES (
  'a1b2c3d4-0001-4000-8000-000000000001',
  'La Vilet',
  true
)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true;

-- projects already exists locally; ensure Lavilet project row
INSERT INTO public.projects (id, tenant_id, name)
VALUES (
  'b1b2c3d4-0001-4000-8000-000000000001',
  'a1b2c3d4-0001-4000-8000-000000000001',
  'EDIFICIO LA VILET'
)
ON CONFLICT (id) DO UPDATE
SET tenant_id = EXCLUDED.tenant_id,
    name = EXCLUDED.name;

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text,
  avatar_url text,
  role public.user_role DEFAULT 'visitante',
  phone text,
  email text,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  whatsapp_number text,
  kommo_user_id text
);

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND is_active IS TRUE
  );
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    'visitante',
    true
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT USING (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
CREATE POLICY profiles_update_own ON public.profiles
  FOR UPDATE
  USING (id = auth.uid() OR public.is_admin())
  WITH CHECK (id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "Authenticated read tenants" ON public.tenants;
CREATE POLICY "Authenticated read tenants" ON public.tenants
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read projects" ON public.projects;
CREATE POLICY "Authenticated read projects" ON public.projects
  FOR SELECT TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated, service_role;
GRANT SELECT ON public.tenants TO authenticated, service_role;
GRANT SELECT ON public.projects TO authenticated, service_role;

-- Scope sondas locales existentes al tenant/proyecto La Vilet (sin bypass is_probe).
UPDATE public.meta_capi_conversion_log
SET
  tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001',
  project_id = 'b1b2c3d4-0001-4000-8000-000000000001'
WHERE tenant_id IS NULL
  AND (
    details->>'is_probe' = 'true'
    OR details->>'probe_kind' = 'isolated_bm_test'
    OR idempotency_key LIKE 'wa_bm_test:%'
  );

COMMIT;
