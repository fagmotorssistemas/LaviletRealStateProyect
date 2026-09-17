-- Consent revoke cancela review_hold Schedule.
\set ON_ERROR_STOP on

DO $$
DECLARE
  tid uuid := gen_random_uuid();
  pid uuid := gen_random_uuid();
  lid uuid := gen_random_uuid();
  eid uuid := gen_random_uuid();
  v_cancelled integer;
  v_status text;
BEGIN
  INSERT INTO public.tenants(id) VALUES (tid);
  INSERT INTO public.projects(id, tenant_id) VALUES (pid, tid);
  INSERT INTO public.leads(id, tenant_id, project_id, phone, meta_ads_consent)
  VALUES (lid, tid, pid, '593990000088', true);

  INSERT INTO public.meta_capi_outbox (
    idempotency_key, event_id, event_name, event_time, payload, status,
    delivery_lane, lead_id, ads_consent_required, last_error
  ) VALUES (
    'schedule:consent-hold-test', eid, 'Schedule', 1, '{"action_source":"website"}'::jsonb,
    'review_hold', 'live', lid, true, 'recovered_pre_intent_gap'
  );

  SELECT (public.lv_revoke_meta_ads_consent(lid, NULL) ->> 'cancelled')::integer
  INTO v_cancelled;
  IF v_cancelled < 1 THEN
    RAISE EXCEPTION 'revoke must cancel review_hold, cancelled=%', v_cancelled;
  END IF;

  SELECT status INTO v_status FROM public.meta_capi_outbox
  WHERE idempotency_key = 'schedule:consent-hold-test';
  IF v_status <> 'cancelled' THEN
    RAISE EXCEPTION 'expected cancelled, got %', v_status;
  END IF;

  IF (SELECT meta_ads_consent FROM public.leads WHERE id = lid) IS NOT FALSE THEN
    RAISE EXCEPTION 'lead consent must be false after revoke';
  END IF;

  RAISE NOTICE 'meta_schedule_consent_cancel_review_hold_ok';
END $$;
