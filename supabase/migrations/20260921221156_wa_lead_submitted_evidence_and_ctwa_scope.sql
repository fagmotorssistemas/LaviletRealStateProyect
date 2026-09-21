-- LeadSubmitted BM: exigir evidencia whatsapp_ads en intent; CTWA get con tenant.
-- Aditiva. No borra datos ni cambia flags de aplicación.

BEGIN;

-- CTWA lectura con aislamiento tenant (además de project+contact).
DROP FUNCTION IF EXISTS public.lv_app_get_ctwa(uuid, text);

CREATE OR REPLACE FUNCTION public.lv_app_get_ctwa(
  p_project_id uuid,
  p_contact_id text,
  p_tenant_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.lv_whatsapp_ctwa_attribution%ROWTYPE;
BEGIN
  SELECT * INTO row
  FROM public.lv_whatsapp_ctwa_attribution
  WHERE project_id = p_project_id
    AND contact_id = p_contact_id
    AND (p_tenant_id IS NULL OR tenant_id = p_tenant_id)
  ORDER BY captured_at ASC, id ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'found', false);
  END IF;

  IF p_tenant_id IS NOT NULL AND row.tenant_id IS DISTINCT FROM p_tenant_id THEN
    RETURN jsonb_build_object('ok', true, 'found', false);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'found', true,
    'ctwa_clid', row.ctwa_clid,
    'tenant_id', row.tenant_id,
    'project_id', row.project_id,
    'contact_id', row.contact_id,
    'field_path', row.field_path,
    'source_id', row.source_id,
    'source_url', row.source_url,
    'referral_source_type', row.referral_source_type,
    'external_message_id', row.external_message_id,
    'captured_at', row.captured_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lv_app_get_ctwa(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lv_app_get_ctwa(uuid, text, uuid) TO service_role;
-- Mantener overload (uuid, text) si ya existía vía DEFAULT NULL en la nueva firma.
-- Si PostgREST ve ambigüedad, se usa la de 3 args desde el servicio.

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

  IF a.meta_ads_consent IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ads_consent_required');
  END IF;

  -- Evidencia verificable: mensaje + fecha + alcance whatsapp_ads.
  IF NULLIF(trim(COALESCE(a.meta_ads_consent_evidence_message, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ads_consent_evidence_message_required');
  END IF;
  IF a.meta_ads_consent_evidence_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ads_consent_evidence_at_required');
  END IF;
  IF COALESCE(NULLIF(trim(COALESCE(a.meta_ads_consent_scope, '')), ''), '') <> 'whatsapp_ads' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'ads_consent_scope_required');
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

COMMIT;
