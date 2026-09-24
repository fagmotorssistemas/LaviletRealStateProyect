BEGIN;

-- Separate from CTWA delivery/consent. No historical records are merged or removed.
CREATE TABLE public.marketing_ad_interactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  lead_id uuid NOT NULL REFERENCES public.leads(id),
  contact_id text NOT NULL,
  external_message_id text NOT NULL,
  ad_id text NOT NULL CHECK (ad_id ~ '^[0-9]+$'),
  source_url text,
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (tenant_id, external_message_id)
);
CREATE INDEX marketing_ad_interactions_lead_idx
  ON public.marketing_ad_interactions (tenant_id, lead_id, recorded_at, id);
ALTER TABLE public.marketing_ad_interactions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_ad_interactions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.marketing_ad_interactions TO service_role;

CREATE FUNCTION public.record_marketing_ad_interaction(
  p_tenant_id uuid, p_project_id uuid, p_lead_id uuid, p_contact_id text,
  p_external_message_id text, p_ad_id text, p_source_url text, p_occurred_at timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF p_ad_id IS NULL OR p_ad_id !~ '^[0-9]+$' OR p_occurred_at IS NULL THEN
    RAISE EXCEPTION 'invalid_ad_interaction';
  END IF;
  -- The inbound registration has already verified the Kommo contact and phone.
  -- Bind the referral to that exact persisted message, never to a display name.
  IF NOT EXISTS (
    SELECT 1 FROM public.messages m
    JOIN public.conversations c ON c.id=m.conversation_id
    JOIN public.leads l ON l.id=c.lead_id
    JOIN public.projects p ON p.id=c.project_id
    WHERE m.external_message_id=p_external_message_id AND m.role='cliente'
      AND c.tenant_id=p_tenant_id AND l.tenant_id=p_tenant_id
      AND p.tenant_id=p_tenant_id AND c.project_id=p_project_id
      AND l.id=p_lead_id AND c.external_thread_id=p_contact_id
  ) THEN RAISE EXCEPTION 'ad_interaction_scope_mismatch'; END IF;
  INSERT INTO public.marketing_ad_interactions
    (tenant_id,project_id,lead_id,contact_id,external_message_id,ad_id,source_url,occurred_at)
  VALUES (p_tenant_id,p_project_id,p_lead_id,p_contact_id,p_external_message_id,p_ad_id,
    left(p_source_url,2000),p_occurred_at)
  ON CONFLICT (tenant_id,external_message_id) DO NOTHING;
  IF NOT EXISTS (SELECT 1 FROM public.marketing_ad_interactions
    WHERE tenant_id=p_tenant_id AND external_message_id=p_external_message_id
      AND lead_id=p_lead_id AND ad_id=p_ad_id AND contact_id=p_contact_id) THEN
    RAISE EXCEPTION 'ad_interaction_conflict';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.record_marketing_ad_interaction(uuid,uuid,uuid,text,text,text,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_marketing_ad_interaction(uuid,uuid,uuid,text,text,text,text,timestamptz) TO service_role;
COMMIT;
