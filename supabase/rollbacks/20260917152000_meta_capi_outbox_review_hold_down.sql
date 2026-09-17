-- Alinea con review_hold + needs_review (no elimina needs_review).
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

COMMIT;
