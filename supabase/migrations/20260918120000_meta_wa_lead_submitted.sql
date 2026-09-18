-- WhatsApp BM LeadSubmitted (local). NO aplicar a Production sin autorización.
-- Amplía event_name; intent durable; bitácora de conversión; consent WA ads.

BEGIN;

ALTER TABLE public.meta_capi_outbox
  DROP CONSTRAINT IF EXISTS meta_capi_outbox_event_name_check;

ALTER TABLE public.meta_capi_outbox
  ADD CONSTRAINT meta_capi_outbox_event_name_check
  CHECK (event_name IN (
    'ViewContent',
    'Lead',
    'Schedule',
    'LeadSubmitted'
  ));

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS meta_wa_lead_submitted_event_id uuid,
  ADD COLUMN IF NOT EXISTS meta_wa_lead_submitted_event_time bigint,
  ADD COLUMN IF NOT EXISTS meta_wa_lead_submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS meta_ads_consent_evidence_message text,
  ADD COLUMN IF NOT EXISTS meta_ads_consent_evidence_at timestamptz,
  ADD COLUMN IF NOT EXISTS meta_ads_consent_scope text;

COMMENT ON COLUMN public.leads.meta_wa_lead_submitted_event_id IS
  'event_id CAPI LeadSubmitted (BM); inmutable tras el primer registro autorizado.';

COMMENT ON COLUMN public.leads.meta_ads_consent_evidence_message IS
  'Texto del cliente que otorgó/revocó consentimiento ads (evidencia; máx ~500).';
COMMENT ON COLUMN public.leads.meta_ads_consent_scope IS
  'Alcance del consentimiento ads (p. ej. whatsapp_ads). Distinto de tracking_consent.';

ALTER TABLE public.meta_ads_consent_ledger
  ADD COLUMN IF NOT EXISTS evidence_message text,
  ADD COLUMN IF NOT EXISTS evidence_scope text,
  ADD COLUMN IF NOT EXISTS evidence_at timestamptz;

CREATE TABLE IF NOT EXISTS public.meta_capi_conversion_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  tenant_id uuid,
  project_id uuid,
  lead_id uuid,
  contact_id text,
  event_name text NOT NULL,
  stage text NOT NULL CHECK (stage IN (
    'evaluated',
    'blocked',
    'enqueued',
    'backend_accepted',
    'meta_accepted',
    'meta_rejected'
  )),
  reason text,
  event_id uuid,
  idempotency_key text,
  delivery_lane text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_meta_capi_conversion_log_lead_created
  ON public.meta_capi_conversion_log (lead_id, created_at DESC);

ALTER TABLE public.meta_capi_conversion_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.meta_capi_conversion_log FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_capi_conversion_log TO service_role;

CREATE OR REPLACE FUNCTION public.lv_log_meta_conversion(
  p_stage text,
  p_event_name text,
  p_reason text DEFAULT NULL,
  p_lead_id uuid DEFAULT NULL,
  p_contact_id text DEFAULT NULL,
  p_tenant_id uuid DEFAULT NULL,
  p_project_id uuid DEFAULT NULL,
  p_event_id uuid DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_delivery_lane text DEFAULT NULL,
  p_details jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  INSERT INTO public.meta_capi_conversion_log (
    tenant_id, project_id, lead_id, contact_id,
    event_name, stage, reason, event_id, idempotency_key, delivery_lane, details
  ) VALUES (
    p_tenant_id, p_project_id, p_lead_id, NULLIF(trim(COALESCE(p_contact_id, '')), ''),
    p_event_name, p_stage, p_reason, p_event_id, p_idempotency_key, p_delivery_lane,
    COALESCE(p_details, '{}'::jsonb)
  )
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.lv_log_meta_conversion(
  text, text, text, uuid, text, uuid, uuid, uuid, text, text, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lv_log_meta_conversion(
  text, text, text, uuid, text, uuid, uuid, uuid, text, text, jsonb
) TO service_role;

-- Consent ads WA explícito (no tracking_consent). Escribe lead + ledger + evidencia.
CREATE OR REPLACE FUNCTION public.lv_set_whatsapp_meta_ads_consent(
  p_lead_id uuid,
  p_ads_consent boolean,
  p_reason text DEFAULT NULL,
  p_evidence_message text DEFAULT NULL,
  p_scope text DEFAULT 'whatsapp_ads'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ledger jsonb;
  v_evidence text;
  v_scope text;
  v_at timestamptz := now();
BEGIN
  IF p_lead_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'lead_required');
  END IF;

  v_evidence := NULLIF(left(trim(COALESCE(p_evidence_message, '')), 500), '');
  v_scope := COALESCE(NULLIF(trim(COALESCE(p_scope, '')), ''), 'whatsapp_ads');

  v_ledger := public.lv_record_meta_ads_consent(
    p_ads_consent,
    NULL,
    p_lead_id,
    NULL
  );

  UPDATE public.leads
  SET
    meta_ads_consent_evidence_message = v_evidence,
    meta_ads_consent_evidence_at = CASE WHEN v_evidence IS NOT NULL THEN v_at ELSE meta_ads_consent_evidence_at END,
    meta_ads_consent_scope = v_scope
  WHERE id = p_lead_id;

  UPDATE public.meta_ads_consent_ledger
  SET
    evidence_message = v_evidence,
    evidence_scope = v_scope,
    evidence_at = CASE WHEN v_evidence IS NOT NULL THEN v_at ELSE evidence_at END
  WHERE id = (v_ledger ->> 'id')::uuid;

  RETURN jsonb_build_object(
    'ok', true,
    'lead_id', p_lead_id,
    'ads_consent', p_ads_consent,
    'reason', p_reason,
    'scope', v_scope,
    'evidence_at', CASE WHEN v_evidence IS NOT NULL THEN v_at ELSE NULL END,
    'has_evidence', v_evidence IS NOT NULL,
    'ledger', v_ledger
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lv_set_whatsapp_meta_ads_consent(uuid, boolean, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lv_set_whatsapp_meta_ads_consent(uuid, boolean, text, text, text)
  TO service_role;

-- Intent inmutable + outbox LeadSubmitted (BM). Nunca asume website.
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
