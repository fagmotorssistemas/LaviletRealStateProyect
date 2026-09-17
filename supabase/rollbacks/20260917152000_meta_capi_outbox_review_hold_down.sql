-- Reversión de 20260917152000_meta_capi_outbox_review_hold.sql
-- Solo si no hay filas con status=review_hold.
BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.meta_capi_outbox WHERE status = 'review_hold' LIMIT 1
  ) THEN
    RAISE EXCEPTION 'Cannot rollback: meta_capi_outbox still has review_hold rows';
  END IF;
END $$;

ALTER TABLE public.meta_capi_outbox
  DROP CONSTRAINT IF EXISTS meta_capi_outbox_status_check;

ALTER TABLE public.meta_capi_outbox
  ADD CONSTRAINT meta_capi_outbox_status_check
  CHECK (status IN ('pending', 'forwarded', 'cancelled', 'dead'));

COMMENT ON COLUMN public.meta_capi_outbox.status IS
  'pending=cola activa (flush/Nest). forwarded/cancelled/dead=terminal.';

COMMIT;
