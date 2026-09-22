-- Vínculo comercial anuncio Meta → unidad promocionada (tenant/proyecto).
-- Historial: filas vigentes (superseded_at IS NULL) + filas históricas.
-- Varias filas vigentes por ad_id = "Varias unidades". Sin filas = "Unidad no asignada".
-- No se deduce por nombre; asignación explícita por usuario autorizado.

BEGIN;

CREATE TABLE IF NOT EXISTS public.meta_ad_promoted_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  ad_account_id text,
  ad_id text NOT NULL,
  unit_id uuid REFERENCES public.units(id),
  external_label text,
  note text,
  assigned_by uuid REFERENCES auth.users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  superseded_by uuid REFERENCES auth.users(id),
  CONSTRAINT meta_ad_promoted_units_target_chk CHECK (
    unit_id IS NOT NULL OR (external_label IS NOT NULL AND length(trim(external_label)) > 0)
  )
);

CREATE INDEX IF NOT EXISTS meta_ad_promoted_units_active_ad_idx
  ON public.meta_ad_promoted_units (tenant_id, project_id, ad_id)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS meta_ad_promoted_units_active_unit_idx
  ON public.meta_ad_promoted_units (tenant_id, project_id, unit_id)
  WHERE superseded_at IS NULL AND unit_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS meta_ad_promoted_units_active_unit_unique
  ON public.meta_ad_promoted_units (tenant_id, project_id, ad_id, unit_id)
  WHERE superseded_at IS NULL AND unit_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS meta_ad_promoted_units_active_external_unique
  ON public.meta_ad_promoted_units (tenant_id, project_id, ad_id, lower(trim(external_label)))
  WHERE superseded_at IS NULL AND unit_id IS NULL AND external_label IS NOT NULL;

ALTER TABLE public.meta_ad_promoted_units ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.meta_ad_promoted_units FROM PUBLIC;
REVOKE ALL ON TABLE public.meta_ad_promoted_units FROM anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.meta_ad_promoted_units TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_ad_promoted_units TO service_role;

-- Aislamiento fino en app (assertCanAccessCrmPath + tenant/project).
DROP POLICY IF EXISTS meta_ad_promoted_units_select ON public.meta_ad_promoted_units;
CREATE POLICY meta_ad_promoted_units_select
  ON public.meta_ad_promoted_units
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS meta_ad_promoted_units_insert ON public.meta_ad_promoted_units;
CREATE POLICY meta_ad_promoted_units_insert
  ON public.meta_ad_promoted_units
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

DROP POLICY IF EXISTS meta_ad_promoted_units_update ON public.meta_ad_promoted_units;
CREATE POLICY meta_ad_promoted_units_update
  ON public.meta_ad_promoted_units
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.meta_ad_promoted_units IS
  'Unidad (o propiedad externa) que promociona un anuncio Meta. Historial vía superseded_at. Distinto de lead_units (interés del lead).';

COMMIT;
