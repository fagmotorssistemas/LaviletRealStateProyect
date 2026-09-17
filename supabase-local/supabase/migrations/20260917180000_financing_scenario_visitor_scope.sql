-- Scope de escenarios al visitante (lv_vid), no solo al lead deduplicado por teléfono/email.
-- Copia local del stack supabase-local.

ALTER TABLE public.financing_scenarios
  ADD COLUMN IF NOT EXISTS created_by_visitor_key text;

COMMENT ON COLUMN public.financing_scenarios.created_by_visitor_key IS
  'Cookie lv_vid del visitante que guardó el escenario. Listado/borrado público filtra por esta clave; deduplicar lead por teléfono no concede acceso.';

CREATE INDEX IF NOT EXISTS financing_scenarios_visitor_key_idx
  ON public.financing_scenarios (created_by_visitor_key);
