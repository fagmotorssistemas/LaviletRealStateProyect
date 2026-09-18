-- Rent comparables + suggestions (manual source; auto provider pending).
-- Project reference location for La Vilet comps search.

ALTER TABLE public.financing_config
  ADD COLUMN IF NOT EXISTS reference_latitude double precision,
  ADD COLUMN IF NOT EXISTS reference_longitude double precision,
  ADD COLUMN IF NOT EXISTS rent_suggestion_settings jsonb NOT NULL DEFAULT jsonb_build_object(
    'minComparables', 5,
    'maxAgeDays', 90,
    'radiiMeters', jsonb_build_array(500, 1000, 2000),
    'autoSourceStatus', 'pending_configuration',
    'methodVersion', 'rent-suggestion-v1'
  );

UPDATE public.financing_config
SET
  reference_latitude = COALESCE(reference_latitude, -2.8923876),
  reference_longitude = COALESCE(reference_longitude, -79.0301792)
WHERE project_id IS NOT NULL;

COMMENT ON COLUMN public.financing_config.reference_latitude IS
  'Ubicación de referencia del proyecto para radios de comparables (no es fuente de precios).';
COMMENT ON COLUMN public.financing_config.reference_longitude IS
  'Ubicación de referencia del proyecto para radios de comparables (no es fuente de precios).';

ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS published_monthly_rent numeric,
  ADD COLUMN IF NOT EXISTS published_monthly_rent_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_monthly_rent_analysis_id uuid,
  ADD COLUMN IF NOT EXISTS published_monthly_rent_note text;

COMMENT ON COLUMN public.units.published_monthly_rent IS
  'Alquiler mensual publicado/aprobado para el simulador del cliente (solo lectura pública).';

CREATE TABLE IF NOT EXISTS public.rent_comparables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  project_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'manual',
  source_url text,
  external_id text,
  observed_at date NOT NULL DEFAULT CURRENT_DATE,
  listing_date date,
  latitude double precision,
  longitude double precision,
  location_precision text NOT NULL DEFAULT 'approximate'
    CHECK (location_precision IN ('exact', 'approximate', 'sector')),
  location_label text,
  property_type text NOT NULL
    CHECK (property_type IN ('suite', 'departamento', 'penthouse', 'local_comercial')),
  rental_mode text NOT NULL DEFAULT 'monthly'
    CHECK (rental_mode IN ('monthly', 'nightly')),
  price numeric NOT NULL CHECK (price >= 0),
  currency text NOT NULL DEFAULT 'USD',
  price_period text NOT NULL DEFAULT 'month'
    CHECK (price_period IN ('month', 'night', 'year')),
  area_internal_m2 numeric,
  bedrooms integer,
  bathrooms numeric,
  parking_spots integer,
  furnished boolean,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  includes_hoa boolean,
  includes_utilities boolean,
  includes_taxes boolean,
  price_kind text NOT NULL DEFAULT 'listed'
    CHECK (price_kind IN ('listed', 'closed_contract')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'withdrawn', 'stale')),
  normalized_monthly_price numeric,
  duplicate_of uuid REFERENCES public.rent_comparables(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

CREATE INDEX IF NOT EXISTS rent_comparables_project_status_idx
  ON public.rent_comparables (project_id, status, rental_mode, property_type);
CREATE INDEX IF NOT EXISTS rent_comparables_observed_idx
  ON public.rent_comparables (project_id, observed_at DESC);

CREATE TABLE IF NOT EXISTS public.rent_suggestion_analyses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  project_id uuid NOT NULL,
  unit_id uuid NOT NULL REFERENCES public.units(id) ON DELETE CASCADE,
  method_version text NOT NULL DEFAULT 'rent-suggestion-v1',
  suggested_monthly_rent numeric,
  range_low numeric,
  range_high numeric,
  comparable_count integer NOT NULL DEFAULT 0,
  search_radius_m integer,
  max_age_days integer,
  radius_expanded boolean NOT NULL DEFAULT false,
  quality text NOT NULL DEFAULT 'insufficient'
    CHECK (quality IN ('high', 'medium', 'low', 'insufficient')),
  quality_criteria jsonb NOT NULL DEFAULT '{}'::jsonb,
  exclusion_log jsonb NOT NULL DEFAULT '[]'::jsonb,
  used_comparable_ids uuid[] NOT NULL DEFAULT '{}',
  insufficient_reason text,
  analyzed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'approved', 'rejected', 'superseded')),
  approved_at timestamptz,
  approved_by uuid,
  approved_monthly_rent numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rent_suggestion_analyses_unit_idx
  ON public.rent_suggestion_analyses (unit_id, analyzed_at DESC);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'units_published_rent_analysis_fkey'
  ) THEN
    ALTER TABLE public.units
      ADD CONSTRAINT units_published_rent_analysis_fkey
      FOREIGN KEY (published_monthly_rent_analysis_id)
      REFERENCES public.rent_suggestion_analyses(id)
      ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN others THEN
  NULL; -- units may already reference or analyses empty
END $$;

ALTER TABLE public.rent_comparables ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rent_suggestion_analyses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rent_comps_admin_select ON public.rent_comparables;
DROP POLICY IF EXISTS rent_comps_admin_insert ON public.rent_comparables;
DROP POLICY IF EXISTS rent_comps_admin_update ON public.rent_comparables;
DROP POLICY IF EXISTS rent_comps_admin_delete ON public.rent_comparables;
CREATE POLICY rent_comps_admin_select ON public.rent_comparables
  FOR SELECT USING (public.is_crm_admin());
CREATE POLICY rent_comps_admin_insert ON public.rent_comparables
  FOR INSERT WITH CHECK (public.is_crm_admin());
CREATE POLICY rent_comps_admin_update ON public.rent_comparables
  FOR UPDATE USING (public.is_crm_admin()) WITH CHECK (public.is_crm_admin());
CREATE POLICY rent_comps_admin_delete ON public.rent_comparables
  FOR DELETE USING (public.is_crm_admin());

DROP POLICY IF EXISTS rent_analyses_admin_select ON public.rent_suggestion_analyses;
DROP POLICY IF EXISTS rent_analyses_admin_insert ON public.rent_suggestion_analyses;
DROP POLICY IF EXISTS rent_analyses_admin_update ON public.rent_suggestion_analyses;
DROP POLICY IF EXISTS rent_analyses_admin_delete ON public.rent_suggestion_analyses;
CREATE POLICY rent_analyses_admin_select ON public.rent_suggestion_analyses
  FOR SELECT USING (public.is_crm_admin());
CREATE POLICY rent_analyses_admin_insert ON public.rent_suggestion_analyses
  FOR INSERT WITH CHECK (public.is_crm_admin());
CREATE POLICY rent_analyses_admin_update ON public.rent_suggestion_analyses
  FOR UPDATE USING (public.is_crm_admin()) WITH CHECK (public.is_crm_admin());
CREATE POLICY rent_analyses_admin_delete ON public.rent_suggestion_analyses
  FOR DELETE USING (public.is_crm_admin());
