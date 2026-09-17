-- Rollback LOCAL/staging de investment-v2 (NO remoto en esta entrega).
-- Conserva filas de financing_scenarios y columnas legacy (montos/resultados).
-- Solo elimina columnas de snapshot v2.

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

-- Nota: tras este rollback, el API investment-v2 rechazará guardados nuevos
-- hasta reaplicar 20260917120000_investment_simulator_assumptions.sql.
-- Los escenarios ya guardados conservan unit_price, applied_interest_rate,
-- annual_expenses, annual_net_cash_flow, etc.
