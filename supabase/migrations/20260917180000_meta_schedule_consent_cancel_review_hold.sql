-- Consent revoke/deny cancela también review_hold (Schedule hold no sobrevive).
-- Conserva filas; solo cambia status → cancelled. No aplicar a Production sin autorización.

BEGIN;

CREATE OR REPLACE FUNCTION public.lv_revoke_meta_ads_consent(
  p_lead_id uuid DEFAULT NULL,
  p_visitor_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cancelled integer := 0;
BEGIN
  IF p_lead_id IS NOT NULL THEN
    UPDATE public.leads
    SET meta_ads_consent = false,
        meta_ads_consent_at = now()
    WHERE id = p_lead_id;
  END IF;

  UPDATE public.meta_capi_outbox o
  SET
    status = 'cancelled',
    updated_at = now(),
    last_error = 'ads_consent_revoked'
  WHERE o.status IN ('pending', 'needs_review', 'review_hold')
    AND o.ads_consent_required IS TRUE
    AND (
      (p_lead_id IS NOT NULL AND o.lead_id = p_lead_id)
      OR (
        p_visitor_key IS NOT NULL
        AND NULLIF(trim(p_visitor_key), '') IS NOT NULL
        AND o.visitor_key = trim(p_visitor_key)
      )
    );

  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  RETURN jsonb_build_object(
    'cancelled', v_cancelled,
    'lead_id', p_lead_id,
    'visitor_key', p_visitor_key
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.lv_record_meta_ads_consent(
  p_ads_consent boolean,
  p_visitor_key text DEFAULT NULL,
  p_lead_id uuid DEFAULT NULL,
  p_consent_version bigint DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_version bigint;
  v_id uuid;
  v_lead uuid;
BEGIN
  v_lead := p_lead_id;
  v_version := nextval('public.meta_ads_consent_version_seq');

  IF v_lead IS NOT NULL THEN
    UPDATE public.leads
    SET
      meta_ads_consent = p_ads_consent,
      meta_ads_consent_at = now()
    WHERE id = v_lead;
  END IF;

  IF NOT COALESCE(p_ads_consent, false) THEN
    UPDATE public.meta_capi_outbox o
    SET
      status = 'cancelled',
      updated_at = now(),
      last_error = 'ads_consent_revoked'
    WHERE o.status IN ('pending', 'needs_review', 'review_hold')
      AND o.ads_consent_required IS TRUE
      AND (
        (v_lead IS NOT NULL AND o.lead_id = v_lead)
        OR (
          p_visitor_key IS NOT NULL
          AND NULLIF(trim(p_visitor_key), '') IS NOT NULL
          AND o.visitor_key = trim(p_visitor_key)
        )
      );
  END IF;

  INSERT INTO public.meta_ads_consent_ledger (
    visitor_key,
    lead_id,
    ads_consent,
    consent_version,
    nest_status
  ) VALUES (
    NULLIF(trim(COALESCE(p_visitor_key, '')), ''),
    v_lead,
    p_ads_consent,
    v_version,
    'pending'
  )
  RETURNING id INTO v_id;

  RETURN jsonb_build_object(
    'id', v_id,
    'lead_id', v_lead,
    'visitor_key', NULLIF(trim(COALESCE(p_visitor_key, '')), ''),
    'ads_consent', p_ads_consent,
    'consent_version', v_version,
    'nest_status', 'pending'
  );
END;
$$;

COMMENT ON FUNCTION public.lv_revoke_meta_ads_consent(uuid, text) IS
  'Revoca consent y cancela outbox pending/needs_review/review_hold con ads_consent_required. Solo service_role.';

COMMIT;
