-- Preparada para revisión. NO aplicar a Production en este cambio.
-- Intent durable Schedule + recover automático (review_hold, sin promover a pending).
-- Incluye needs_review en el CHECK (quedó fuera en review_hold).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) Status outbox: needs_review + review_hold
-- ---------------------------------------------------------------------------
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

COMMENT ON COLUMN public.meta_capi_outbox.status IS
  'pending=cola activa. review_hold=revisión Schedule (no flush). needs_review=retenido. forwarded/cancelled/dead=terminal.';

-- ---------------------------------------------------------------------------
-- 2) Intent durable en appointments (fecha real de confirmación)
-- ---------------------------------------------------------------------------
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS meta_schedule_event_id uuid,
  ADD COLUMN IF NOT EXISTS meta_schedule_event_time bigint,
  ADD COLUMN IF NOT EXISTS meta_schedule_delivery_lane text
    CHECK (
      meta_schedule_delivery_lane IS NULL
      OR meta_schedule_delivery_lane IN ('test', 'live')
    ),
  ADD COLUMN IF NOT EXISTS meta_schedule_payload jsonb,
  ADD COLUMN IF NOT EXISTS meta_schedule_intent_at timestamptz;

COMMENT ON COLUMN public.appointments.meta_schedule_event_id IS
  'event_id CAPI Schedule; se fija en la confirmación del cliente y se reutiliza en recover/dedupe.';
COMMENT ON COLUMN public.appointments.meta_schedule_event_time IS
  'Unix seconds de la confirmación real (confirmed_at), no Date.now() en recover.';
COMMENT ON COLUMN public.appointments.meta_schedule_payload IS
  'Payload de revisión Schedule (sin PII del asesor). Base para recover si falla outbox.';

CREATE INDEX IF NOT EXISTS idx_appointments_meta_schedule_recover
  ON public.appointments (meta_schedule_intent_at)
  WHERE meta_schedule_event_id IS NOT NULL
    AND confirmed_by_client IS TRUE;

-- ---------------------------------------------------------------------------
-- 3) Recover: inserta review_hold faltante; NUNCA pending (no auto-promueve)
-- ---------------------------------------------------------------------------
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
BEGIN
  FOR r IN
    SELECT
      a.id AS appointment_id,
      a.lead_id,
      a.meta_schedule_event_id AS event_id,
      a.meta_schedule_event_time AS event_time,
      a.meta_schedule_delivery_lane AS delivery_lane,
      a.meta_schedule_payload AS stored_payload,
      a.tenant_id,
      a.project_id,
      a.channel,
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
    IF v_payload = '{}'::jsonb THEN
      v_payload := jsonb_build_object(
        'action_source', 'website',
        'phone', r.phone,
        'full_name', r.name,
        'email', r.email,
        'external_id', r.lead_id::text,
        'lead_id', r.lead_id::text,
        'appointment_id', r.appointment_id::text,
        'tenant_id', r.tenant_id,
        'project_id', r.project_id,
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
      v_key,
      r.event_id,
      'Schedule',
      r.event_time,
      v_payload,
      'review_hold',
      v_lane,
      r.lead_id,
      true,
      'recovered_missing_schedule_outbox'
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
  'Recupera Schedule faltante en outbox como review_hold (nunca pending). Conserva event_time de confirmación. Solo service_role.';

COMMIT;
