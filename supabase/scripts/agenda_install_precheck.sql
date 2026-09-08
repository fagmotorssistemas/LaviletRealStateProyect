-- Comprobación previa. Solo lectura. No aplicar como migración.
-- Uso: psql o SQL editor. No ejecuta DDL.

-- 1) Funciones de coordinación aún no instaladas
SELECT proname
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND proname IN (
    'lv_advisor_accept_request',
    'lv_confirm_visit_from_request',
    'lv_client_accept_request',
    'lv_escalate_overdue_requests',
    'lv_outbox_event_is_current',
    'lv_appointment_overlap_blockers'
  )
ORDER BY 1;

-- 2) Políticas USING (true) que se reemplazan (no borrar aquí)
SELECT tablename, policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename IN ('appointments', 'project_salespeople', 'appointment_reschedule_requests', 'appointment_change_log')
ORDER BY 1, 2;

-- 3) is_admin es global (role = admin, sin tenant)
SELECT pg_get_functiondef('public.is_admin()'::regprocedure);

-- 4) Solapes que bloquean 20260907220000. No modificar estas filas.
SELECT *
FROM public.appointments a
JOIN public.appointments b
  ON a.responsible_id = b.responsible_id
 AND a.id < b.id
 AND a.status IN ('pendiente', 'aceptado', 'reprogramado')
 AND b.status IN ('pendiente', 'aceptado', 'reprogramado')
 AND a.start_time < b.end_time
 AND a.end_time > b.start_time
WHERE a.responsible_id IS NOT NULL;

-- Pares conocidos en La Vilet (solo diagnóstico):
-- 38c751bf-0b78-42ea-8e4c-29b7723b90ac
-- 5c5951ea-0a86-4d62-9628-2faaefb88a3a
-- responsible_id 23967847-e265-4c8b-ab0c-8c4e6c56008c
-- 2026-07-09 18:25–19:25 y 18:45–19:45 America/Guayaquil (aceptado, scheduled_by asesor)

-- 5) business_hours actual de La Vilet (handoff también lo lee)
SELECT project_id, timezone, business_hours, sla_response_minutes
FROM public.project_automation_config
WHERE project_id = 'b1b2c3d4-0001-4000-8000-000000000001';

-- 6) EXECUTE de request_visit (hoy incluye PUBLIC/anon/authenticated)
SELECT p.proname, pg_get_function_identity_arguments(p.oid), p.proacl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'request_visit';
