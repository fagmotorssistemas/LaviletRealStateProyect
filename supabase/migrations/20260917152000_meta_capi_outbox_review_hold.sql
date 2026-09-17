-- Preparada para revisión. NO aplicar a Production en este cambio.
-- Permite filas Schedule de revisión que el flush local y el drain Nest no deben enviar.
BEGIN;

ALTER TABLE public.meta_capi_outbox
  DROP CONSTRAINT IF EXISTS meta_capi_outbox_status_check;

ALTER TABLE public.meta_capi_outbox
  ADD CONSTRAINT meta_capi_outbox_status_check
  CHECK (status IN ('pending', 'forwarded', 'cancelled', 'dead', 'review_hold'));

COMMENT ON COLUMN public.meta_capi_outbox.status IS
  'pending=cola activa (flush/Nest). review_hold=solo revisión; consumidores deben excluirla.';

COMMIT;
