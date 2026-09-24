-- Solo lectura. No promueve intenciones ni ejecuta envíos CAPI.
SELECT to_regclass('public.meta_hot_lead_signal_intents') AS intents_table,
       to_regprocedure('public.lv_stage_hot_lead_capi_signal()') AS staging_function;

SELECT trigger_name, event_manipulation, action_timing, action_statement
FROM information_schema.triggers
WHERE event_object_schema = 'public'
  AND event_object_table = 'lead_interest_evaluations'
  AND trigger_name = 'stage_hot_lead_capi_signal'
ORDER BY event_manipulation;

SELECT status, unnest(hold_reasons) AS reason, count(*) AS intents
FROM public.meta_hot_lead_signal_intents
GROUP BY status, reason
ORDER BY status, reason;

SELECT count(*) AS ready_or_sent_rows
FROM public.meta_hot_lead_signal_intents
WHERE status NOT IN ('held', 'excluded') OR proposed_event_name IS NOT NULL;

SELECT count(*) AS duplicate_leads
FROM (
  SELECT lead_id FROM public.meta_hot_lead_signal_intents
  GROUP BY lead_id HAVING count(*) > 1
) duplicates;

SELECT count(*) AS historical_lead_submitted_modified
FROM public.meta_capi_outbox o
JOIN public.meta_hot_lead_signal_intents h
  ON o.event_id = h.event_id OR o.idempotency_key = h.idempotency_key;
