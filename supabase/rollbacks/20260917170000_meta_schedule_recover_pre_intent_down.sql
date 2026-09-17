-- Reversión de 20260917170000_meta_schedule_recover_pre_intent.sql
-- EMERGENCIA MANUAL — no es el rollback operativo.
-- Rollback predeterminado: apagar flags Schedule + restaurar código FE/Nest;
-- conservar esquema y datos (no ejecutar este archivo automáticamente).
-- Restaura recover que exige intent previo (versión 17160000).

BEGIN;

DROP FUNCTION IF EXISTS public.lv_recover_missing_meta_schedule_outbox(integer);
DROP FUNCTION IF EXISTS public.lv_recover_missing_meta_schedule_outbox(integer, integer);
DROP INDEX IF EXISTS public.idx_appointments_meta_schedule_recover_pre_intent;

-- La función de 17160000 debe reaplicarse desde ese archivo si se revierte en frío.
-- Aquí se deja un stub seguro que NO inventa website y sigue exigiendo intent
-- (comportamiento pre-gap-fix), para no dejar el entorno sin RPC.

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
      l.email
    FROM public.appointments a
    JOIN public.leads l ON l.id = a.lead_id
    WHERE a.confirmed_by_client IS TRUE
      AND a.status IN ('aceptado', 'reprogramado')
      AND a.meta_schedule_event_id IS NOT NULL
      AND a.meta_schedule_event_time IS NOT NULL
      AND l.meta_ads_consent IS TRUE
      AND NOT EXISTS (
        SELECT 1 FROM public.meta_capi_outbox o
        WHERE o.idempotency_key = 'schedule:' || a.id::text
      )
    ORDER BY a.meta_schedule_intent_at NULLS LAST
    LIMIT GREATEST(1, LEAST(COALESCE(p_limit, 50), 200))
  LOOP
    v_key := 'schedule:' || r.appointment_id::text;
    v_lane := CASE WHEN r.delivery_lane IN ('test', 'live') THEN r.delivery_lane ELSE 'live' END;
    v_payload := COALESCE(r.stored_payload, '{}'::jsonb);
    v_channel := lower(trim(COALESCE(NULLIF(r.intent_channel, ''), 'pending')));
    v_action := lower(trim(COALESCE(v_payload ->> 'action_source', '')));
    IF v_channel = 'web' AND (v_action = '' OR v_action = 'website') THEN
      v_status := 'review_hold'; v_error := 'recovered_missing_schedule_outbox'; v_action := 'website';
    ELSIF v_channel = 'whatsapp' THEN
      v_status := 'needs_review'; v_error := 'whatsapp_schedule_delivery_blocked';
      v_action := COALESCE(NULLIF(v_action, ''), 'business_messaging');
    ELSE
      v_status := 'needs_review'; v_error := 'channel_pending_evidence';
      v_action := COALESCE(NULLIF(v_action, ''), 'other');
    END IF;
    IF NULLIF(trim(COALESCE(r.phone, '')), '') IS NULL THEN
      v_status := 'needs_review'; v_error := 'recovered_insufficient_payload_phone';
    END IF;
    v_payload := CASE WHEN v_payload = '{}'::jsonb THEN jsonb_build_object(
      'action_source', v_action, 'phone', r.phone, 'lead_id', r.lead_id::text,
      'appointment_id', r.appointment_id::text, 'channel_kind', v_channel, 'recovered', true
    ) ELSE v_payload || jsonb_build_object('recovered', true, 'channel_kind', v_channel) END;

    INSERT INTO public.meta_capi_outbox (
      idempotency_key, event_id, event_name, event_time, payload, status,
      delivery_lane, lead_id, ads_consent_required, last_error
    ) VALUES (
      v_key, r.event_id, 'Schedule', r.event_time, v_payload, v_status,
      v_lane, r.lead_id, true, v_error
    ) ON CONFLICT (idempotency_key) DO NOTHING;
    GET DIAGNOSTICS inserted = ROW_COUNT;
    IF inserted > 0 THEN n := n + 1; END IF;
  END LOOP;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.lv_recover_missing_meta_schedule_outbox(integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lv_recover_missing_meta_schedule_outbox(integer)
  TO service_role;

COMMIT;
