-- Meta CAPI: RLS outbox + ledger de consentimiento versionado + recover con lane

-- ---------------------------------------------------------------------------
-- 1) Contexto durable en leads para recuperación (lane + payload original)
-- ---------------------------------------------------------------------------
ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS meta_lead_delivery_lane text
    CHECK (meta_lead_delivery_lane IS NULL OR meta_lead_delivery_lane IN ('test', 'live')),
  ADD COLUMN IF NOT EXISTS meta_lead_payload jsonb;

-- ---------------------------------------------------------------------------
-- 2) Ledger de consentimiento (orden verificable + entrega a Nest)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.meta_ads_consent_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  visitor_key text,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  ads_consent boolean NOT NULL,
  consent_version bigint NOT NULL,
  nest_status text NOT NULL DEFAULT 'pending'
    CHECK (nest_status IN ('pending', 'delivered', 'failed', 'skipped')),
  nest_attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT meta_ads_consent_ledger_scope_chk CHECK (
    visitor_key IS NOT NULL OR lead_id IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_meta_ads_consent_ledger_version
  ON public.meta_ads_consent_ledger (consent_version);

CREATE INDEX IF NOT EXISTS idx_meta_ads_consent_ledger_pending
  ON public.meta_ads_consent_ledger (nest_status, created_at)
  WHERE nest_status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_meta_ads_consent_ledger_visitor
  ON public.meta_ads_consent_ledger (visitor_key)
  WHERE visitor_key IS NOT NULL;

COMMENT ON TABLE public.meta_ads_consent_ledger IS
  'Historial ordenado de grant/revoke ads. consent_version monotónico evita que un grant atrasado pise una revocación posterior.';

-- ---------------------------------------------------------------------------
-- 3) RLS + privilegios: solo service_role (servidor)
-- ---------------------------------------------------------------------------
ALTER TABLE public.meta_capi_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_ads_consent_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.meta_capi_outbox FROM PUBLIC;
REVOKE ALL ON TABLE public.meta_capi_outbox FROM anon;
REVOKE ALL ON TABLE public.meta_capi_outbox FROM authenticated;

REVOKE ALL ON TABLE public.meta_ads_consent_ledger FROM PUBLIC;
REVOKE ALL ON TABLE public.meta_ads_consent_ledger FROM anon;
REVOKE ALL ON TABLE public.meta_ads_consent_ledger FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_capi_outbox TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.meta_ads_consent_ledger TO service_role;

-- Sin policies para anon/authenticated ⇒ denegado vía RLS aunque hubiera GRANT residual.
-- service_role bypassa RLS en Supabase; el acceso cliente queda bloqueado.

DROP POLICY IF EXISTS meta_capi_outbox_no_client ON public.meta_capi_outbox;
-- Política explícita denegatoria no es necesaria si no hay GRANT; se documenta el modelo.

-- ---------------------------------------------------------------------------
-- 4) Resolver lead desde visitante (servidor)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lv_resolve_lead_id_for_visitor(
  p_tenant_id uuid,
  p_visitor_key text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead uuid;
BEGIN
  IF p_visitor_key IS NULL OR length(trim(p_visitor_key)) = 0 THEN
    RETURN NULL;
  END IF;

  SELECT tv.lead_id INTO v_lead
  FROM public.tour_visitors tv
  WHERE tv.tenant_id = p_tenant_id
    AND tv.visitor_key = trim(p_visitor_key)
  LIMIT 1;

  RETURN v_lead;
END;
$$;

REVOKE ALL ON FUNCTION public.lv_resolve_lead_id_for_visitor(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lv_resolve_lead_id_for_visitor(uuid, text) TO service_role;

-- ---------------------------------------------------------------------------
-- 5) Registrar consentimiento versionado
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
  v_version := COALESCE(
    p_consent_version,
    (floor(extract(epoch FROM clock_timestamp()) * 1000))::bigint
  );

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
    WHERE o.status = 'pending'
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

REVOKE ALL ON FUNCTION public.lv_record_meta_ads_consent(boolean, text, uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lv_record_meta_ads_consent(boolean, text, uuid, bigint) TO service_role;

-- ---------------------------------------------------------------------------
-- 6) Recover: conserva lane + payload original (no forzar live)
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
  v_payload jsonb;
BEGIN
  FOR r IN
    SELECT
      l.id AS lead_id,
      l.meta_lead_event_id AS event_id,
      l.meta_lead_event_time AS event_time,
      l.meta_lead_delivery_lane AS delivery_lane,
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
    v_lane := CASE
      WHEN r.delivery_lane IN ('test', 'live') THEN r.delivery_lane
      ELSE 'live'
    END;

    v_payload := COALESCE(r.stored_payload, '{}'::jsonb);
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
      v_payload,
      'pending',
      v_lane,
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

-- ---------------------------------------------------------------------------
-- 7) identify_with_meta: persistir lane + payload en leads
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
    meta_lead_payload = COALESCE(meta_lead_payload, COALESCE(p_payload, '{}'::jsonb))
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
    COALESCE(p_payload, '{}'::jsonb) || jsonb_build_object('external_id', v_lead_id::text),
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
