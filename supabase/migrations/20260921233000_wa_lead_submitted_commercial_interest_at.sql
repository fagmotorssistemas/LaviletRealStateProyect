-- Sello de interés comercial reciente para LeadSubmitted (secuencia consentimiento).
-- No es backfill: solo se escribe cuando el turno actual expresa interés.

BEGIN;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS meta_wa_commercial_interest_at timestamptz;

COMMENT ON COLUMN public.leads.meta_wa_commercial_interest_at IS
  'Marca el último turno con interés comercial explícito (LeadSubmitted). '
  'Tras aceptación whatsapp_ads dentro de la ventana, permite encolar sin otro mensaje comercial. '
  'La aceptación sola no escribe este sello.';

COMMIT;
