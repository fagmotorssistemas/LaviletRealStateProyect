-- Reversión del esquema nuevo. Ejecutar solo si se decide retirar el modelo v6.
ALTER TABLE public.units
  DROP COLUMN IF EXISTS cadastral_value,
  DROP COLUMN IF EXISTS monthly_building_fee,
  DROP COLUMN IF EXISTS estimated_monthly_rent;

ALTER TABLE public.financing_config
  DROP COLUMN IF EXISTS default_tax_profile,
  DROP COLUMN IF EXISTS income_tax_brackets,
  DROP COLUMN IF EXISTS income_tax_table_year,
  DROP COLUMN IF EXISTS company_income_tax_rate,
  DROP COLUMN IF EXISTS management_fee_rate,
  DROP COLUMN IF EXISTS acquisition_cost_pct,
  DROP COLUMN IF EXISTS acquisition_cost_fixed,
  DROP COLUMN IF EXISTS sale_commission_pct,
  DROP COLUMN IF EXISTS default_appreciation_rate,
  DROP COLUMN IF EXISTS rent_growth_rate,
  DROP COLUMN IF EXISTS rental_depreciation_enabled,
  DROP COLUMN IF EXISTS construction_share_pct,
  DROP COLUMN IF EXISTS building_fee_per_m2_monthly;
