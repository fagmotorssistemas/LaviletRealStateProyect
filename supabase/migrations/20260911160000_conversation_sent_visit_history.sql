-- Include accepted visit messages in the conversation read model; no message or lead is changed.
CREATE OR REPLACE FUNCTION public.lv_app_conversation_context(p_lead uuid, p_message text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT to_jsonb(context) FROM (WITH actual AS (
 SELECT m.* FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
 WHERE c.lead_id=p_lead AND c.tenant_id='a1b2c3d4-0001-4000-8000-000000000001'::uuid AND c.project_id='b1b2c3d4-0001-4000-8000-000000000001'::uuid
 AND m.role='cliente' AND (m.external_message_id=p_message OR m.id::text=p_message)
 ORDER BY m.sent_at DESC LIMIT 1
), solicitudes AS (
 SELECT DISTINCT ON (r.appointment_id) r.*,r.id AS request_id,a.status AS appointment_status,a.start_time AS appointment_start_time,
 pr.full_name AS advisor_name,
 (SELECT q.payload->>'detail' FROM public.lv_outbox q WHERE q.tenant_id=r.tenant_id
  AND q.project_id=r.project_id AND q.lead_id=r.lead_id AND q.appointment_id=r.appointment_id
  AND q.payload->>'request_id'=r.id::text AND q.kind='visit_propose'
  AND q.status IN ('accepted','delivered') ORDER BY q.accepted_at DESC NULLS LAST LIMIT 1) AS mensaje_propuesta,
 (SELECT max(q.accepted_at) FROM public.lv_outbox q WHERE q.tenant_id=r.tenant_id
  AND q.project_id=r.project_id AND q.lead_id=r.lead_id AND q.appointment_id=r.appointment_id
  AND q.payload->>'request_id'=r.id::text AND q.kind='visit_propose'
  AND q.status IN ('accepted','delivered')) AS propuesta_enviada_at
 FROM public.appointment_reschedule_requests r JOIN public.appointments a
 ON a.id=r.appointment_id AND a.lead_id=r.lead_id AND a.tenant_id=r.tenant_id AND a.project_id=r.project_id
 LEFT JOIN public.profiles pr ON pr.id=r.assigned_advisor_id
 WHERE r.lead_id=p_lead AND r.tenant_id='a1b2c3d4-0001-4000-8000-000000000001'::uuid AND r.project_id='b1b2c3d4-0001-4000-8000-000000000001'::uuid
 AND a.status NOT IN ('cancelado','atendido') AND a.no_show IS NOT TRUE
 AND (a.start_time IS NULL OR a.start_time>now())
 ORDER BY r.appointment_id,r.created_at DESC,r.id DESC
)
SELECT now() AS hora_actual,
 coalesce((SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('requested_slot',public.lv_requested_visit_slot((SELECT r FROM public.appointment_reschedule_requests r WHERE r.id=s.id)))) FROM solicitudes s),'[]'::jsonb) AS propuestas,
 (SELECT sent_at FROM actual) AS mensaje_actual_at,
 coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.sent_at,h.id) FROM (
 SELECT * FROM (
 SELECT m.id::text,m.role::text,m.content,m.sent_at FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
 WHERE c.lead_id=p_lead AND c.tenant_id='a1b2c3d4-0001-4000-8000-000000000001'::uuid AND c.project_id='b1b2c3d4-0001-4000-8000-000000000001'::uuid
 AND m.id IS DISTINCT FROM (SELECT id FROM actual)
 AND m.sent_at <= (SELECT sent_at FROM actual) AND m.model_used IS DISTINCT FROM 'fallback_static'
 UNION ALL
 SELECT 'outbox:'||q.id::text,'bot',q.payload->>'detail',q.accepted_at
 FROM public.lv_outbox q
 WHERE q.lead_id=p_lead AND q.tenant_id='a1b2c3d4-0001-4000-8000-000000000001'::uuid
 AND q.project_id='b1b2c3d4-0001-4000-8000-000000000001'::uuid
 AND q.status IN ('accepted','delivered') AND q.accepted_at <= (SELECT sent_at FROM actual)
 AND nullif(q.payload->>'detail','') IS NOT NULL
 AND NOT EXISTS (SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
   WHERE c.lead_id=p_lead AND c.tenant_id=q.tenant_id AND c.project_id=q.project_id
   AND m.role='bot' AND m.content=q.payload->>'detail'
   AND m.sent_at BETWEEN q.accepted_at-interval '2 minutes' AND q.accepted_at+interval '2 minutes')
 ) timeline ORDER BY sent_at DESC,id DESC LIMIT 24
 ) h),'[]'::jsonb) AS historial) context;
$function$

