-- Revierte 20260903120000_lead_automation_dashboard.sql
-- El código del frontend vuelve con: git checkout pre-lead-automation-dashboard

DROP FUNCTION IF EXISTS public.get_lead_automation_kpis(uuid, uuid, timestamptz, timestamptz);
DROP VIEW IF EXISTS public.vw_lead_automation_dashboard;

DROP POLICY IF EXISTS "Authenticated read conversations" ON public.conversations;
DROP POLICY IF EXISTS "Authenticated read messages" ON public.messages;
DROP POLICY IF EXISTS "Authenticated read lead_score_events" ON public.lead_score_events;
DROP POLICY IF EXISTS "Authenticated read lead_temperature_history" ON public.lead_temperature_history;
DROP POLICY IF EXISTS "Authenticated read lead_stage_history" ON public.lead_stage_history;
DROP POLICY IF EXISTS "Authenticated read bot_escalations" ON public.bot_escalations;
DROP POLICY IF EXISTS "Authenticated read lead_nutrition" ON public.lead_nutrition;
DROP POLICY IF EXISTS "Authenticated read nutrition_delivery_history" ON public.nutrition_delivery_history;
DROP POLICY IF EXISTS "Authenticated read lead_scoring_rules" ON public.lead_scoring_rules;

DROP INDEX IF EXISTS public.idx_conversations_lead_id;
DROP INDEX IF EXISTS public.idx_messages_conversation_sent;
DROP INDEX IF EXISTS public.idx_lead_temp_hist_lead_created;
DROP INDEX IF EXISTS public.idx_lead_stage_hist_lead_created;
DROP INDEX IF EXISTS public.idx_appointments_lead_requested;
DROP INDEX IF EXISTS public.idx_leads_tenant_created;
