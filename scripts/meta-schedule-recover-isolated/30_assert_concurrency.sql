-- Tras dos recovers paralelos: 1 outbox, 1 intent estable, cita intacta.
\set ON_ERROR_STOP on

DO $$
DECLARE
  aid uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
  v_outbox integer;
  v_status text;
  v_eid uuid;
  v_etime bigint;
  v_confirmed_epoch bigint;
BEGIN
  SELECT count(*) INTO v_outbox
  FROM public.meta_capi_outbox
  WHERE idempotency_key = 'schedule:' || aid::text;
  IF v_outbox <> 1 THEN
    RAISE EXCEPTION 'concurrency: expected 1 outbox row, got %', v_outbox;
  END IF;

  SELECT status INTO v_status
  FROM public.meta_capi_outbox
  WHERE idempotency_key = 'schedule:' || aid::text;
  IF v_status <> 'review_hold' THEN
    RAISE EXCEPTION 'concurrency: expected review_hold, got %', v_status;
  END IF;

  SELECT meta_schedule_event_id, meta_schedule_event_time,
         floor(extract(epoch FROM confirmed_at))::bigint
  INTO v_eid, v_etime, v_confirmed_epoch
  FROM public.appointments WHERE id = aid;

  IF v_eid IS NULL OR v_etime IS NULL THEN
    RAISE EXCEPTION 'concurrency: intent missing';
  END IF;
  IF v_etime <> v_confirmed_epoch THEN
    RAISE EXCEPTION 'concurrency: event_time % != confirmed_at epoch %', v_etime, v_confirmed_epoch;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.appointments
    WHERE id = aid AND confirmed_by_client IS TRUE AND status = 'aceptado'
  ) THEN
    RAISE EXCEPTION 'concurrency: appointment mutated';
  END IF;

  RAISE NOTICE 'meta_schedule_concurrency_ok eid=% etime=%', v_eid, v_etime;
END $$;
