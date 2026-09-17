-- Preparada para revisión. NO aplicar a Production en este cambio.
-- Cierra el hueco: cita confirmada sin intent → recover crea intent inmutable + outbox.
-- Ventana lookback (default 7d, max 30d): no recupera históricos indiscriminados.

BEGIN;

-- Una sola firma (limit + lookback). Sin sobrecarga (integer): PostgREST/Nest
-- con body {"p_limit":50} no puede resolver dos candidatos homónimos.
DROP FUNCTION IF EXISTS public.lv_recover_missing_meta_schedule_outbox(integer);
DROP FUNCTION IF EXISTS public.lv_recover_missing_meta_schedule_outbox(integer, integer);

CREATE OR REPLACE FUNCTION public.lv_recover_missing_meta_schedule_outbox(
  p_limit integer DEFAULT 50,
  p_lookback_days integer DEFAULT 7
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
  v_event_id uuid;
  v_event_time bigint;
  v_lookback integer;
  v_intent jsonb;
BEGIN
  v_lookback := GREATEST(1, LEAST(COALESCE(p_lookback_days, 7), 30));

  FOR r IN
    SELECT
      a.id AS appointment_id,
      a.lead_id,
      a.meta_schedule_event_id AS event_id,
      a.meta_schedule_event_time AS event_time,
      a.meta_schedule_delivery_lane AS delivery_lane,
      a.meta_schedule_payload AS stored_payload,
      a.meta_schedule_channel AS intent_channel,
      a.confirmed_at,
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
      AND a.confirmed_at IS NOT NULL
      AND a.confirmed_at >= (now() - make_interval(days => v_lookback))
      AND l.meta_ads_consent IS TRUE
      AND NOT EXISTS (
        SELECT 1
        FROM public.meta_capi_outbox o
        WHERE o.idempotency_key = 'schedule:' || a.id::text
      )
    ORDER BY a.confirmed_at ASC NULLS LAST
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  LOOP
    -- Serializa intent+outbox por cita (concurrencia entre recovers).
    PERFORM id FROM public.appointments WHERE id = r.appointment_id FOR UPDATE;

    SELECT
      meta_schedule_event_id,
      meta_schedule_event_time,
      meta_schedule_delivery_lane,
      meta_schedule_payload,
      meta_schedule_channel,
      channel,
      confirmed_at
    INTO
      r.event_id,
      r.event_time,
      r.delivery_lane,
      r.stored_payload,
      r.intent_channel,
      r.appointment_channel,
      r.confirmed_at
    FROM public.appointments
    WHERE id = r.appointment_id;

    -- Re-check outbox tras lock (otro worker pudo insertar).
    IF EXISTS (
      SELECT 1 FROM public.meta_capi_outbox
      WHERE idempotency_key = 'schedule:' || r.appointment_id::text
    ) THEN
      CONTINUE;
    END IF;

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

    -- Sin intent: registrarlo con fecha real de confirmación (inmutable).
    IF r.event_id IS NULL OR r.event_time IS NULL THEN
      v_event_id := gen_random_uuid();
      v_event_time := floor(extract(epoch FROM r.confirmed_at))::bigint;
      v_payload := jsonb_build_object(
        'phone', r.phone,
        'full_name', r.name,
        'email', r.email,
        'external_id', r.lead_id::text,
        'lead_id', r.lead_id::text,
        'appointment_id', r.appointment_id::text,
        'tenant_id', r.tenant_id,
        'project_id', r.project_id,
        'channel_kind', v_channel,
        'recovered_pre_intent', true
      );
      IF v_channel = 'web' THEN
        v_payload := v_payload || jsonb_build_object('action_source', 'website');
      ELSIF v_channel = 'whatsapp' THEN
        v_payload := v_payload || jsonb_build_object(
          'action_source', 'business_messaging',
          'messaging_channel', 'whatsapp'
        );
      END IF;

      v_intent := public.lv_register_meta_schedule_intent(
        r.appointment_id,
        v_event_id,
        v_event_time,
        COALESCE(NULLIF(r.delivery_lane, ''), 'live'),
        v_channel,
        v_payload
      );

      IF COALESCE((v_intent ->> 'ok')::boolean, false) IS NOT TRUE THEN
        CONTINUE;
      END IF;

      r.event_id := (v_intent ->> 'event_id')::uuid;
      r.event_time := (v_intent ->> 'event_time')::bigint;
      r.intent_channel := v_intent ->> 'channel';
      r.delivery_lane := v_intent ->> 'delivery_lane';
      r.stored_payload := v_payload;
    END IF;

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

    IF v_channel = 'web' THEN
      IF v_action = '' OR v_action = 'website' THEN
        v_action := 'website';
        v_status := 'review_hold';
        v_error := CASE
          WHEN COALESCE((v_payload ->> 'recovered_pre_intent')::boolean, false)
            THEN 'recovered_pre_intent_gap'
          ELSE 'recovered_missing_schedule_outbox'
        END;
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

REVOKE ALL ON FUNCTION public.lv_recover_missing_meta_schedule_outbox(integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lv_recover_missing_meta_schedule_outbox(integer, integer)
  TO service_role;

COMMENT ON FUNCTION public.lv_recover_missing_meta_schedule_outbox(integer, integer) IS
  'Recupera Schedule tras confirmación aunque falte intent. Lookback default 7 (máx 30). Nest/PostgREST: {"p_limit":50} usa default de lookback. Sin sobrecarga 1-arg. WhatsApp→needs_review. Solo service_role.';

CREATE INDEX IF NOT EXISTS idx_appointments_meta_schedule_recover_pre_intent
  ON public.appointments (confirmed_at)
  WHERE confirmed_by_client IS TRUE
    AND meta_schedule_event_id IS NULL;

COMMIT;
