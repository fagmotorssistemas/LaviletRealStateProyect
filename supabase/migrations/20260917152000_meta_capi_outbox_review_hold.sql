-- Preparada para revisión. NO aplicar a Production en este cambio.
-- Permite review_hold SIN eliminar needs_review (estado ya existente).
BEGIN;

ALTER TABLE public.meta_capi_outbox
  DROP CONSTRAINT IF EXISTS meta_capi_outbox_status_check;

ALTER TABLE public.meta_capi_outbox
  ADD CONSTRAINT meta_capi_outbox_status_check
  CHECK (status IN (
    'pending',
    'forwarded',
    'cancelled',
    'dead',
    'needs_review',
    'review_hold'
  ));

COMMENT ON COLUMN public.meta_capi_outbox.status IS
  'pending=cola activa. review_hold=revisión Schedule. needs_review=retenido. forwarded/cancelled/dead=terminal.';

COMMIT;
