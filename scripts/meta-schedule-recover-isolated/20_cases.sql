-- Casos: caída pre-intent, concurrencia, sin duplicados, needs_review, lookback.
\set ON_ERROR_STOP on

DO $$
DECLARE
  tid uuid := gen_random_uuid();
  pid uuid := gen_random_uuid();
  lid_web uuid := gen_random_uuid();
  lid_wa uuid := gen_random_uuid();
  lid_old uuid := gen_random_uuid();
  lid_crm uuid := gen_random_uuid();
  aid_gap uuid := gen_random_uuid();
  aid_wa uuid := gen_random_uuid();
  aid_old uuid := gen_random_uuid();
  aid_crm uuid := gen_random_uuid();
  n1 integer;
  n2 integer;
  v_count integer;
  v_status text;
  v_error text;
  v_eid1 uuid;
  v_eid2 uuid;
  v_etime bigint;
  v_needs integer;
  v_intent jsonb;
  v_confirmed_epoch bigint;
BEGIN
  INSERT INTO public.tenants(id) VALUES (tid);
  INSERT INTO public.projects(id, tenant_id) VALUES (pid, tid);

  INSERT INTO public.leads(id, tenant_id, project_id, phone, name, email, meta_ads_consent) VALUES
    (lid_web, tid, pid, '593990000001', 'Web Client', 'w@x.com', true),
    (lid_wa, tid, pid, '593990000002', 'WA Client', 'wa@x.com', true),
    (lid_old, tid, pid, '593990000003', 'Old Client', 'o@x.com', true),
    (lid_crm, tid, pid, '593990000004', 'Crm Client', 'c@x.com', true);

  INSERT INTO public.appointments(
    id, tenant_id, project_id, lead_id, status, channel,
    confirmed_by_client, confirmed_at
  ) VALUES
    (aid_gap, tid, pid, lid_web, 'aceptado', 'web', true, now() - interval '1 hour'),
    (aid_wa, tid, pid, lid_wa, 'aceptado', 'whatsapp', true, now() - interval '2 hours'),
    (aid_crm, tid, pid, lid_crm, 'aceptado', 'crm', true, now() - interval '3 hours'),
    (aid_old, tid, pid, lid_old, 'aceptado', 'web', true, now() - interval '40 days');

  -- 1) Recover pre-intent (misma forma Nest: solo p_limit).
  n1 := public.lv_recover_missing_meta_schedule_outbox(50);
  IF n1 < 3 THEN
    RAISE EXCEPTION 'expected recover >=3 (web+wa+crm), got %', n1;
  END IF;

  SELECT meta_schedule_event_id, meta_schedule_event_time,
         floor(extract(epoch FROM confirmed_at))::bigint
  INTO v_eid1, v_etime, v_confirmed_epoch
  FROM public.appointments WHERE id = aid_gap;
  IF v_eid1 IS NULL OR v_etime IS NULL THEN
    RAISE EXCEPTION 'intent not created for gap appointment';
  END IF;
  IF v_etime <> v_confirmed_epoch THEN
    RAISE EXCEPTION 'event_time % must equal confirmed_at epoch %', v_etime, v_confirmed_epoch;
  END IF;

  SELECT status, last_error INTO v_status, v_error
  FROM public.meta_capi_outbox WHERE idempotency_key = 'schedule:' || aid_gap::text;
  IF v_status <> 'review_hold' THEN
    RAISE EXCEPTION 'web gap expected review_hold, got %', v_status;
  END IF;
  IF v_error <> 'recovered_pre_intent_gap' THEN
    RAISE EXCEPTION 'expected recovered_pre_intent_gap, got %', v_error;
  END IF;

  SELECT status, last_error INTO v_status, v_error
  FROM public.meta_capi_outbox WHERE idempotency_key = 'schedule:' || aid_wa::text;
  IF v_status <> 'needs_review' OR v_error <> 'whatsapp_schedule_delivery_blocked' THEN
    RAISE EXCEPTION 'whatsapp expected needs_review blocked, got % / %', v_status, v_error;
  END IF;

  SELECT status, last_error INTO v_status, v_error
  FROM public.meta_capi_outbox WHERE idempotency_key = 'schedule:' || aid_crm::text;
  IF v_status <> 'needs_review' OR v_error <> 'channel_pending_evidence' THEN
    RAISE EXCEPTION 'crm expected channel_pending_evidence, got % / %', v_status, v_error;
  END IF;

  SELECT count(*) INTO v_count FROM public.meta_capi_outbox
  WHERE idempotency_key = 'schedule:' || aid_old::text;
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'old appointment must not be recovered';
  END IF;

  -- 2) Sin duplicados (secuencial; la concurrencia real está en run.ps1).
  n2 := public.lv_recover_missing_meta_schedule_outbox(50);
  IF n2 <> 0 THEN
    RAISE EXCEPTION 'second recover must be 0, got %', n2;
  END IF;
  SELECT count(*) INTO v_count FROM public.meta_capi_outbox
  WHERE idempotency_key LIKE 'schedule:%';
  IF v_count <> 3 THEN
    RAISE EXCEPTION 'expected 3 outbox rows, got %', v_count;
  END IF;

  -- 3) Intent inmutable ante segundo register (no sustituye test de 2 conexiones).
  v_intent := public.lv_register_meta_schedule_intent(
    aid_gap, gen_random_uuid(), v_etime + 999, 'live', 'web', '{}'::jsonb
  );
  IF (v_intent ->> 'inserted')::boolean IS TRUE THEN
    RAISE EXCEPTION 'second intent must not insert';
  END IF;
  IF (v_intent ->> 'event_id')::uuid <> v_eid1 THEN
    RAISE EXCEPTION 'event_id mutated under concurrency';
  END IF;
  IF (v_intent ->> 'event_time')::bigint <> v_etime THEN
    RAISE EXCEPTION 'event_time mutated under concurrency';
  END IF;

  -- 4) needs_review sigue permitido en CHECK (insert artificial).
  INSERT INTO public.meta_capi_outbox (
    idempotency_key, event_id, event_name, event_time, payload, status,
    delivery_lane, ads_consent_required, last_error
  ) VALUES (
    'probe:needs_review', gen_random_uuid(), 'Lead', 1, '{}'::jsonb, 'needs_review',
    'live', true, 'probe'
  );
  SELECT count(*) INTO v_needs FROM public.meta_capi_outbox WHERE status = 'needs_review';
  IF v_needs < 2 THEN
    RAISE EXCEPTION 'needs_review rows missing after migrations';
  END IF;

  -- 5) Confirmación no se revierte (status/confirmed siguen).
  IF NOT EXISTS (
    SELECT 1 FROM public.appointments
    WHERE id = aid_gap AND confirmed_by_client IS TRUE AND status = 'aceptado'
  ) THEN
    RAISE EXCEPTION 'appointment confirmation was altered';
  END IF;

  RAISE NOTICE 'meta_schedule_recover_isolated_ok n1=% eid=% etime=%', n1, v_eid1, v_etime;
END $$;
