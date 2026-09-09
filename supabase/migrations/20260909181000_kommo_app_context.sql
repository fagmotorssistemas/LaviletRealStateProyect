-- Lecturas del contexto equivalentes a los SELECT revisados de n8n. NO aplicada.
BEGIN;

CREATE FUNCTION public.lv_app_visit_context(p_job uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $function$
SELECT jsonb_build_object(
  'job', to_jsonb(q),
  'advisor_name', (SELECT full_name FROM public.profiles WHERE id=a.responsible_id),
  'lead', to_jsonb(l),
  'config', to_jsonb(c),
  'route', to_jsonb(rt),
  'appointment', to_jsonb(a),
  'request', to_jsonb(ar),

  'now', now(),

  'event_current',
    public.lv_outbox_event_is_current(q.id),

  'reminders_paused',
    public.appointment_reminders_paused(a.id),

  'revision',
    md5(concat_ws(
      '|',
      a.id,
      a.lead_id,
      a.start_time,
      a.location_type,
      a.office_id,
      a.project_id,
      p.address,
      o.address,
      vp.location_override
    )),

  'last_client_message_at',
    (
      SELECT max(m.sent_at)
      FROM public.messages m
      JOIN public.conversations cv
        ON cv.id = m.conversation_id
      WHERE cv.lead_id = l.id
        AND cv.tenant_id = l.tenant_id
        AND cv.project_id = l.project_id
        AND cv.channel = 'whatsapp'
        AND m.role = 'cliente'
        AND m.sent_at <= now()
    ),

  'recent_jobs',
    COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(x))
        FROM public.lv_outbox x
        WHERE x.lead_id = l.id
          AND x.id <> q.id
          AND (
            x.status IN ('claimed', 'uncertain')
            OR x.accepted_at > now() - interval '24 hours'
          )
      ),
      '[]'::jsonb
    )

) AS data

FROM public.lv_outbox q

JOIN public.leads l
  ON l.id = q.lead_id

JOIN public.lv_auto_config c
  ON c.project_id = l.project_id
  AND c.tenant_id = l.tenant_id

LEFT JOIN public.lv_routes rt
  ON rt.project_id = q.project_id
  AND rt.kind = q.kind

LEFT JOIN public.appointments a
  ON a.id = q.appointment_id

LEFT JOIN public.appointment_reschedule_requests ar
  ON ar.id::text = q.payload->>'request_id'
  AND ar.appointment_id = q.appointment_id
  AND ar.lead_id = q.lead_id
  AND ar.tenant_id = q.tenant_id
  AND ar.project_id = q.project_id

LEFT JOIN public.projects p
  ON p.id = a.project_id
  AND p.tenant_id = a.tenant_id

LEFT JOIN public.offices o
  ON o.id = a.office_id
  AND o.tenant_id = a.tenant_id

LEFT JOIN public.lv_visit_policy vp
  ON vp.appointment_id = a.id

WHERE q.id=p_job AND q.project_id='b1b2c3d4-0001-4000-8000-000000000001' AND q.tenant_id='a1b2c3d4-0001-4000-8000-000000000001';
$function$;

CREATE FUNCTION public.lv_app_visit_candidates() RETURNS SETOF jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $function$
SELECT jsonb_build_object(
  'appointment', to_jsonb(a),
  'lead', to_jsonb(l),
  'config', to_jsonb(c),

  'advisor_name', (
    SELECT pr.full_name
    FROM public.profiles pr
    WHERE pr.id = a.responsible_id
      AND EXISTS (
        SELECT 1
        FROM public.project_salespeople ps
        WHERE ps.salesperson_id = pr.id
          AND ps.tenant_id = a.tenant_id
          AND ps.project_id = a.project_id
      )
  ),
'visit_state',to_jsonb(s),'policy',to_jsonb(v),'now',public.lv_now(l.id),'revision',md5(concat_ws('|',a.id,a.lead_id,a.start_time,a.location_type,a.office_id,a.project_id,p.address,o.address,v.location_override)),
'location',CASE a.location_type WHEN 'proyecto' THEN p.address WHEN 'oficina' THEN o.address END,
'visited_units',coalesce((SELECT jsonb_agg(u.unit_number) FROM appointment_units au JOIN units u ON u.id=au.unit_id
WHERE au.appointment_id=a.id AND au.visited AND u.tenant_id=l.tenant_id AND u.project_id=l.project_id),'[]'),
'jobs',coalesce((SELECT jsonb_agg(to_jsonb(q)) FROM lv_outbox q WHERE q.appointment_id=a.id AND q.status='pending'),'[]')) AS data
FROM appointments a JOIN leads l ON l.id=a.lead_id JOIN lv_auto_config c ON c.project_id=l.project_id AND c.tenant_id=l.tenant_id
LEFT JOIN projects p ON p.id=a.project_id AND p.tenant_id=a.tenant_id LEFT JOIN offices o ON o.id=a.office_id AND o.tenant_id=a.tenant_id
LEFT JOIN lv_visit_policy v ON v.appointment_id=a.id LEFT JOIN lv_visit_state s ON s.appointment_id=a.id
WHERE c.enabled AND (NOT c.test_only OR l.id=c.test_lead_id) AND a.project_id=l.project_id AND a.tenant_id=l.tenant_id AND a.start_time IS NOT NULL AND a.project_id='b1b2c3d4-0001-4000-8000-000000000001' AND a.tenant_id='a1b2c3d4-0001-4000-8000-000000000001';
$function$;

CREATE FUNCTION public.lv_app_conversation_context(p_lead uuid,p_message text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $function$
SELECT to_jsonb(context) FROM (WITH actual AS (
 SELECT m.* FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
 WHERE c.lead_id=p_lead AND c.tenant_id='a1b2c3d4-0001-4000-8000-000000000001'::uuid AND c.project_id='b1b2c3d4-0001-4000-8000-000000000001'::uuid
 AND m.role='cliente' AND (m.external_message_id=p_message OR m.id::text=p_message)
 ORDER BY m.sent_at DESC LIMIT 1
), solicitudes AS (
 SELECT DISTINCT ON (r.appointment_id) r.*,r.id AS request_id,a.status AS appointment_status,
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
 coalesce((SELECT jsonb_agg(to_jsonb(s)) FROM solicitudes s),'[]'::jsonb) AS propuestas,
 (SELECT sent_at FROM actual) AS mensaje_actual_at,
 coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.sent_at,h.id) FROM (
 SELECT m.id,m.role,m.content,m.sent_at FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
 WHERE c.lead_id=p_lead AND c.tenant_id='a1b2c3d4-0001-4000-8000-000000000001'::uuid AND c.project_id='b1b2c3d4-0001-4000-8000-000000000001'::uuid
 AND m.id IS DISTINCT FROM (SELECT id FROM actual)
 AND m.sent_at <= (SELECT sent_at FROM actual) AND m.model_used IS DISTINCT FROM 'fallback_static'
 ORDER BY m.sent_at DESC,m.id DESC LIMIT 12
 ) h),'[]'::jsonb) AS historial) context;
$function$;

REVOKE ALL ON FUNCTION public.lv_app_visit_context(uuid),public.lv_app_visit_candidates(),public.lv_app_conversation_context(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_app_visit_context(uuid),public.lv_app_visit_candidates(),public.lv_app_conversation_context(uuid,text) TO service_role;
COMMIT;
