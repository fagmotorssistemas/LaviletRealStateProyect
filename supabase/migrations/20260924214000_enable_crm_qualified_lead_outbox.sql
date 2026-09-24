-- QualifiedLead CRM -> CAPI. Preparación segura: desactivada por defecto.
-- Solo nuevas intenciones posteriores al corte se pueden encolar; no hace backfill.

BEGIN;

ALTER TABLE public.meta_capi_outbox
  DROP CONSTRAINT IF EXISTS meta_capi_outbox_event_name_check;

ALTER TABLE public.meta_capi_outbox
  ADD CONSTRAINT meta_capi_outbox_event_name_check
  CHECK (event_name IN (
    'ViewContent', 'Lead', 'Schedule', 'LeadSubmitted',
    'QualifiedLead', 'AddToWishlist', 'Purchase'
  ));

ALTER TABLE public.meta_crm_qualification_intents
  DROP CONSTRAINT IF EXISTS meta_crm_qualification_intents_status_check;

ALTER TABLE public.meta_crm_qualification_intents
  ADD CONSTRAINT meta_crm_qualification_intents_status_check
  CHECK (status IN ('held', 'excluded', 'enqueued'));

CREATE TABLE public.meta_capi_signal_activation (
  signal_kind text PRIMARY KEY CHECK (signal_kind = 'crm_qualification'),
  enabled boolean NOT NULL DEFAULT false,
  cutover_at timestamptz,
  delivery_lane text NOT NULL DEFAULT 'live'
    CHECK (delivery_lane IN ('test', 'live')),
  whatsapp_business_account_id text,
  messaging_dataset_id text,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (whatsapp_business_account_id IS NULL OR
    nullif(trim(whatsapp_business_account_id), '') IS NOT NULL),
  CHECK (messaging_dataset_id IS NULL OR
    nullif(trim(messaging_dataset_id), '') IS NOT NULL),
  CHECK (whatsapp_business_account_id IS NULL OR messaging_dataset_id IS NULL OR
    whatsapp_business_account_id <> messaging_dataset_id)
);

INSERT INTO public.meta_capi_signal_activation(signal_kind, enabled)
VALUES ('crm_qualification', false)
ON CONFLICT (signal_kind) DO NOTHING;

ALTER TABLE public.meta_capi_signal_activation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_capi_signal_activation
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE ON public.meta_capi_signal_activation TO service_role;

CREATE OR REPLACE FUNCTION public.lv_prepare_new_crm_qualification_outbox()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_activation public.meta_capi_signal_activation%ROWTYPE;
  v_inserted integer := 0;
BEGIN
  NEW.proposed_event_name := 'QualifiedLead';
  NEW.hold_reasons := array_remove(
    NEW.hold_reasons,
    'backend_event_contract_pending'
  );

  IF NEW.status = 'excluded' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_activation
  FROM public.meta_capi_signal_activation
  WHERE signal_kind = 'crm_qualification';

  IF NOT FOUND OR v_activation.enabled IS NOT TRUE THEN
    IF NOT ('feature_disabled' = ANY(NEW.hold_reasons)) THEN
      NEW.hold_reasons := array_append(NEW.hold_reasons, 'feature_disabled');
    END IF;
    NEW.status := 'held';
    RETURN NEW;
  END IF;

  IF v_activation.cutover_at IS NULL OR NEW.qualified_at < v_activation.cutover_at THEN
    NEW.status := 'held';
    NEW.hold_reasons := array_append(
      array_remove(NEW.hold_reasons, 'feature_disabled'),
      'before_activation_cutover'
    );
    RETURN NEW;
  END IF;

  IF NEW.ads_consent_snapshot IS FALSE THEN
    NEW.status := 'held';
    RETURN NEW;
  END IF;

  IF nullif(trim(coalesce(NEW.contact_id, '')), '') IS NULL OR
     nullif(trim(coalesce(NEW.ctwa_clid, '')), '') IS NULL OR
     nullif(trim(coalesce(v_activation.whatsapp_business_account_id, '')), '') IS NULL OR
     nullif(trim(coalesce(v_activation.messaging_dataset_id, '')), '') IS NULL THEN
    NEW.status := 'held';
    NEW.hold_reasons := array_append(
      array_remove(NEW.hold_reasons, 'feature_disabled'),
      'qualified_lead_delivery_identifiers_required'
    );
    RETURN NEW;
  END IF;

  INSERT INTO public.meta_capi_outbox (
    idempotency_key, event_id, event_name, event_time, payload, status,
    delivery_lane, lead_id, ads_consent_required, last_error
  ) VALUES (
    NEW.idempotency_key,
    NEW.event_id,
    'QualifiedLead',
    NEW.event_time,
    jsonb_build_object(
      'action_source', 'business_messaging',
      'messaging_channel', 'whatsapp',
      'lead_id', NEW.lead_id,
      'tenant_id', NEW.tenant_id,
      'project_id', NEW.project_id,
      'contact_id', NEW.contact_id,
      'ctwa_clid', NEW.ctwa_clid,
      'whatsapp_business_account_id', v_activation.whatsapp_business_account_id,
      'messaging_dataset_id', v_activation.messaging_dataset_id,
      'qualification_source', 'crm_persisted_evaluation',
      'temperature', NEW.temperature,
      'evidence_labels', to_jsonb(NEW.evidence_labels),
      'initial_lead_submitted_event_id', NEW.initial_lead_submitted_event_id
    ),
    'pending',
    v_activation.delivery_lane,
    NEW.lead_id,
    true,
    NULL
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  GET DIAGNOSTICS v_inserted = ROW_COUNT;
  IF v_inserted = 1 OR EXISTS (
    SELECT 1 FROM public.meta_capi_outbox o
    WHERE o.idempotency_key = NEW.idempotency_key
      AND o.event_id = NEW.event_id
      AND o.event_time = NEW.event_time
      AND o.event_name = 'QualifiedLead'
  ) THEN
    NEW.status := 'enqueued';
    NEW.hold_reasons := '{}';
  ELSE
    NEW.status := 'held';
    NEW.hold_reasons := array_append(
      array_remove(NEW.hold_reasons, 'feature_disabled'),
      'idempotency_key_conflict'
    );
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.lv_prepare_new_crm_qualification_outbox()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS prepare_new_crm_qualification_outbox
  ON public.meta_crm_qualification_intents;
CREATE TRIGGER prepare_new_crm_qualification_outbox
BEFORE INSERT ON public.meta_crm_qualification_intents
FOR EACH ROW
EXECUTE FUNCTION public.lv_prepare_new_crm_qualification_outbox();

-- Aclarar el contrato de filas ya retenidas sin promoverlas ni reescribir su identidad.
UPDATE public.meta_crm_qualification_intents
SET proposed_event_name = 'QualifiedLead',
    hold_reasons = array_remove(hold_reasons, 'backend_event_contract_pending')
WHERE proposed_event_name IS NULL;

COMMENT ON TABLE public.meta_capi_signal_activation IS
  'Corte explícito por señal. enabled=false por defecto; activar no libera intents históricos.';
COMMENT ON FUNCTION public.lv_prepare_new_crm_qualification_outbox() IS
  'Encola atómicamente solo nuevas calificaciones CRM posteriores al corte; sin backfill.';

COMMIT;
