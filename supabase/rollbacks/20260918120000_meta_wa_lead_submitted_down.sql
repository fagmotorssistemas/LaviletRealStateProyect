-- Emergencia manual. No usar como rollback operativo por defecto.
-- Preferir apagar flags META_WA_LEAD_SUBMITTED_* (conserva datos).

BEGIN;

DROP FUNCTION IF EXISTS public.lv_register_wa_lead_submitted_intent(uuid, uuid, bigint, text, jsonb, text);
DROP FUNCTION IF EXISTS public.lv_set_whatsapp_meta_ads_consent(uuid, boolean, text, text, text);
DROP FUNCTION IF EXISTS public.lv_set_whatsapp_meta_ads_consent(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.lv_log_meta_conversion(text, text, text, uuid, text, uuid, uuid, uuid, text, text, jsonb);

DROP TABLE IF EXISTS public.meta_capi_conversion_log;

ALTER TABLE public.leads
  DROP COLUMN IF EXISTS meta_wa_lead_submitted_event_id,
  DROP COLUMN IF EXISTS meta_wa_lead_submitted_event_time,
  DROP COLUMN IF EXISTS meta_wa_lead_submitted_at,
  DROP COLUMN IF EXISTS meta_ads_consent_evidence_message,
  DROP COLUMN IF EXISTS meta_ads_consent_evidence_at,
  DROP COLUMN IF EXISTS meta_ads_consent_scope;

ALTER TABLE public.meta_ads_consent_ledger
  DROP COLUMN IF EXISTS evidence_message,
  DROP COLUMN IF EXISTS evidence_scope,
  DROP COLUMN IF EXISTS evidence_at;

-- Restaurar CHECK sin LeadSubmitted solo si no quedan filas LeadSubmitted.
ALTER TABLE public.meta_capi_outbox
  DROP CONSTRAINT IF EXISTS meta_capi_outbox_event_name_check;

ALTER TABLE public.meta_capi_outbox
  ADD CONSTRAINT meta_capi_outbox_event_name_check
  CHECK (event_name IN ('ViewContent', 'Lead', 'Schedule'));

COMMIT;
