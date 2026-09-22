-- Outbox: Allow AddToWishlist / Purchase for captura interna (review_hold).
-- Lead CAPI solo con p_emit_lead=true (info_request). No inventa consentimiento.

BEGIN;

ALTER TABLE public.meta_capi_outbox
  DROP CONSTRAINT IF EXISTS meta_capi_outbox_event_name_check;

ALTER TABLE public.meta_capi_outbox
  ADD CONSTRAINT meta_capi_outbox_event_name_check
  CHECK (event_name IN (
    'ViewContent',
    'Lead',
    'Schedule',
    'LeadSubmitted',
    'AddToWishlist',
    'Purchase'
  ));

COMMENT ON CONSTRAINT meta_capi_outbox_event_name_check ON public.meta_capi_outbox IS
  'AddToWishlist/Purchase: captura FE con review_hold hasta Nest tipado; no flush activo.';

-- Sustituir firma 11-args por 12-args (p_emit_lead) para evitar ambigüedad PostgREST.
DROP FUNCTION IF EXISTS public.identify_tour_lead_with_meta_outbox(
  uuid, text, text, text, text, uuid, boolean, uuid, bigint, text, jsonb
);

CREATE OR REPLACE FUNCTION public.identify_tour_lead_with_meta_outbox(
  p_tenant_id uuid,
  p_visitor_key text,
  p_name text,
  p_email text,
  p_phone text,
  p_project_id uuid,
  p_ads_consent boolean DEFAULT false,
  p_event_id uuid DEFAULT NULL,
  p_event_time bigint DEFAULT NULL,
  p_delivery_lane text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_emit_lead boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
  v_event_id uuid;
  v_event_time bigint;
  v_inserted boolean := false;
  v_existing_id uuid;
  v_existing_event uuid;
  v_lane text;
  v_visitor text;
  v_ads_ok boolean;
  v_ledger_ads boolean;
  v_linked integer := 0;
BEGIN
  v_lane := CASE
    WHEN p_delivery_lane = 'test' THEN 'test'
    WHEN p_delivery_lane = 'live' THEN 'live'
    ELSE NULL
  END;
  v_visitor := NULLIF(trim(COALESCE(p_visitor_key, '')), '');

  v_lead_id := (
    public.identify_tour_lead(
      p_tenant_id,
      p_visitor_key,
      p_name,
      p_email,
      p_phone,
      p_project_id
    )
  )::text::uuid;

  IF v_lead_id IS NULL THEN
    RAISE EXCEPTION 'identify_tour_lead_with_meta_outbox: lead_id nulo';
  END IF;

  v_linked := public.lv_link_meta_outbox_visitor_to_lead(v_visitor, v_lead_id);

  v_ads_ok := COALESCE(p_ads_consent, false);

  IF v_ads_ok AND v_visitor IS NOT NULL THEN
    SELECT l.ads_consent
    INTO v_ledger_ads
    FROM public.meta_ads_consent_ledger l
    WHERE l.visitor_key = v_visitor
    ORDER BY l.consent_version DESC
    LIMIT 1;

    IF v_ledger_ads IS FALSE THEN
      v_ads_ok := false;
    END IF;
  END IF;

  IF NOT v_ads_ok THEN
    UPDATE public.leads
    SET
      meta_ads_consent = false,
      meta_ads_consent_at = now()
    WHERE id = v_lead_id
      AND meta_ads_consent IS DISTINCT FROM false;

    RETURN jsonb_build_object(
      'lead_id', v_lead_id,
      'emit_meta_lead', false,
      'meta_event_id', NULL,
      'meta_event_time', NULL,
      'outbox_inserted', false,
      'outbox_linked', v_linked
    );
  END IF;

  UPDATE public.leads
  SET
    meta_ads_consent = true,
    meta_ads_consent_at = COALESCE(meta_ads_consent_at, now())
  WHERE id = v_lead_id
    AND meta_ads_consent IS DISTINCT FROM true;

  IF NOT COALESCE(p_emit_lead, true) THEN
    RETURN jsonb_build_object(
      'lead_id', v_lead_id,
      'emit_meta_lead', false,
      'meta_event_id', NULL,
      'meta_event_time', NULL,
      'outbox_inserted', false,
      'outbox_linked', v_linked
    );
  END IF;

  v_event_id := COALESCE(p_event_id, gen_random_uuid());
  v_event_time := COALESCE(p_event_time, floor(extract(epoch FROM clock_timestamp()))::bigint);

  UPDATE public.leads
  SET
    meta_lead_event_id = COALESCE(meta_lead_event_id, v_event_id),
    meta_lead_event_time = COALESCE(meta_lead_event_time, v_event_time),
    meta_lead_delivery_lane = COALESCE(meta_lead_delivery_lane, v_lane),
    meta_lead_visitor_key = COALESCE(meta_lead_visitor_key, v_visitor),
    meta_lead_payload = COALESCE(
      meta_lead_payload,
      COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('visitor_key', v_visitor)
    )
  WHERE id = v_lead_id
  RETURNING meta_lead_event_id, meta_lead_event_time, meta_lead_delivery_lane
  INTO v_event_id, v_event_time, v_lane;

  SELECT id, event_id
  INTO v_existing_id, v_existing_event
  FROM public.meta_capi_outbox
  WHERE idempotency_key = 'lead:' || v_lead_id::text
  LIMIT 1;

  IF v_existing_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'lead_id', v_lead_id,
      'emit_meta_lead', false,
      'meta_event_id', v_existing_event,
      'meta_event_time', v_event_time,
      'outbox_inserted', false,
      'outbox_linked', v_linked
    );
  END IF;

  IF v_lane IS NULL THEN
    INSERT INTO public.meta_capi_outbox (
      idempotency_key, event_id, event_name, event_time, payload, status,
      delivery_lane, lead_id, visitor_key, ads_consent_required, last_error
    ) VALUES (
      'lead:' || v_lead_id::text,
      v_event_id,
      'Lead',
      v_event_time,
      COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object(
        'external_id', v_lead_id::text,
        'visitor_key', v_visitor,
        'lv_internal_subtype', 'solicitud'
      ),
      'needs_review',
      'live',
      v_lead_id,
      v_visitor,
      true,
      'missing_delivery_lane_needs_review'
    )
    ON CONFLICT (idempotency_key) DO NOTHING
    RETURNING id INTO v_existing_id;

    RETURN jsonb_build_object(
      'lead_id', v_lead_id,
      'emit_meta_lead', false,
      'meta_event_id', v_event_id,
      'meta_event_time', v_event_time,
      'outbox_inserted', v_existing_id IS NOT NULL,
      'needs_review', true,
      'outbox_linked', v_linked
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
    visitor_key,
    ads_consent_required
  ) VALUES (
    'lead:' || v_lead_id::text,
    v_event_id,
    'Lead',
    v_event_time,
    COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object(
      'external_id', v_lead_id::text,
      'visitor_key', v_visitor,
      'lv_internal_subtype', 'solicitud'
    ),
    'pending',
    v_lane,
    v_lead_id,
    v_visitor,
    true
  )
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING id INTO v_existing_id;

  v_inserted := v_existing_id IS NOT NULL;

  IF NOT v_inserted THEN
    SELECT event_id INTO v_existing_event
    FROM public.meta_capi_outbox
    WHERE idempotency_key = 'lead:' || v_lead_id::text;
  END IF;

  RETURN jsonb_build_object(
    'lead_id', v_lead_id,
    'emit_meta_lead', v_inserted,
    'meta_event_id', COALESCE(v_existing_event, v_event_id),
    'meta_event_time', v_event_time,
    'outbox_inserted', v_inserted,
    'outbox_linked', v_linked
  );
END;
$$;

REVOKE ALL ON FUNCTION public.identify_tour_lead_with_meta_outbox(
  uuid, text, text, text, text, uuid, boolean, uuid, bigint, text, jsonb, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.identify_tour_lead_with_meta_outbox(
  uuid, text, text, text, text, uuid, boolean, uuid, bigint, text, jsonb, boolean
) TO service_role;

-- Mantener overload anterior (11 args) llamando con p_emit_lead=true por defecto vía DEFAULT.
-- PostgREST usa la firma completa cuando se envía p_emit_lead.

COMMENT ON FUNCTION public.identify_tour_lead_with_meta_outbox(
  uuid, text, text, text, text, uuid, boolean, uuid, bigint, text, jsonb, boolean
) IS
  'Identifica lead tour; Lead CAPI solo si p_emit_lead=true (info_request). Enlaza ViewContent previos.';

COMMIT;
