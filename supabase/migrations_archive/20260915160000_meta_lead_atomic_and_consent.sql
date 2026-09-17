-- Meta CAPI: lead + outbox atómicos + recuperación + revoke durable

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS meta_lead_event_id uuid,
  ADD COLUMN IF NOT EXISTS meta_lead_event_time bigint;

COMMENT ON COLUMN public.leads.meta_lead_event_id IS
  'event_id Lead acordado con Pixel/CAPI; permite recuperar outbox sin depender del visitante.';
COMMENT ON COLUMN public.leads.meta_lead_event_time IS
  'event_time unix original del Lead; se conserva en recuperación.';

-- Cola: permitir re-pendiente tras recuperación si hace falta
ALTER TABLE public.meta_capi_outbox
  DROP CONSTRAINT IF EXISTS meta_capi_outbox_status_check;

ALTER TABLE public.meta_capi_outbox
  ADD CONSTRAINT meta_capi_outbox_status_check
  CHECK (status IN ('pending', 'forwarded', 'cancelled', 'dead'));

CREATE INDEX IF NOT EXISTS idx_meta_capi_outbox_pending_lane
  ON public.meta_capi_outbox (delivery_lane, created_at)
  WHERE status = 'pending';

/**
 * Identifica lead (RPC existente) y, si hay consentimiento ads, inserta outbox Lead
 * en la MISMA transacción. Persiste event_id/event_time en leads para recuperación.
 */
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
  p_delivery_lane text DEFAULT 'live',
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
BEGIN
  v_lane := CASE WHEN p_delivery_lane = 'test' THEN 'test' ELSE 'live' END;

  -- identify_tour_lead existente (misma TX). Normalizamos a uuid vía text.
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
    meta_lead_event_time = COALESCE(meta_lead_event_time, v_event_time)
  WHERE id = v_lead_id
  RETURNING meta_lead_event_id, meta_lead_event_time
  INTO v_event_id, v_event_time;

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
    COALESCE(p_payload, '{}'::jsonb),
    'pending',
    v_lane,
    v_lead_id,
    NULLIF(trim(p_visitor_key), ''),
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

REVOKE ALL ON FUNCTION public.identify_tour_lead_with_meta_outbox(
  uuid, text, text, text, text, uuid, boolean, uuid, bigint, text, jsonb
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identify_tour_lead_with_meta_outbox(
  uuid, text, text, text, text, uuid, boolean, uuid, bigint, text, jsonb
) TO service_role;

/**
 * Recupera outbox Lead faltante usando event_id/event_time persistidos en leads.
 * No depende de tráfico del visitante. Idempotente.
 */
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
BEGIN
  FOR r IN
    SELECT
      l.id AS lead_id,
      l.meta_lead_event_id AS event_id,
      l.meta_lead_event_time AS event_time,
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
      'lead:' || r.lead_id::text,
      r.event_id,
      'Lead',
      r.event_time,
      jsonb_build_object(
        'action_source', 'website',
        'phone', r.phone,
        'full_name', r.name,
        'email', r.email,
        'external_id', r.lead_id::text,
        'recovered', true
      ),
      'pending',
      'live',
      r.lead_id,
      true,
      'recovered_missing_outbox'
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
    IF FOUND THEN
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.lv_recover_missing_meta_lead_outbox(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lv_recover_missing_meta_lead_outbox(integer) TO service_role;

/**
 * Retira consentimiento ads: marca lead + cancela pendientes locales.
 * No reactiva consentimiento; solo niega.
 */
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
  WHERE o.status IN ('pending')
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

REVOKE ALL ON FUNCTION public.lv_revoke_meta_ads_consent(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lv_revoke_meta_ads_consent(uuid, text) TO service_role;
