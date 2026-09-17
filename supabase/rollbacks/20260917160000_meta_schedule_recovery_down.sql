-- Reversión de 20260917160000_meta_schedule_recovery.sql
-- Conserva filas outbox y atribuciones. Solo quita intent/RPC/CHECK ampliado
-- si no hay filas review_hold (o deja review_hold en el CHECK si la migración hold queda).

BEGIN;

DROP FUNCTION IF EXISTS public.lv_recover_missing_meta_schedule_outbox(integer);

ALTER TABLE public.appointments
  DROP COLUMN IF EXISTS meta_schedule_event_id,
  DROP COLUMN IF EXISTS meta_schedule_event_time,
  DROP COLUMN IF EXISTS meta_schedule_delivery_lane,
  DROP COLUMN IF EXISTS meta_schedule_payload,
  DROP COLUMN IF EXISTS meta_schedule_intent_at;

-- Restaura CHECK con review_hold + needs_review (estado post-hold).
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
