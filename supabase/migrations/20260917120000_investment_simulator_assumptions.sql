-- Simulador de inversión unificado: conservar supuestos y versión de cálculo.
-- NO aplicar remotamente todavía (preparada según pedido del producto).
--
-- Impacto:
-- - Permite guardar/reabrir tasa manual, vacancia, gastos desglosados, modo manual,
--   tipo de tasa y versión de fórmulas sin reinterpretar escenarios históricos.
-- - El API TypeScript (investment-v2) es la fuente de verdad al guardar; no depende
--   de calculate_investment_analysis para sobrescribir montos.
-- - Columnas nuevas son NULL-able: filas antiguas siguen legibles; al reabrir sin
--   snapshot se usan los valores legacy (applied_interest_rate, annual_expenses).

ALTER TABLE public.financing_scenarios
  ADD COLUMN IF NOT EXISTS simulation_mode text,
  ADD COLUMN IF NOT EXISTS vacancy_rate_snapshot numeric,
  ADD COLUMN IF NOT EXISTS annual_management numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS annual_income_tax_estimate numeric,
  ADD COLUMN IF NOT EXISTS expense_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS assumptions_json jsonb,
  ADD COLUMN IF NOT EXISTS calculation_version text,
  ADD COLUMN IF NOT EXISTS rate_type text,
  ADD COLUMN IF NOT EXISTS annual_other_financial numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS acquisition_costs numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS monthly_extra_charges numeric DEFAULT 0;

COMMENT ON COLUMN public.financing_scenarios.simulation_mode IS
  'cash | financed | manual — no convertir financiado a contado por falta de partner';
COMMENT ON COLUMN public.financing_scenarios.calculation_version IS
  'Versión de fórmulas (p.ej. investment-v2). No reinterpretar con config nueva.';
COMMENT ON COLUMN public.financing_scenarios.assumptions_json IS
  'Snapshot de supuestos al guardar (vacancia, tipo de tasa, exclusión de apreciación).';
COMMENT ON COLUMN public.financing_scenarios.rate_type IS
  'nominal_annual | effective_annual';
COMMENT ON COLUMN public.financing_scenarios.vacancy_rate_snapshot IS
  'Vacancia usada en el cálculo guardado (0–1).';
COMMENT ON COLUMN public.financing_scenarios.expense_breakdown IS
  'Desglose predial/mantenimiento/seguro/otros; total coherente con annual_expenses.';

-- Índice opcional para listados por modo
CREATE INDEX IF NOT EXISTS financing_scenarios_mode_idx
  ON public.financing_scenarios (simulation_mode);
