-- Preparada para revisión. NO aplicar a Production en este cambio.
-- Intent durable Schedule (inmutable) + recover que revalida canal (nunca asume website).

BEGIN;

-- CHECK ya incluye needs_review+review_hold tras 20260917152000; se reafirma.
ALTER TABLE public.meta_capi_outbox
  DROP CONSTRAINT IF EXISTS meta_capi_outbox_status_check;

ALTER TABLE public.meta_capi_outbox
  ADD CONSTRAINT meta_capi_outbox_status_check
  CHECK (status IN (
    'pending',
    'forwarded',
    'cancelled',
    'dead',
    'needs_review',
    'review_hold'
  ));

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS meta_schedule_event_id uuid,
  ADD COLUMN IF NOT EXISTS meta_schedule_event_time bigint,
  ADD COLUMN IF NOT EXISTS meta_schedule_delivery_lane text
    CHECK (
      meta_schedule_delivery_lane IS NULL
      OR meta_schedule_delivery_lane IN ('test', 'live')
    ),
  ADD COLUMN IF NOT EXISTS meta_schedule_payload jsonb,
  ADD COLUMN IF NOT EXISTS meta_schedule_channel text,
  ADD COLUMN IF NOT EXISTS meta_schedule_intent_at timestamptz;

COMMENT ON COLUMN public.appointments.meta_schedule_event_id IS
  'event_id CAPI Schedule; inmutable tras el primer registro autorizado.';
COMMENT ON COLUMN public.appointments.meta_schedule_event_time IS
  'Unix seconds de confirmed_at; inmutable tras el primer registro.';
COMMENT ON COLUMN public.appointments.meta_schedule_channel IS
  'Canal evidenciado al registrar el intent (web|whatsapp|pending); recover lo revalida.';

CREATE INDEX IF NOT EXISTS idx_appointments_meta_schedule_recover
  ON public.appointments (meta_schedule_intent_at)
  WHERE meta_schedule_event_id IS NOT NULL
    AND confirmed_by_client IS TRUE;

-- Registra intent una sola vez. No falla la cita: solo service_role post-confirm.
CREATE OR REPLACE FUNCTION public.lv_register_meta_schedule_intent(
  p_appointment_id uuid,
  p_event_id uuid,
  p_event_time bigint,
  p_lane text,
  p_channel text,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.appointments%ROWTYPE;
  v_lane text;
  v_channel text;
BEGIN
  IF p_appointment_id IS NULL OR p_event_id IS NULL OR p_event_time IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_args');
  END IF;

  SELECT * INTO a FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'appointment_not_found');
  END IF;

  IF a.confirmed_by_client IS NOT TRUE OR a.status NOT IN ('aceptado', 'reprogramado') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_client_confirmed');
  END IF;

  -- Ya registrado: devolver valores inmutables (concurrencia / reintento).
  IF a.meta_schedule_event_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', true,
      'inserted', false,
      'event_id', a.meta_schedule_event_id,
      'event_time', a.meta_schedule_event_time,
      'channel', a.meta_schedule_channel,
      'delivery_lane', a.meta_schedule_delivery_lane
    );
  END IF;

  v_lane := CASE WHEN p_lane IN ('test', 'live') THEN p_lane ELSE 'live' END;
  v_channel := lower(trim(COALESCE(p_channel, '')));
  IF v_channel NOT IN ('web', 'whatsapp', 'pending') THEN
    v_channel := 'pending';
  END IF;

  UPDATE public.appointments
  SET
    meta_schedule_event_id = p_event_id,
    meta_schedule_event_time = p_event_time,
    meta_schedule_delivery_lane = v_lane,
    meta_schedule_payload = COALESCE(p_payload, '{}'::jsonb),
    meta_schedule_channel = v_channel,
    meta_schedule_intent_at = now()
  WHERE id = p_appointment_id
    AND meta_schedule_event_id IS NULL;

  IF NOT FOUND THEN
    -- Carrera: otro worker ganó el UPDATE.
    SELECT * INTO a FROM public.appointments WHERE id = p_appointment_id;
    RETURN jsonb_build_object(
      'ok', true,
      'inserted', false,
      'event_id', a.meta_schedule_event_id,
      'event_time', a.meta_schedule_event_time,
      'channel', a.meta_schedule_channel,
      'delivery_lane', a.meta_schedule_delivery_lane
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'inserted', true,
    'event_id', p_event_id,
    'event_time', p_event_time,
    'channel', v_channel,
    'delivery_lane', v_lane
  );
END;
$$;

REVOKE ALL ON FUNCTION public.lv_register_meta_schedule_intent(uuid, uuid, bigint, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lv_register_meta_schedule_intent(uuid, uuid, bigint, text, text, jsonb)
  TO service_role;

-- Recover: revalida canal; sin evidencia → needs_review (nunca asume website).
CREATE OR REPLACE FUNCTION public.lv_recover_missing_meta_schedule_outbox(
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
  inserted integer;
  v_lane text;
  v_payload jsonb;
  v_key text;
  v_channel text;
  v_action text;
  v_status text;
  v_error text;
BEGIN
  FOR r IN
    SELECT
      a.id AS appointment_id,
      a.lead_id,
      a.meta_schedule_event_id AS event_id,
      a.meta_schedule_event_time AS event_time,
      a.meta_schedule_delivery_lane AS delivery_lane,
      a.meta_schedule_payload AS stored_payload,
      a.meta_schedule_channel AS intent_channel,
      a.tenant_id,
      a.project_id,
      a.channel AS appointment_channel,
      l.phone,
      l.name,
      l.email,
      l.meta_ads_consent
    FROM public.appointments a
    JOIN public.leads l ON l.id = a.lead_id
    WHERE a.confirmed_by_client IS TRUE
      AND a.status IN ('aceptado', 'reprogramado')
      AND a.meta_schedule_event_id IS NOT NULL
      AND a.meta_schedule_event_time IS NOT NULL
      AND l.meta_ads_consent IS TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM public.meta_capi_outbox o
        WHERE o.idempotency_key = 'schedule:' || a.id::text
      )
    ORDER BY a.meta_schedule_intent_at NULLS LAST, a.confirmed_at NULLS LAST
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  LOOP
    v_key := 'schedule:' || r.appointment_id::text;
    v_lane := CASE
      WHEN r.delivery_lane IN ('test', 'live') THEN r.delivery_lane
      ELSE 'live'
    END;

    v_payload := COALESCE(r.stored_payload, '{}'::jsonb);
    v_channel := lower(trim(COALESCE(
      NULLIF(r.intent_channel, ''),
      CASE lower(trim(COALESCE(r.appointment_channel, '')))
        WHEN 'web' THEN 'web'
        WHEN 'website' THEN 'web'
        WHEN 'whatsapp' THEN 'whatsapp'
        WHEN 'waba' THEN 'whatsapp'
        ELSE 'pending'
      END
    )));

    v_action := lower(trim(COALESCE(v_payload ->> 'action_source', '')));

    -- Revalidar canal: no inventar website.
    IF v_channel = 'web' THEN
      IF v_action = '' OR v_action = 'website' THEN
        v_action := 'website';
        v_status := 'review_hold';
        v_error := 'recovered_missing_schedule_outbox';
      ELSE
        v_status := 'needs_review';
        v_error := 'recovered_channel_action_mismatch';
      END IF;
    ELSIF v_channel = 'whatsapp' THEN
      v_status := 'needs_review';
      v_error := 'whatsapp_schedule_delivery_blocked';
      IF v_action = '' THEN
        v_action := 'business_messaging';
      END IF;
    ELSE
      v_status := 'needs_review';
      v_error := 'channel_pending_evidence';
      v_action := COALESCE(NULLIF(v_action, ''), 'other');
    END IF;

    -- Sin teléfono / payload insuficiente → retener.
    IF NULLIF(trim(COALESCE(r.phone, v_payload ->> 'phone', '')), '') IS NULL THEN
      v_status := 'needs_review';
      v_error := 'recovered_insufficient_payload_phone';
    END IF;

    IF v_payload = '{}'::jsonb THEN
      v_payload := jsonb_build_object(
        'action_source', v_action,
        'phone', r.phone,
        'full_name', r.name,
        'email', r.email,
        'external_id', r.lead_id::text,
        'lead_id', r.lead_id::text,
        'appointment_id', r.appointment_id::text,
        'tenant_id', r.tenant_id,
        'project_id', r.project_id,
        'channel_kind', v_channel,
        'recovered', true
      );
    ELSE
      v_payload := v_payload || jsonb_build_object(
        'recovered', true,
        'action_source', COALESCE(NULLIF(v_payload ->> 'action_source', ''), v_action),
        'channel_kind', v_channel
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
      r.event_id,
      'Schedule',
      r.event_time,
      v_payload,
      v_status,
      v_lane,
      r.lead_id,
      true,
      v_error
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    GET DIAGNOSTICS inserted = ROW_COUNT;
    IF inserted > 0 THEN
      n := n + 1;
    END IF;
  END LOOP;

  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.lv_recover_missing_meta_schedule_outbox(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lv_recover_missing_meta_schedule_outbox(integer)
  TO service_role;

COMMENT ON FUNCTION public.lv_recover_missing_meta_schedule_outbox(integer) IS
  'Recupera Schedule faltante. Revalida canal; sin evidencia → needs_review (nunca asume website). Conserva event_id/time. Solo service_role.';

COMMIT;
