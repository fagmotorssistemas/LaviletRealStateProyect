-- Rejected advisor alternatives become a persistent urgent human-coordination
-- item. No WhatsApp send, actual call, or appointment confirmation happens here.
ALTER TABLE public.appointment_reschedule_requests
 ADD COLUMN IF NOT EXISTS coordination_urgent_at timestamptz,
 ADD COLUMN IF NOT EXISTS coordination_summary text;

CREATE OR REPLACE FUNCTION public.lv_escalate_visit_coordination(p_request_id uuid,p_message_id text,p_summary text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.appointment_reschedule_requests; l public.leads; a public.appointments;
 c public.conversations; m public.messages; advisor uuid; v_reason text;
BEGIN
 SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=p_request_id;
 IF NOT FOUND OR r.tenant_id<>'a1b2c3d4-0001-4000-8000-000000000001'::uuid
  OR r.project_id<>'b1b2c3d4-0001-4000-8000-000000000001'::uuid THEN RAISE EXCEPTION 'Solicitud fuera del proyecto'; END IF;
 PERFORM public.lv_lock_project(r.tenant_id,r.project_id);
 SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=p_request_id FOR UPDATE;
 PERFORM public.lv_assert_client_inbound_message(r,p_message_id);
 IF r.coordination_urgent_at IS NOT NULL THEN
  RETURN jsonb_build_object('action','escalated','request_id',r.id,'bot_paused',true,'assigned_advisor_id',r.assigned_advisor_id,'duplicate',true);
 END IF;
 IF r.status<>'awaiting_client' OR r.proposed_by<>'advisor' OR r.advisor_accepted_at IS NULL
  OR (jsonb_array_length(coalesce(r.proposed_options,'[]'::jsonb))=0 AND r.previous_request_id IS NULL)
  THEN RAISE EXCEPTION 'No existe una propuesta del asesor pendiente de respuesta'; END IF;
 SELECT m0.* INTO m FROM public.messages m0 JOIN public.conversations c0 ON c0.id=m0.conversation_id
  WHERE (m0.id::text=p_message_id OR m0.external_message_id=p_message_id) AND m0.role='cliente'
   AND c0.lead_id=r.lead_id AND c0.tenant_id=r.tenant_id AND c0.project_id=r.project_id
   AND m0.sent_at>=r.created_at AND m0.sent_at<=now() ORDER BY m0.sent_at DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'El rechazo requiere una respuesta nueva del cliente'; END IF;
 SELECT * INTO l FROM public.leads WHERE id=r.lead_id AND tenant_id=r.tenant_id AND project_id=r.project_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Lead fuera del contexto'; END IF;
 SELECT * INTO a FROM public.appointments WHERE id=r.appointment_id AND lead_id=l.id AND tenant_id=r.tenant_id AND project_id=r.project_id FOR UPDATE;
 IF NOT FOUND OR a.status IN ('cancelado','atendido') THEN RAISE EXCEPTION 'La cita ya está resuelta'; END IF;
 SELECT * INTO c FROM public.conversations WHERE id=m.conversation_id FOR UPDATE;
 -- Preserve the appointment owner rather than rotating an active coordination.
 advisor:=r.assigned_advisor_id;
 IF advisor IS NOT NULL AND NOT public.lv_advisor_eligible_on_project(advisor,r.tenant_id,r.project_id) THEN advisor:=NULL; END IF;
 IF advisor IS NULL AND l.assigned_to IS NOT NULL AND public.lv_advisor_eligible_on_project(l.assigned_to,r.tenant_id,r.project_id) THEN advisor:=l.assigned_to; END IF;
 v_reason:=coalesce(nullif(left(trim(p_summary),3000),''),'Coordinación urgente: el cliente rechazó las alternativas. Llamar para acordar una visita. Bot pausado.');
 UPDATE public.appointment_reschedule_requests SET status='awaiting_advisor',proposed_by='client',
  coordination_urgent_at=now(),coordination_summary=v_reason,reviewed_at=NULL,
  escalation_due_at=now(),escalated_at=now(),expires_at=NULL,
  proposed_start_time=NULL,proposed_end_time=NULL,proposed_options='[]'::jsonb,
  advisor_accepted_at=NULL,client_accepted_at=NULL,client_acceptance_message_id=NULL,
  assigned_advisor_id=advisor,source_message_id=p_message_id,source_message_text=m.content,
  resolution_notes='Coordinación directa requerida: alternativas rechazadas',updated_at=now()
 WHERE id=r.id;
 DELETE FROM public.appointment_time_holds WHERE request_id=r.id;
 PERFORM public.lv_cancel_pending_visit_outbox(a.id,'coordinación humana urgente; alternativas rechazadas');
 UPDATE public.leads SET bot_enabled=false,assigned_to=coalesce(advisor,assigned_to),
  handoff_status=CASE WHEN advisor IS NULL THEN 'queued' ELSE 'assigned' END,
  handoff_reason=v_reason,handoff_requested_at=now(),
  handoff_assigned_at=CASE WHEN advisor IS NOT NULL THEN now() ELSE NULL END,
  seller_response_due_at=now(),updated_at=now() WHERE id=l.id;
 UPDATE public.conversations SET status='escalada' WHERE id=c.id;
 -- Keep financing or other unresolved work intact. Installations may allow
 -- several escalations or enforce one open escalation per conversation. The
 -- urgent request and assignment event remain the authoritative visit queue
 -- in either schema; a uniqueness conflict must never erase another reason.
 IF NOT EXISTS(SELECT 1 FROM public.bot_escalations e WHERE e.conversation_id=c.id AND e.resolved_at IS NULL AND e.reason=v_reason) THEN
  INSERT INTO public.bot_escalations(conversation_id,assigned_to,reason) VALUES(c.id,advisor,v_reason)
   ON CONFLICT DO NOTHING;
 END IF;
 INSERT INTO public.lv_appointment_assignment_events(tenant_id,project_id,appointment_id,request_id,from_advisor_id,to_advisor_id,action,reason)
  VALUES(r.tenant_id,r.project_id,r.appointment_id,r.id,r.assigned_advisor_id,advisor,'urgent_coordination',v_reason);
 RETURN jsonb_build_object('action','escalated','request_id',r.id,'bot_paused',true,'assigned_advisor_id',advisor);
END;
$$;
REVOKE ALL ON FUNCTION public.lv_escalate_visit_coordination(uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_escalate_visit_coordination(uuid,text,text) TO service_role;

-- The advisor explicitly records a phone agreement; the bot must never create
-- this evidence or resume itself. This RPC does not send a customer message.
CREATE OR REPLACE FUNCTION public.lv_complete_urgent_visit_coordination(p_request_id uuid,p_start timestamptz,p_end timestamptz,p_call_notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.appointment_reschedule_requests; a public.appointments; actor uuid;
BEGIN
 actor:=auth.uid();
 IF actor IS NULL THEN RAISE EXCEPTION 'No autenticado'; END IF;
 SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=p_request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
 PERFORM public.lv_lock_project(r.tenant_id,r.project_id);
 SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=p_request_id FOR UPDATE;
 PERFORM public.lv_assert_can_act_on_request(r);
 IF r.coordination_urgent_at IS NULL OR r.status<>'awaiting_advisor' THEN RAISE EXCEPTION 'La coordinación urgente ya no está pendiente'; END IF;
 IF length(trim(coalesce(p_call_notes,'')))<10 THEN RAISE EXCEPTION 'Describa el horario acordado con el cliente en la llamada'; END IF;
 SELECT * INTO a FROM public.appointments WHERE id=r.appointment_id AND lead_id=r.lead_id AND tenant_id=r.tenant_id AND project_id=r.project_id FOR UPDATE;
 IF NOT FOUND OR a.status IN ('cancelado','atendido') THEN RAISE EXCEPTION 'La cita ya está resuelta'; END IF;
 IF r.assigned_advisor_id IS NULL OR NOT public.lv_advisor_eligible_on_project(r.assigned_advisor_id,r.tenant_id,r.project_id)
  THEN RAISE EXCEPTION 'Asigne un asesor activo antes de registrar el acuerdo'; END IF;
 PERFORM public.lv_assert_visit_slot(r.project_id,p_start,p_end);
 IF public.lv_advisor_has_conflict(r.assigned_advisor_id,p_start,p_end,a.id) THEN RAISE EXCEPTION 'Ese horario ya está ocupado; revise el acuerdo antes de confirmar'; END IF;
 UPDATE public.lv_visit_intakes i SET status='submitted',updated_at=now()
  WHERE i.lead_id=r.lead_id AND i.tenant_id=r.tenant_id AND i.project_id=r.project_id AND i.status='collecting'
   AND (i.request_id=r.id OR i.previous_request_id IN (SELECT q.id FROM public.appointment_reschedule_requests q WHERE q.appointment_id=a.id));
 UPDATE public.appointments SET status=CASE WHEN r.request_type='reschedule' THEN 'reprogramado' ELSE 'aceptado' END,
  start_time=p_start,end_time=p_end,scheduled_at=p_start,responsible_id=r.assigned_advisor_id,
  confirmed_by=actor,confirmed_at=now(),scheduled_by='asesor',confirmed_by_client=false,updated_at=now()
 WHERE id=a.id;
 UPDATE public.appointment_reschedule_requests SET status='confirmed',proposed_start_time=p_start,proposed_end_time=p_end,
  proposed_options='[]'::jsonb,advisor_accepted_at=now(),client_accepted_at=NULL,
  client_acceptance_message_id=NULL,reviewed_at=now(),resolved_at=now(),resolved_by=actor,
  resolution_notes=left(trim(p_call_notes),2000),escalation_due_at=NULL,updated_at=now() WHERE id=r.id;
 DELETE FROM public.appointment_time_holds WHERE request_id=r.id;
 PERFORM public.lv_cancel_pending_visit_outbox(a.id,'acuerdo telefónico registrado por el asesor');
 INSERT INTO public.appointment_change_log(appointment_id,actor_id,action,detail)
  VALUES(a.id,actor,'acuerdo_telefonico',jsonb_build_object('request_id',r.id,'start_time',p_start,'end_time',p_end,
    'notes',left(trim(p_call_notes),2000),'agreement_recorded_by_advisor',true));
 INSERT INTO public.lv_appointment_assignment_events(tenant_id,project_id,appointment_id,request_id,from_advisor_id,to_advisor_id,action,reason,actor_id)
  VALUES(r.tenant_id,r.project_id,a.id,r.id,r.assigned_advisor_id,r.assigned_advisor_id,'coordination_agreed',left(trim(p_call_notes),2000),actor);
 UPDATE public.bot_escalations e SET resolved_at=now() WHERE e.resolved_at IS NULL AND e.reason=r.coordination_summary AND e.conversation_id IN
  (SELECT c.id FROM public.conversations c WHERE c.lead_id=r.lead_id AND c.tenant_id=r.tenant_id AND c.project_id=r.project_id);
 RETURN jsonb_build_object('action','confirmed','appointment_id',a.id,'request_id',r.id,
  'bot_paused',coalesce((SELECT NOT l.bot_enabled FROM public.leads l WHERE l.id=r.lead_id),false));
END;
$$;
REVOKE ALL ON FUNCTION public.lv_complete_urgent_visit_coordination(uuid,timestamptz,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lv_complete_urgent_visit_coordination(uuid,timestamptz,timestamptz,text) TO authenticated;
NOTIFY pgrst,'reload schema';
