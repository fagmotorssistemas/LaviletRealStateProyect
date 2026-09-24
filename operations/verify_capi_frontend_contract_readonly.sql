-- Solo lectura. Proyecto esperado: xhjnyntywqhczdtecgim.
-- No llama RPC comerciales, recuperadores ni funciones de envío.
-- No exporta teléfonos, mensajes, payloads, tokens o URLs privadas.
SELECT current_timestamp AS checked_at,
       expected.name AS function_name,
       p.oid IS NOT NULL AS present,
       pg_get_function_identity_arguments(p.oid) AS arguments,
       p.prosecdef AS security_definer,
       CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('anon', p.oid, 'EXECUTE') END AS anon_execute,
       CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('authenticated', p.oid, 'EXECUTE') END AS authenticated_execute,
       CASE WHEN p.oid IS NOT NULL THEN has_function_privilege('service_role', p.oid, 'EXECUTE') END AS service_role_execute
FROM (VALUES
  ('lv_receive_kommo_observation'), ('lv_record_message_evidence'),
  ('lv_evaluate_message_interest'), ('identify_tour_lead_with_meta_outbox'),
  ('lv_register_meta_schedule_intent'), ('lv_register_wa_lead_submitted_intent'),
  ('lv_log_meta_conversion'), ('lv_record_meta_ads_consent'),
  ('lv_revoke_meta_ads_consent'), ('lv_recover_missing_meta_lead_outbox'),
  ('lv_recover_missing_meta_schedule_outbox')
) AS expected(name)
LEFT JOIN pg_proc p ON p.proname = expected.name
 AND p.pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public')
ORDER BY expected.name;

SELECT event_name, delivery_lane, status, count(*) AS rows,
       max(created_at) AS last_created_at, max(forwarded_at) AS last_forwarded_at
FROM public.meta_capi_outbox
GROUP BY event_name, delivery_lane, status
ORDER BY event_name, delivery_lane, status;

SELECT event_name, delivery_lane, count(DISTINCT event_id) AS distinct_events,
       count(*) FILTER (WHERE details->>'events_received' ~ '^[1-9][0-9]*$') AS positive_events_received,
       count(*) FILTER (WHERE coalesce(details->>'fbtrace_id', '') <> '') AS with_fbtrace,
       max(created_at) AS latest_recorded
FROM public.meta_capi_conversion_log
WHERE stage = 'meta_accepted'
GROUP BY event_name, delivery_lane
ORDER BY event_name, delivery_lane;

SELECT nest_status, count(*) AS rows FROM public.meta_ads_consent_ledger GROUP BY nest_status;

SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid IN ('public.meta_capi_outbox'::regclass, 'public.unit_sales_closings'::regclass)
  AND contype IN ('u', 'c')
ORDER BY table_name, conname;

SELECT tablename, policyname, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('meta_capi_outbox', 'meta_capi_conversion_log', 'meta_ads_consent_ledger', 'unit_sales_closings')
ORDER BY tablename, policyname;
