CREATE OR REPLACE FUNCTION public.lv_collect_visit_intake(p_lead uuid,p_message text,p_needs_help boolean DEFAULT false,p_previous_request uuid DEFAULT NULL,p_snapshot jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE c public.conversations; m public.messages; draft public.lv_visit_intakes; r public.appointment_reschedule_requests;
 slot jsonb; day date; zone text; config jsonb; appt uuid; period text; content text; parent public.appointment_reschedule_requests; a public.appointments; v_sla integer; review_reason text;
BEGIN
 SELECT cv.* INTO c FROM public.conversations cv JOIN public.messages msg ON msg.conversation_id=cv.id
 WHERE cv.lead_id=p_lead AND cv.project_id='b1b2c3d4-0001-4000-8000-000000000001' AND cv.tenant_id='a1b2c3d4-0001-4000-8000-000000000001'
 AND cv.channel='whatsapp' AND msg.role='cliente' AND (msg.external_message_id=p_message OR msg.id::text=p_message) LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Mensaje de visita no verificado'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':'||c.project_id::text,0));
 PERFORM 1 FROM public.leads WHERE id=p_lead FOR UPDATE;
 SELECT * INTO m FROM public.messages WHERE conversation_id=c.id AND role='cliente' AND (external_message_id=p_message OR id::text=p_message) LIMIT 1;
 INSERT INTO public.lv_visit_intakes(conversation_id,lead_id,tenant_id,project_id) VALUES(c.id,c.lead_id,c.tenant_id,c.project_id) ON CONFLICT DO NOTHING;
 SELECT * INTO draft FROM public.lv_visit_intakes WHERE conversation_id=c.id FOR UPDATE;
 IF draft.status='submitted' AND m.id=ANY(draft.source_ids) THEN
  SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=draft.request_id;
  RETURN jsonb_build_object('action','submitted','request_id',draft.request_id,'slot',public.lv_requested_visit_slot(r),'needs_help',draft.needs_help);
 END IF;
 IF draft.status='submitted' THEN draft.source_ids:='{}'; draft.needs_help:=false; draft.preferred_period:=NULL; draft.previous_request_id:=NULL; END IF;
 p_previous_request:=coalesce(p_previous_request,draft.previous_request_id);
 IF p_previous_request IS NOT NULL THEN
  SELECT * INTO parent FROM public.appointment_reschedule_requests WHERE id=p_previous_request AND lead_id=p_lead AND project_id=c.project_id AND tenant_id=c.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
  IF p_snapshot IS NOT NULL AND (p_snapshot->>'updated_at')::timestamptz IS DISTINCT FROM parent.updated_at THEN RETURN jsonb_build_object('action','stale'); END IF;
  SELECT * INTO a FROM public.appointments WHERE id=parent.appointment_id FOR UPDATE;
  IF a.status IN ('cancelado','atendido') OR a.no_show IS TRUE THEN RETURN jsonb_build_object('action','stale'); END IF;
  IF EXISTS(SELECT 1 FROM public.appointment_reschedule_requests q WHERE q.appointment_id=a.id AND q.id<>parent.id AND q.created_at>parent.created_at) THEN RETURN jsonb_build_object('action','stale'); END IF;
  r.appointment_id:=a.id; r.previous_request_id:=parent.id;
  draft.previous_request_id:=parent.id;
 END IF;
 r.tenant_id:=c.tenant_id; r.project_id:=c.project_id; r.lead_id:=p_lead; r.source_message_id:=p_message; r.source_message_text:=m.content;
 r.proposed_by:='client'; r.created_at:=m.sent_at;
 SELECT array_agg(DISTINCT x::uuid) INTO draft.source_ids FROM (
  SELECT unnest(draft.source_ids)::text x UNION ALL SELECT v->>'id' FROM jsonb_array_elements(public.lv_visit_request_messages(r)) v
 ) ids;
 r.intake_source_ids:=draft.source_ids;
 slot:=public.lv_requested_visit_slot(r); day:=(slot->>'requested_date')::date; zone:=slot->>'timezone';
 SELECT string_agg(public.lv_normalize_visit_text(x->>'text'),' ' ORDER BY x->>'sent_at') INTO content
 FROM jsonb_array_elements(public.lv_visit_request_messages(r)) x;
 -- Initial questions about office hours collect the client preference first. Only an existing coordination can request advisor alternatives automatically.
 p_needs_help:=p_needs_help OR coalesce(p_previous_request IS NOT NULL AND (slot->>'confidence') IS DISTINCT FROM 'exact' AND content ~ '\m(?:prefiero|quiero|mejor|deme|denme)\M.*\m(?:otra|otro|otras|otros)\M|\m(?:que|cuales) (?:otras? )?(?:opciones|horarios|alternativas)\M',false);
 period:=CASE WHEN content ~ 'tarde' THEN 'afternoon' WHEN content ~ 'por la manana|en la manana' THEN 'morning' ELSE draft.preferred_period END;
 UPDATE public.lv_visit_intakes SET source_ids=draft.source_ids,status='collecting',needs_help=draft.needs_help OR p_needs_help,
 preferred_period=period,previous_request_id=draft.previous_request_id,updated_at=now() WHERE conversation_id=c.id;
 IF parent.id IS NOT NULL THEN
  UPDATE public.appointment_reschedule_requests SET status='superseded',resolved_at=now(),updated_at=now() WHERE id=parent.id AND status IN ('awaiting_advisor','awaiting_client');
  DELETE FROM public.appointment_time_holds WHERE request_id=parent.id;
  PERFORM public.lv_cancel_pending_visit_outbox(a.id,'cliente está eligiendo un nuevo horario');
 END IF;
 SELECT business_hours INTO config FROM public.project_automation_config WHERE project_id=c.project_id;
 IF day IS NOT NULL AND day<(now() AT TIME ZONE zone)::date THEN RETURN jsonb_build_object('action','past','slot',slot); END IF;
 IF day IS NOT NULL AND NOT coalesce(config ? extract(isodow FROM day)::text,false) THEN review_reason:='closed_day'; p_needs_help:=true; END IF;
 IF slot->>'confidence'='exact' AND NOT public.lv_interval_within_business_hours(c.project_id,(slot->>'start_time')::timestamptz,(slot->>'end_time')::timestamptz) THEN
  review_reason:='outside_hours'; p_needs_help:=true;
 END IF;
 IF slot->>'confidence'='exact' AND (slot->>'start_time')::timestamptz<=now() THEN RETURN jsonb_build_object('action','past','slot',slot); END IF;
 IF review_reason IS NOT NULL THEN UPDATE public.lv_visit_intakes SET needs_help=true WHERE conversation_id=c.id; END IF;
 IF slot->>'confidence'='exact' OR p_needs_help OR draft.needs_help THEN
  IF parent.id IS NULL THEN
   appt:=public.lv_intake_visit_once(p_lead,c.project_id,m.content,NULL,NULL,p_message,m.content);
   SELECT * INTO r FROM public.appointment_reschedule_requests WHERE appointment_id=appt AND source_message_id=p_message ORDER BY created_at DESC LIMIT 1;
  ELSE
   SELECT coalesce(review_sla_minutes,90) INTO v_sla FROM public.project_automation_config WHERE project_id=c.project_id;
   INSERT INTO public.appointment_reschedule_requests(tenant_id,project_id,appointment_id,lead_id,request_type,proposed_by,previous_request_id,status,
     previous_start_time,previous_end_time,preferred_time_text,source_message_text,source_channel,source_message_id,intake_source_ids,
     assigned_advisor_id,assigned_at,escalation_due_at)
   VALUES(c.tenant_id,c.project_id,a.id,p_lead,CASE WHEN a.status IN ('aceptado','reprogramado') THEN 'reschedule' ELSE 'new_appointment' END,
     'client',parent.id,'awaiting_advisor',a.start_time,a.end_time,m.content,m.content,'whatsapp',p_message,draft.source_ids,
     a.responsible_id,now(),now()+make_interval(mins=>coalesce(v_sla,90))) RETURNING * INTO r;
   INSERT INTO public.lv_appointment_assignment_events(tenant_id,project_id,appointment_id,request_id,from_advisor_id,to_advisor_id,action,reason)
   VALUES(c.tenant_id,c.project_id,a.id,r.id,a.responsible_id,a.responsible_id,'counterproposed','client: '||p_message);
   IF a.responsible_id IS NULL THEN PERFORM public.lv_assign_appointment_fairly(r.id,ARRAY[]::uuid[]); END IF;
  END IF;
  IF r.id IS NULL THEN RAISE EXCEPTION 'No se pudo registrar la solicitud'; END IF;
  UPDATE public.appointment_reschedule_requests SET intake_source_ids=draft.source_ids WHERE id=r.id RETURNING * INTO r;
  UPDATE public.lv_visit_intakes SET status='submitted',request_id=r.id WHERE conversation_id=c.id;
  RETURN jsonb_build_object('action','submitted','request_id',r.id,'slot',public.lv_requested_visit_slot(r),'needs_help',p_needs_help OR draft.needs_help,'preferred_period',period,'review_reason',review_reason);
 END IF;
 RETURN jsonb_build_object('action','collecting','slot',slot,'preferred_period',period);
END $fn$;
REVOKE ALL ON FUNCTION public.lv_collect_visit_intake(uuid,text,boolean,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_collect_visit_intake(uuid,text,boolean,uuid,jsonb) TO service_role;


NOTIFY pgrst,'reload schema';
