-- Meta CAPI: consentimiento durable + outbox local (sobrevive caída del backend DO)

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS meta_ads_consent boolean,
  ADD COLUMN IF NOT EXISTS meta_ads_consent_at timestamptz;

CREATE TABLE IF NOT EXISTS public.meta_capi_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL UNIQUE,
  event_id uuid NOT NULL,
  event_name text NOT NULL CHECK (event_name IN ('ViewContent', 'Lead', 'Schedule')),
  event_time bigint NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'forwarded', 'cancelled', 'dead')),
  delivery_lane text NOT NULL DEFAULT 'live'
    CHECK (delivery_lane IN ('test', 'live')),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  visitor_key text,
  ads_consent_required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  forwarded_at timestamptz,
  last_error text
);

CREATE INDEX IF NOT EXISTS idx_meta_capi_outbox_status_created
  ON public.meta_capi_outbox (status, created_at);

CREATE INDEX IF NOT EXISTS idx_meta_capi_outbox_lead
  ON public.meta_capi_outbox (lead_id)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meta_capi_outbox_visitor
  ON public.meta_capi_outbox (visitor_key)
  WHERE visitor_key IS NOT NULL;

COMMENT ON TABLE public.meta_capi_outbox IS
  'Cola local Next→lavilet-meta-capi. Persistente si DigitalOcean cae; no bloquea guardado de leads.';
