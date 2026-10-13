-- Modelo estimativo de inversión para Cuenca/Ecuador. Solo columnas aditivas.
ALTER TABLE public.units
  ADD COLUMN IF NOT EXISTS cadastral_value numeric,
  ADD COLUMN IF NOT EXISTS monthly_building_fee numeric,
  ADD COLUMN IF NOT EXISTS estimated_monthly_rent numeric;

COMMENT ON COLUMN public.units.cadastral_value IS 'Avalúo catastral municipal de la unidad; base del predial y del tope de arriendo (COOTAD, Ley de Inquilinato art. 17).';
COMMENT ON COLUMN public.units.monthly_building_fee IS 'Alícuota mensual real de la unidad, si la administra el proyecto.';
COMMENT ON COLUMN public.units.estimated_monthly_rent IS 'Arriendo mensual de referencia de esta unidad, cargado por el administrador.';

ALTER TABLE public.financing_config
  ADD COLUMN IF NOT EXISTS default_tax_profile text DEFAULT '45_80',
  ADD COLUMN IF NOT EXISTS income_tax_brackets jsonb DEFAULT '[{"from":0,"to":12208,"baseTax":0,"rate":0},{"from":12208,"to":15549,"baseTax":0,"rate":0.05},{"from":15549,"to":20188,"baseTax":167,"rate":0.10},{"from":20188,"to":26700,"baseTax":631,"rate":0.12},{"from":26700,"to":35136,"baseTax":1412,"rate":0.15},{"from":35136,"to":46575,"baseTax":2678,"rate":0.20},{"from":46575,"to":62005,"baseTax":4965,"rate":0.25},{"from":62005,"to":82679,"baseTax":8823,"rate":0.30},{"from":82679,"to":109956,"baseTax":15025,"rate":0.35},{"from":109956,"to":null,"baseTax":24572,"rate":0.37}]'::jsonb,
  ADD COLUMN IF NOT EXISTS income_tax_table_year integer DEFAULT 2026,
  ADD COLUMN IF NOT EXISTS company_income_tax_rate numeric DEFAULT 0.25,
  ADD COLUMN IF NOT EXISTS management_fee_rate numeric DEFAULT 0.08,
  ADD COLUMN IF NOT EXISTS acquisition_cost_pct numeric DEFAULT 1.3,
  ADD COLUMN IF NOT EXISTS acquisition_cost_fixed numeric DEFAULT 500,
  ADD COLUMN IF NOT EXISTS sale_commission_pct numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS default_appreciation_rate numeric DEFAULT 0.03,
  ADD COLUMN IF NOT EXISTS rent_growth_rate numeric DEFAULT 0.02,
  ADD COLUMN IF NOT EXISTS rental_depreciation_enabled boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS construction_share_pct numeric DEFAULT 80,
  ADD COLUMN IF NOT EXISTS building_fee_per_m2_monthly numeric;

COMMENT ON COLUMN public.financing_config.default_tax_profile IS 'Perfil tributario predeterminado del simulador; editable por el visitante.';
COMMENT ON COLUMN public.financing_config.income_tax_brackets IS 'Tabla anual de IR personas naturales del SRI; default ejercicio fiscal 2026, Resolución NAC-DGERCGC25-00000043.';
COMMENT ON COLUMN public.financing_config.income_tax_table_year IS 'Año fiscal de la tabla IR publicada por el SRI; revisar cada enero.';
COMMENT ON COLUMN public.financing_config.company_income_tax_rate IS 'Tarifa de IR de sociedades configurable, expresada como fracción.';
COMMENT ON COLUMN public.financing_config.management_fee_rate IS 'Comisión predeterminada del gestor sobre alquiler efectivo, como fracción.';
COMMENT ON COLUMN public.financing_config.acquisition_cost_pct IS 'Estimación porcentual de alcabala y Registro de la Propiedad en Cuenca.';
COMMENT ON COLUMN public.financing_config.acquisition_cost_fixed IS 'Estimación fija de notaría al adquirir la unidad.';
COMMENT ON COLUMN public.financing_config.sale_commission_pct IS 'Comisión de venta estimada como porcentaje del valor de venta.';
COMMENT ON COLUMN public.financing_config.default_appreciation_rate IS 'Hipótesis anual de apreciación; no es pronóstico.';
COMMENT ON COLUMN public.financing_config.rent_growth_rate IS 'Hipótesis anual de crecimiento del arriendo y gastos de propiedad.';
COMMENT ON COLUMN public.financing_config.rental_depreciation_enabled IS 'Habilita depreciación estimada para el IR de arriendos; validar con contador y norma SRI.';
COMMENT ON COLUMN public.financing_config.construction_share_pct IS 'Fracción estimada de construcción para depreciación de inmuebles arrendados.';
COMMENT ON COLUMN public.financing_config.building_fee_per_m2_monthly IS 'Alícuota mensual por m² como respaldo si no se carga la alícuota de la unidad.';
