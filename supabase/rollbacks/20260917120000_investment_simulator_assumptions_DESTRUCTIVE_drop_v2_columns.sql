-- =============================================================================
-- ACCIÓN DESTRUCTIVA — NO es la reversión operativa.
-- =============================================================================
-- Uso: solo laboratorio local / limpieza explícita tras backup y confirmación.
-- Pierde snapshots y supuestos v2 (simulation_mode, vacancy, breakdown, etc.).
--
-- Reversión operativa (preserva datos): restaurar la app a 4270bf1 (main pre-PR)
-- o a un commit ≥ abded29 sin ejecutar este archivo.
-- Ver: docs/SIMULADOR_MIGRACION_ORDEN.md
-- =============================================================================

BEGIN;

ALTER TABLE public.financing_scenarios
  DROP COLUMN IF EXISTS monthly_extra_charges,
  DROP COLUMN IF EXISTS acquisition_costs,
  DROP COLUMN IF EXISTS annual_other_financial,
  DROP COLUMN IF EXISTS rate_type,
  DROP COLUMN IF EXISTS calculation_version,
  DROP COLUMN IF EXISTS assumptions_json,
  DROP COLUMN IF EXISTS expense_breakdown,
  DROP COLUMN IF EXISTS annual_income_tax_estimate,
  DROP COLUMN IF EXISTS annual_management,
  DROP COLUMN IF EXISTS vacancy_rate_snapshot,
  DROP COLUMN IF EXISTS simulation_mode;

DROP INDEX IF EXISTS financing_scenarios_mode_idx;

COMMIT;
