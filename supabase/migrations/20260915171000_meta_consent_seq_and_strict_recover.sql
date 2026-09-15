-- Meta CAPI: consent_version por secuencia; recover estricto; sin skipped terminal

-- ---------------------------------------------------------------------------
-- Secuencia monotónica (segura ante concurrencia; fuente de verdad del orden)
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS public.meta_ads_consent_version_seq
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO MINVALUE
  NO MAXVALUE
  CACHE 1;

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS meta_lead_visitor_key text;

-- needs_review: retenido sin asumir live
ALTER TABLE public.meta_capi_outbox
  DROP CONSTRAINT IF EXISTS meta_capi_outbox_status_check;

ALTER TABLE public.meta_capi_outbox
  ADD CONSTRAINT meta_capi_outbox_status_check
  CHECK (status IN ('pending', 'forwarded', 'cancelled', 'dead', 'needs_review'));

-- nest_status: pending/failed se reintentan; delivered ok; skipped NO es terminal por config
ALTER TABLE public.meta_ads_consent_ledger
  DROP CONSTRAINT IF EXISTS meta_ads_consent_ledger_nest_status_check;

ALTER TABLE public.meta_ads_consent_ledger
  ADD CONSTRAINT meta_ads_consent_ledger_nest_status_check
  CHECK (nest_status IN ('pending', 'delivered', 'failed'));

-- ---------------------------------------------------------------------------
-- Registrar consentimiento: versión SIEMPRE desde secuencia (ignora cliente)
-- ---------------------------------------------------------------------------
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
  -- p_consent_version se ignora a propósito: el orden lo define la secuencia.
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
    WHERE o.status IN ('pending', 'needs_review')
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

-- ---------------------------------------------------------------------------
-- Recover: conserva visitor_key + lane; sin lane → needs_review (no asume live)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lv_recover_missing_meta_lead_outbox(
  p_limit integer DEFAULT 50
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  n integer := 0;
  v_lane text;
  v_visitor text;
  v_payload jsonb;
  v_status text;
  v_error text;
BEGIN
  FOR r IN
    SELECT
      l.id AS lead_id,
      l.meta_lead_event_id AS event_id,
      l.meta_lead_event_time AS event_time,
      l.meta_lead_delivery_lane AS delivery_lane,
      l.meta_lead_visitor_key AS visitor_key,
      l.meta_lead_payload AS stored_payload,
      l.phone,
      l.name,
      l.email
    FROM public.leads l
    WHERE l.meta_ads_consent IS TRUE
      AND l.meta_lead_event_id IS NOT NULL
      AND l.meta_lead_event_time IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.meta_capi_outbox o
        WHERE o.idempotency_key = 'lead:' || l.id::text
      )
    ORDER BY l.meta_ads_consent_at NULLS LAST
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  LOOP
    v_payload := COALESCE(r.stored_payload, '{}'::jsonb);
    v_visitor := COALESCE(
      NULLIF(trim(COALESCE(r.visitor_key, '')), ''),
      NULLIF(trim(COALESCE(v_payload ->> 'visitor_key', '')), '')
    );

    IF r.delivery_lane IN ('test', 'live') THEN
      v_lane := r.delivery_lane;
      v_status := 'pending';
      v_error := 'recovered_missing_outbox';
    ELSE
      -- Falta entorno original: retener para revisión, no inventar live.
      v_lane := 'live'; -- columna NOT NULL + check; status needs_review evita envío
      v_status := 'needs_review';
      v_error := 'missing_delivery_lane_needs_review';
    END IF;

    IF v_payload = '{}'::jsonb THEN
      v_payload := jsonb_build_object(
        'action_source', 'website',
        'phone', r.phone,
        'full_name', r.name,
        'email', r.email,
        'external_id', r.lead_id::text,
        'recovered', true
      );
    ELSE
      v_payload := v_payload || jsonb_build_object('recovered', true);
    END IF;

    IF v_visitor IS NOT NULL THEN
      v_payload := v_payload || jsonb_build_object('visitor_key', v_visitor);
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
      ads_consent_required,
      last_error
    ) VALUES (
      'lead:' || r.lead_id::text,
      r.event_id,
      'Lead',
      r.event_time,
      v_payload,
      v_status,
      v_lane,
      r.lead_id,
      v_visitor,
      true,
      v_error
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
    IF FOUND THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

-- ---------------------------------------------------------------------------
-- identify_with_meta: persistir visitor_key + lane + payload
-- ---------------------------------------------------------------------------
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
  p_payload jsonb DEFAULT '{}'::jsonb
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
BEGIN
  -- NULL lane no se convierte a live aquí: se exige explícito test|live para emitir.
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

  IF NOT COALESCE(p_ads_consent, false) THEN
    RETURN jsonb_build_object(
      'lead_id', v_lead_id,
      'emit_meta_lead', false,
      'meta_event_id', NULL,
      'meta_event_time', NULL,
      'outbox_inserted', false
    );
  END IF;

  v_event_id := COALESCE(p_event_id, gen_random_uuid());
  v_event_time := COALESCE(p_event_time, floor(extract(epoch FROM clock_timestamp()))::bigint);

  UPDATE public.leads
  SET
    meta_ads_consent = true,
    meta_ads_consent_at = COALESCE(meta_ads_consent_at, now()),
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
      'outbox_inserted', false
    );
  END IF;

  -- Sin lane conocida: needs_review (no asume live para envío)
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
        'visitor_key', v_visitor
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
      'needs_review', true
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
      'visitor_key', v_visitor
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
    'outbox_inserted', v_inserted
  );
END;
$$;
