-- PREPARADA, NO APLICADA.
-- Persiste la primera calificaciÃ³n tibia o caliente comprobada sin encolarla para Meta.
-- No calcula puntos, no cambia temperaturas y no reinterpreta histÃ³ricos.

BEGIN;

CREATE TABLE public.meta_crm_qualification_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_kind text NOT NULL DEFAULT 'crm_qualification'
    CHECK (signal_kind = 'crm_qualification'),
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  evaluation_id uuid NOT NULL REFERENCES public.lead_interest_evaluations(id),
  temperature text NOT NULL CHECK (temperature IN ('tibio', 'caliente')),
  recognized_events jsonb NOT NULL,
  evidence_labels text[] NOT NULL DEFAULT '{}',
  qualified_at timestamptz NOT NULL,
  source_message_id text NOT NULL,
  source_sent_at timestamptz NOT NULL,
  contact_id text,
  attribution_id uuid REFERENCES public.lv_whatsapp_ctwa_attribution(id),
  ctwa_clid text,
  ad_source_id text,
  attribution_message_id text,
  attribution_captured_at timestamptz,
  ads_consent_snapshot boolean,
  initial_lead_submitted_event_id uuid,
  proposed_event_name text,
  event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  event_time bigint NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('held', 'excluded')),
  hold_reasons text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (lead_id, signal_kind),
  UNIQUE (evaluation_id),
  UNIQUE (event_id),
  UNIQUE (idempotency_key)
);

CREATE INDEX meta_crm_qualification_intents_status_created_idx
  ON public.meta_crm_qualification_intents(status, created_at);
CREATE INDEX meta_crm_qualification_intents_scope_idx
  ON public.meta_crm_qualification_intents(tenant_id, project_id, qualified_at);

ALTER TABLE public.meta_crm_qualification_intents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.meta_crm_qualification_intents FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.meta_crm_qualification_intents TO service_role;

CREATE OR REPLACE FUNCTION public.lv_stage_crm_qualification_capi_signal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_attr public.lv_whatsapp_ctwa_attribution%ROWTYPE;
  v_latest_classification text;
  v_internal boolean := false;
  v_test boolean := false;
  v_reasons text[] := ARRAY['backend_event_contract_pending', 'feature_disabled'];
  v_status text := 'held';
  v_labels text[] := '{}';
BEGIN
  IF NEW.temperature NOT IN ('tibio', 'caliente') THEN
    RETURN NEW;
  END IF;

  -- Una temperatura ya existente no es una calificaciÃ³n nueva. La funciÃ³n
  -- canÃ³nica registra el cambio antes de completar esta evaluaciÃ³n.
  IF NOT EXISTS (
    SELECT 1
    FROM public.lead_temperature_history h
    WHERE h.lead_id = NEW.lead_id
      AND h.to_temperature = NEW.temperature
      AND h.from_temperature IS DISTINCT FROM NEW.temperature
      AND h.created_at >= NEW.evaluated_at
  ) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT c.classification INTO v_latest_classification
  FROM public.crm_contact_classifications c
  WHERE c.tenant_id = v_lead.tenant_id AND c.lead_id = v_lead.id
  ORDER BY c.recorded_at DESC, c.id DESC
  LIMIT 1;
  v_internal := v_latest_classification = 'internal';

  SELECT EXISTS (
    SELECT 1 FROM public.lv_auto_config c
    WHERE c.tenant_id = v_lead.tenant_id
      AND c.project_id = v_lead.project_id
      AND c.test_lead_id = v_lead.id
  ) INTO v_test;

  IF nullif(trim(coalesce(v_lead.contact_id, '')), '') IS NOT NULL THEN
    SELECT * INTO v_attr
    FROM public.lv_whatsapp_ctwa_attribution a
    WHERE a.tenant_id = v_lead.tenant_id
      AND a.project_id = v_lead.project_id
      AND a.contact_id = v_lead.contact_id
    ORDER BY a.captured_at ASC, a.id ASC
    LIMIT 1;
  END IF;

  IF v_internal THEN v_reasons := array_append(v_reasons, 'internal_contact'); END IF;
  IF v_test THEN v_reasons := array_append(v_reasons, 'test_contact'); END IF;
  IF v_lead.meta_ads_consent IS FALSE THEN
    v_reasons := array_append(v_reasons, 'ads_consent_revoked');
  END IF;
  IF nullif(trim(coalesce(v_lead.contact_id, '')), '') IS NULL THEN
    v_reasons := array_append(v_reasons, 'contact_identity_required');
  END IF;
  IF v_attr.id IS NULL THEN
    v_reasons := array_append(v_reasons, 'original_ctwa_attribution_required');
  END IF;
  IF v_internal OR v_test THEN v_status := 'excluded'; END IF;

  SELECT coalesce(array_agg(DISTINCT label ORDER BY label), '{}') INTO v_labels
  FROM (
    SELECT CASE value
      WHEN 'asked_financing' THEN 'financiamiento'
      WHEN 'declared_unit_type' THEN 'interes_en_tipo_de_unidad'
      WHEN 'requested_visit' THEN 'cita_solicitada'
      WHEN 'confirmed_visit' THEN 'cita_confirmada'
      ELSE 'otro_motivo_registrado:' || value
    END AS label
    FROM jsonb_array_elements_text(NEW.recognized_events)
  ) evidence;

  INSERT INTO public.meta_crm_qualification_intents (
    lead_id, tenant_id, project_id, evaluation_id, temperature,
    recognized_events, evidence_labels, qualified_at,
    source_message_id, source_sent_at, contact_id,
    attribution_id, ctwa_clid, ad_source_id, attribution_message_id,
    attribution_captured_at, ads_consent_snapshot,
    initial_lead_submitted_event_id, proposed_event_name,
    event_time, idempotency_key, status, hold_reasons
  ) VALUES (
    v_lead.id, v_lead.tenant_id, v_lead.project_id, NEW.id, NEW.temperature,
    NEW.recognized_events, v_labels, NEW.evaluated_at,
    NEW.source_message_id, NEW.source_sent_at, v_lead.contact_id,
    v_attr.id, v_attr.ctwa_clid, v_attr.source_id, v_attr.external_message_id,
    v_attr.captured_at, v_lead.meta_ads_consent,
    v_lead.meta_wa_lead_submitted_event_id, NULL,
    floor(extract(epoch FROM NEW.evaluated_at))::bigint,
    'wa_crm_qualified:' || v_lead.id::text, v_status, v_reasons
  )
  ON CONFLICT (lead_id, signal_kind) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.lv_stage_crm_qualification_capi_signal()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS stage_crm_qualification_capi_signal
  ON public.lead_interest_evaluations;
CREATE TRIGGER stage_crm_qualification_capi_signal
AFTER INSERT OR UPDATE OF temperature ON public.lead_interest_evaluations
FOR EACH ROW
WHEN (NEW.temperature IN ('tibio', 'caliente'))
EXECUTE FUNCTION public.lv_stage_crm_qualification_capi_signal();

COMMENT ON TABLE public.meta_crm_qualification_intents IS
  'Primera calificaciÃ³n CRM tibia/caliente por lead, retenida hasta acordar evento CAPI BM. No es meta_capi_outbox.';

COMMIT;
