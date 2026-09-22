-- LeadSubmitted BM: configuración operativa — no exigir meta_ads_consent=true ni
-- evidencia whatsapp_ads para encolar. Solo bloquea rechazo/revocación explícita
-- (meta_ads_consent IS FALSE). No escribe ni convierte null→true.

BEGIN;

CREATE OR REPLACE FUNCTION public.lv_register_wa_lead_submitted_intent(
  p_lead_id uuid,
  p_event_id uuid,
  p_event_time bigint,
  p_lane text,
  p_payload jsonb,
  p_status text DEFAULT 'pending'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.leads%ROWTYPE;
  v_key text;
  v_lane text;
  v_status text;
  v_inserted integer := 0;
  v_outbox_id uuid;
BEGIN
  IF p_lead_id IS NULL OR p_event_id IS NULL OR p_event_time IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;

  SELECT * INTO a FROM public.leads WHERE id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'lead_not_found');
  END IF;

  -- Solo rechazo/revocación explícita bloquea; null/ausente permiten.
  IF a.meta_ads_consent IS FALSE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ads_consent_revoked');
  END IF;

  IF a.meta_wa_lead_submitted_event_id IS NOT NULL THEN
    SELECT id INTO v_outbox_id
    FROM public.meta_capi_outbox
    WHERE idempotency_key = 'wa_lead_submitted:' || p_lead_id::text
    LIMIT 1;
    RETURN jsonb_build_object(
      'ok', true,
      'inserted', false,
      'event_id', a.meta_wa_lead_submitted_event_id,
      'event_time', a.meta_wa_lead_submitted_event_time,
      'outbox_id', v_outbox_id
    );
  END IF;

  v_lane := CASE WHEN p_lane IN ('test', 'live') THEN p_lane ELSE 'live' END;
  v_status := CASE
    WHEN p_status IN ('pending', 'needs_review', 'review_hold') THEN p_status
    ELSE 'pending'
  END;
  v_key := 'wa_lead_submitted:' || p_lead_id::text;

  UPDATE public.leads
  SET
    meta_wa_lead_submitted_event_id = p_event_id,
    meta_wa_lead_submitted_event_time = p_event_time,
    meta_wa_lead_submitted_at = now()
  WHERE id = p_lead_id
    AND meta_wa_lead_submitted_event_id IS NULL;

  IF NOT FOUND THEN
    SELECT * INTO a FROM public.leads WHERE id = p_lead_id;
    RETURN jsonb_build_object(
      'ok', true,
      'inserted', false,
      'event_id', a.meta_wa_lead_submitted_event_id,
      'event_time', a.meta_wa_lead_submitted_event_time
    );
  END IF;

  INSERT INTO public.meta_capi_outbox (
    idempotency_key,
    event_id,
    event_name,
    event_time,
    payload,
    status,
    delivery_lane,
    lead_id,
    ads_consent_required,
    last_error
  ) VALUES (
    v_key,
    p_event_id,
    'LeadSubmitted',
    p_event_time,
    COALESCE(p_payload, '{}'::jsonb),
    v_status,
    v_lane,
    p_lead_id,
    true,
    CASE WHEN v_status = 'needs_review' THEN COALESCE(p_payload ->> 'block_reason', 'needs_review') ELSE NULL END
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;

  SELECT id INTO v_outbox_id
  FROM public.meta_capi_outbox
  WHERE idempotency_key = v_key
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'inserted', v_inserted > 0,
    'event_id', p_event_id,
    'event_time', p_event_time,
    'status', v_status,
    'outbox_id', v_outbox_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lv_register_wa_lead_submitted_intent(
  uuid, uuid, bigint, text, jsonb, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lv_register_wa_lead_submitted_intent(
  uuid, uuid, bigint, text, jsonb, text
) TO service_role;

COMMENT ON FUNCTION public.lv_register_wa_lead_submitted_intent(
  uuid, uuid, bigint, text, jsonb, text
) IS
  'Encola LeadSubmitted BM. Bloquea solo meta_ads_consent IS FALSE; null/ausente OK. No inventa consentimiento.';

COMMIT;
