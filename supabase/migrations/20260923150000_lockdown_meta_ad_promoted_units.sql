-- The CRM reads and writes this table only through authorized server actions.
-- Keep the table service_role-only; tenant/project checks happen before every
-- service-role operation in the application.

BEGIN;

ALTER TABLE public.meta_ad_promoted_units ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS meta_ad_promoted_units_select ON public.meta_ad_promoted_units;
DROP POLICY IF EXISTS meta_ad_promoted_units_insert ON public.meta_ad_promoted_units;
DROP POLICY IF EXISTS meta_ad_promoted_units_update ON public.meta_ad_promoted_units;

REVOKE ALL ON TABLE public.meta_ad_promoted_units FROM PUBLIC;
REVOKE ALL ON TABLE public.meta_ad_promoted_units FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_ad_promoted_units TO service_role;

COMMENT ON TABLE public.meta_ad_promoted_units IS
  'Unidad promocionada por anuncio Meta. Solo service_role desde acciones server-side; tenant/proyecto/unidad y cuenta Ads se validan antes de cada operación. Historial vía superseded_at.';

COMMIT;