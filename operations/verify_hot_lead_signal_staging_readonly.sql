-- Solo lectura. No promueve intenciones ni ejecuta envÃ­os CAPI.
SELECT to_regclass('public.meta_crm_qualification_intents') AS intents_table,
       to_regclass('public.meta_capi_signal_activation') AS activation_table,
       to_regprocedure('public.lv_stage_crm_qualification_capi_signal()') AS staging_function,
       to_regprocedure('public.lv_prepare_new_crm_qualification_outbox()') AS outbox_function;

SELECT signal_kind, enabled, cutover_at, delivery_lane,
       whatsapp_business_account_id IS NOT NULL AS waba_configured,
       messaging_dataset_id IS NOT NULL AS messaging_dataset_configured
FROM public.meta_capi_signal_activation;

SELECT trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'lead_interest_evaluations'
  AND trigger_name = 'stage_crm_qualification_capi_signal'
ORDER BY event_manipulation;

SELECT i.status, r.reason, count(*) AS intents
FROM public.meta_crm_qualification_intents i
CROSS JOIN LATERAL unnest(i.hold_reasons) AS r(reason)
GROUP BY i.status, r.reason
ORDER BY status, reason;

SELECT count(*) AS enqueued_rows
FROM public.meta_crm_qualification_intents
WHERE status = 'enqueued';

SELECT count(*) AS duplicate_leads
FROM (
  SELECT lead_id FROM public.meta_crm_qualification_intents
  GROUP BY lead_id HAVING count(*) > 1
) duplicates;

SELECT i.temperature, e.evidence_label, count(*) AS intents
FROM public.meta_crm_qualification_intents i
CROSS JOIN LATERAL unnest(i.evidence_labels) AS e(evidence_label)
GROUP BY i.temperature, e.evidence_label
ORDER BY temperature, evidence_label;

SELECT count(*) AS historical_lead_submitted_modified
FROM public.meta_capi_outbox o
JOIN public.meta_crm_qualification_intents h
  ON o.event_id = h.event_id OR o.idempotency_key = h.idempotency_key;

SELECT o.event_name, o.delivery_lane, o.status, count(*) AS facts
FROM public.meta_capi_outbox o
WHERE o.event_name = 'QualifiedLead'
GROUP BY o.event_name, o.delivery_lane, o.status
ORDER BY o.delivery_lane, o.status;
