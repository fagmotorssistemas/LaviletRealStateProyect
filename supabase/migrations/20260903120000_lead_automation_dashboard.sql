-- Dashboard de automatización comercial.
-- Punto de restauración del código: git tag pre-lead-automation-dashboard (ed754ef)
-- Reversión SQL: supabase/migrations/20260903120000_lead_automation_dashboard_down.sql

-- Lectura autenticada de tablas de automatización que ya tenían RLS
-- habilitado pero ninguna policy (PostgREST las devolvía vacías).
-- Mismo criterio que leads/projects: SELECT para authenticated.
-- No se añaden policies de escritura.

DROP POLICY IF EXISTS "Authenticated read conversations" ON public.conversations;
CREATE POLICY "Authenticated read conversations"
  ON public.conversations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read messages" ON public.messages;
CREATE POLICY "Authenticated read messages"
  ON public.messages FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read lead_score_events" ON public.lead_score_events;
CREATE POLICY "Authenticated read lead_score_events"
  ON public.lead_score_events FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read lead_temperature_history" ON public.lead_temperature_history;
CREATE POLICY "Authenticated read lead_temperature_history"
  ON public.lead_temperature_history FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read lead_stage_history" ON public.lead_stage_history;
CREATE POLICY "Authenticated read lead_stage_history"
  ON public.lead_stage_history FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read bot_escalations" ON public.bot_escalations;
CREATE POLICY "Authenticated read bot_escalations"
  ON public.bot_escalations FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read lead_nutrition" ON public.lead_nutrition;
CREATE POLICY "Authenticated read lead_nutrition"
  ON public.lead_nutrition FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read nutrition_delivery_history" ON public.nutrition_delivery_history;
CREATE POLICY "Authenticated read nutrition_delivery_history"
  ON public.nutrition_delivery_history FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Authenticated read lead_scoring_rules" ON public.lead_scoring_rules;
CREATE POLICY "Authenticated read lead_scoring_rules"
  ON public.lead_scoring_rules FOR SELECT TO authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_conversations_lead_id ON public.conversations (lead_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_sent ON public.messages (conversation_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_temp_hist_lead_created ON public.lead_temperature_history (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_stage_hist_lead_created ON public.lead_stage_history (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_appointments_lead_requested ON public.appointments (lead_id, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_tenant_created ON public.leads (tenant_id, created_at DESC);

CREATE OR REPLACE VIEW public.vw_lead_automation_dashboard
WITH (security_invoker = true) AS
SELECT
  l.tenant_id,
  l.project_id,
  p.name AS project_name,
  l.id AS lead_id,
  l.name,
  l.phone,
  l.phone_normalized,
  l.email,
  l.source,
  l.channel_origin AS channel,
  l.source_campaign AS campaign,
  l.created_at,
  l.last_interaction_at,
  l.stage,
  l.stage_reason,
  l.stage_updated_at AS stage_changed_at,
  l.temperature,
  l.temperature_score AS score,
  l.temperature_updated_at,
  l.preferred_category,
  l.purchase_purpose,
  l.bot_enabled,
  l.tracking_consent,
  l.tracking_consent_at,
  l.tracking_opt_out_at,
  l.tracking_opt_out_reason,
  l.handoff_status,
  l.handoff_reason,
  l.handoff_requested_at,
  l.handoff_assigned_at,
  l.assigned_to,
  pr.full_name AS assignee_name,
  pr.kommo_user_id AS assignee_kommo_id,
  l.kommo_id AS lead_kommo_id,
  l.seller_response_due_at,
  l.seller_first_response_at,
  l.admin_escalated_at,
  conv.id AS latest_conversation_id,
  conv.last_message_at AS latest_conversation_at,
  COALESCE(msg.message_count, 0) AS message_count,
  msg.last_message_at,
  COALESCE(vis.visit_count, 0) AS visit_count,
  vis.last_visit_requested_at,
  vis.last_visit_status,
  vis.last_visit_preferred_time,
  th.reason AS last_temperature_reason,
  sh.reason AS last_stage_reason,
  CASE
    WHEN l.seller_response_due_at IS NULL THEN 'no_aplica'
    WHEN l.seller_first_response_at IS NOT NULL THEN 'respondido'
    WHEN l.seller_response_due_at < now() THEN 'vencido'
    ELSE 'pendiente'
  END AS sla_status
FROM public.leads l
LEFT JOIN public.projects p ON p.id = l.project_id
LEFT JOIN public.profiles pr ON pr.id = l.assigned_to
LEFT JOIN LATERAL (
  SELECT c.id, c.last_message_at
  FROM public.conversations c
  WHERE c.lead_id = l.id
  ORDER BY c.last_message_at DESC NULLS LAST, c.started_at DESC
  LIMIT 1
) conv ON true
LEFT JOIN LATERAL (
  SELECT COUNT(*)::integer AS message_count, MAX(m.sent_at) AS last_message_at
  FROM public.messages m
  JOIN public.conversations c ON c.id = m.conversation_id
  WHERE c.lead_id = l.id
) msg ON true
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)::integer AS visit_count,
    (ARRAY_AGG(a.requested_at ORDER BY a.requested_at DESC))[1] AS last_visit_requested_at,
    (ARRAY_AGG(a.status ORDER BY a.requested_at DESC))[1] AS last_visit_status,
    (ARRAY_AGG(a.preferred_time_text ORDER BY a.requested_at DESC))[1] AS last_visit_preferred_time
  FROM public.appointments a
  WHERE a.lead_id = l.id
) vis ON true
LEFT JOIN LATERAL (
  SELECT h.reason
  FROM public.lead_temperature_history h
  WHERE h.lead_id = l.id
  ORDER BY h.created_at DESC
  LIMIT 1
) th ON true
LEFT JOIN LATERAL (
  SELECT h.reason
  FROM public.lead_stage_history h
  WHERE h.lead_id = l.id
  ORDER BY h.created_at DESC
  LIMIT 1
) sh ON true;

COMMENT ON VIEW public.vw_lead_automation_dashboard IS
  'Una fila por lead para monitoreo de automatización. security_invoker=true: hereda RLS de las tablas base. Filtrar siempre por tenant_id (y project_id si aplica).';

GRANT SELECT ON public.vw_lead_automation_dashboard TO authenticated;

CREATE OR REPLACE FUNCTION public.get_lead_automation_kpis(
  p_tenant_id uuid,
  p_project_id uuid DEFAULT NULL,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO public
AS $fn$
  WITH filtered_leads AS (
    SELECT l.*
    FROM public.leads l
    WHERE l.tenant_id = p_tenant_id
      AND (p_project_id IS NULL OR l.project_id = p_project_id)
      AND (p_from IS NULL OR l.created_at >= p_from)
      AND (p_to IS NULL OR l.created_at <= p_to)
  ),
  visits AS (
    SELECT a.*
    FROM public.appointments a
    WHERE a.tenant_id = p_tenant_id
      AND (p_project_id IS NULL OR a.project_id = p_project_id)
      AND (p_from IS NULL OR a.requested_at >= p_from)
      AND (p_to IS NULL OR a.requested_at <= p_to)
  )
  SELECT jsonb_build_object(
    'leads_new', (SELECT COUNT(*)::integer FROM filtered_leads),
    'leads_by_source', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('source', COALESCE(source, 'sin_origen'), 'count', cnt) ORDER BY cnt DESC)
      FROM (
        SELECT source, COUNT(*)::integer AS cnt
        FROM filtered_leads
        GROUP BY source
      ) s
    ), '[]'::jsonb),
    'leads_by_stage', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('stage', stage, 'count', cnt) ORDER BY cnt DESC)
      FROM (
        SELECT stage, COUNT(*)::integer AS cnt
        FROM filtered_leads
        GROUP BY stage
      ) s
    ), '[]'::jsonb),
    'leads_cold', (SELECT COUNT(*)::integer FROM filtered_leads WHERE temperature = 'frio'),
    'leads_warm', (SELECT COUNT(*)::integer FROM filtered_leads WHERE temperature = 'tibio'),
    'leads_hot', (SELECT COUNT(*)::integer FROM filtered_leads WHERE temperature = 'caliente'),
    'reached_hot', (
      SELECT COUNT(*)::integer
      FROM public.lead_temperature_history h
      JOIN public.leads l ON l.id = h.lead_id
      WHERE l.tenant_id = p_tenant_id
        AND (p_project_id IS NULL OR l.project_id = p_project_id)
        AND h.to_temperature = 'caliente'
        AND (p_from IS NULL OR h.created_at >= p_from)
        AND (p_to IS NULL OR h.created_at <= p_to)
    ),
    'handed_off', (
      SELECT COUNT(*)::integer
      FROM filtered_leads
      WHERE handoff_status IN ('assigned', 'acknowledged', 'resolved')
    ),
    'queued', (
      SELECT COUNT(*)::integer
      FROM filtered_leads
      WHERE handoff_status = 'queued'
    ),
    'visits_requested', (SELECT COUNT(*)::integer FROM visits),
    'visits_confirmed', (
      SELECT COUNT(*)::integer
      FROM visits
      WHERE confirmed_by_client = true
         OR status IN ('aceptado', 'atendido')
    ),
    'sla_overdue', (
      SELECT COUNT(*)::integer
      FROM filtered_leads
      WHERE seller_response_due_at IS NOT NULL
        AND seller_first_response_at IS NULL
        AND seller_response_due_at < now()
    ),
    'avg_first_response_minutes', (
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (seller_first_response_at - handoff_assigned_at)) / 60.0)::numeric, 1)
      FROM filtered_leads
      WHERE seller_first_response_at IS NOT NULL
        AND handoff_assigned_at IS NOT NULL
        AND seller_first_response_at >= handoff_assigned_at
    )
  );
$fn$;

COMMENT ON FUNCTION public.get_lead_automation_kpis(uuid, uuid, timestamptz, timestamptz) IS
  'Indicadores agregados del dashboard de automatización. SECURITY INVOKER. p_from/p_to inclusive. Aislar por tenant_id/project_id en la llamada.';

GRANT EXECUTE ON FUNCTION public.get_lead_automation_kpis(uuid, uuid, timestamptz, timestamptz) TO authenticated;
