-- Reversión de coordinación. No borra appointment_reschedule_requests ni lv_appointment_bot_*.
-- No restaura "Authenticated all appointments" USING true.
-- No ejecutar en producción desde el agente.

DROP POLICY IF EXISTS appointments_select_scoped ON public.appointments;
DROP POLICY IF EXISTS appointments_insert_scoped ON public.appointments;
DROP POLICY IF EXISTS appointments_update_scoped ON public.appointments;
DROP POLICY IF EXISTS appointment_requests_select ON public.appointment_reschedule_requests;
DROP POLICY IF EXISTS appointment_change_log_select ON public.appointment_change_log;
DROP POLICY IF EXISTS appointment_holds_select ON public.appointment_time_holds;
DROP POLICY IF EXISTS appointment_time_off_select ON public.project_salesperson_time_off;
DROP POLICY IF EXISTS bot_assignments_select ON public.lv_appointment_bot_assignments;
DROP POLICY IF EXISTS bot_history_select ON public.lv_appointment_bot_assignment_history;
DROP POLICY IF EXISTS assignment_events_select ON public.lv_appointment_assignment_events;
DROP POLICY IF EXISTS project_salespeople_select_scoped ON public.project_salespeople;
DROP POLICY IF EXISTS project_salespeople_admin_write ON public.project_salespeople;

DROP FUNCTION IF EXISTS public.lv_release_expired_holds();
DROP FUNCTION IF EXISTS public.lv_outbox_event_is_current(uuid);
DROP FUNCTION IF EXISTS public.lv_escalate_overdue_requests();
DROP FUNCTION IF EXISTS public.lv_client_counterpropose(uuid, timestamptz, timestamptz, text, text, text);
DROP FUNCTION IF EXISTS public.lv_intake_reschedule_request(uuid, text, timestamptz, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.lv_reject_request(uuid, text);
DROP FUNCTION IF EXISTS public.lv_request_reassignment(uuid, text);
DROP FUNCTION IF EXISTS public.lv_reassign_bot_appointment(uuid, text, uuid[]);
DROP FUNCTION IF EXISTS public.lv_client_accept_request(uuid, text);
DROP FUNCTION IF EXISTS public.lv_confirm_visit_from_request(uuid);
DROP FUNCTION IF EXISTS public.lv_advisor_propose_request(uuid, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.lv_advisor_accept_request(uuid);
DROP FUNCTION IF EXISTS public.lv_mark_request_reviewed(uuid);
DROP FUNCTION IF EXISTS public.lv_assert_can_act_on_request(public.appointment_reschedule_requests);
DROP FUNCTION IF EXISTS public.lv_intake_visit_request(uuid, uuid, text, timestamptz, timestamptz, text, text);
DROP FUNCTION IF EXISTS public.lv_build_visit_confirm_message(text, text, timestamptz, text);
DROP FUNCTION IF EXISTS public.lv_format_visit_when(timestamptz);
DROP FUNCTION IF EXISTS public.lv_format_visit_date(timestamptz);
DROP FUNCTION IF EXISTS public.lv_format_visit_clock(timestamptz);
DROP FUNCTION IF EXISTS public.lv_enqueue_visit_outbox(public.appointments, public.appointment_reschedule_requests, text, text, text);
DROP FUNCTION IF EXISTS public.lv_cancel_pending_visit_outbox(uuid, text);
DROP FUNCTION IF EXISTS public.lv_upsert_hold(public.appointment_reschedule_requests);
DROP FUNCTION IF EXISTS public.lv_pick_fair_advisor(uuid, uuid, uuid[]);
DROP FUNCTION IF EXISTS public.lv_list_eligible_bot_advisors(uuid, uuid, timestamptz, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.lv_advisor_eligible_on_project(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.lv_advisor_has_conflict(uuid, timestamptz, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.lv_assert_visit_slot(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.lv_assert_client_inbound_message(public.appointment_reschedule_requests, text);
DROP FUNCTION IF EXISTS public.lv_interval_within_business_hours(uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.lv_can_coordinate();
DROP FUNCTION IF EXISTS public.lv_shares_project(uuid, uuid);
DROP FUNCTION IF EXISTS public.lv_lock_project(uuid, uuid);
DROP FUNCTION IF EXISTS public.lv_appointment_overlap_blockers();
-- No DROP de lv_assign_appointment_fairly: ya existía en vivo.

DROP TABLE IF EXISTS public.appointment_time_holds;
DROP TABLE IF EXISTS public.lv_appointment_assignment_events;
DROP TABLE IF EXISTS public.project_salesperson_time_off;

ALTER TABLE public.project_automation_config
  DROP COLUMN IF EXISTS visit_location_url,
  DROP COLUMN IF EXISTS review_sla_minutes,
  DROP COLUMN IF EXISTS proposal_hold_minutes,
  DROP COLUMN IF EXISTS max_auto_reassignments;

ALTER TABLE public.project_salespeople
  DROP COLUMN IF EXISTS receives_bot_appointments;
