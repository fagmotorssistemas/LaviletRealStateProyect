-- Currency explícita en cierres de venta (Purchase CAPI).
-- Históricos quedan NULL (no inventar USD). Nuevos cierres deben setear ISO-4217.

BEGIN;

ALTER TABLE public.unit_sales_closings
  ADD COLUMN IF NOT EXISTS currency text;

ALTER TABLE public.unit_sales_closings
  DROP CONSTRAINT IF EXISTS unit_sales_closings_currency_iso4217;

ALTER TABLE public.unit_sales_closings
  ADD CONSTRAINT unit_sales_closings_currency_iso4217
  CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$');

COMMENT ON COLUMN public.unit_sales_closings.currency IS
  'ISO-4217. NULL = desconocida (históricos). Obligatoria para activar CAPI Purchase.';

COMMIT;
