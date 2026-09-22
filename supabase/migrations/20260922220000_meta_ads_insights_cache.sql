-- Caché de últimos Insights Ads válidos (gasto/jerarquía).
-- Solo service_role escribe/lee desde el embudo server-side.
-- No almacena tokens.

CREATE TABLE IF NOT EXISTS public.meta_ads_insights_cache (
  ad_account_id text NOT NULL,
  entity_level text NOT NULL CHECK (entity_level IN ('ad', 'campaign', 'account')),
  entity_id text NOT NULL,
  period_from date NOT NULL,
  period_to date NOT NULL,
  spend numeric,
  currency text,
  impressions bigint,
  clicks bigint,
  meta_reported_results numeric,
  hierarchy jsonb NOT NULL DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  PRIMARY KEY (ad_account_id, entity_level, entity_id, period_from, period_to)
);

CREATE INDEX IF NOT EXISTS meta_ads_insights_cache_fetched_at_idx
  ON public.meta_ads_insights_cache (fetched_at DESC);

ALTER TABLE public.meta_ads_insights_cache ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.meta_ads_insights_cache FROM PUBLIC;
REVOKE ALL ON TABLE public.meta_ads_insights_cache FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_ads_insights_cache TO service_role;

COMMENT ON TABLE public.meta_ads_insights_cache IS
  'Último snapshot Insights Ads por entidad/período. Si Graph falla, el embudo puede servir datos stale con antigüedad.';
