-- Optional appointment alternatives, reviewed by an advisor and selected by the lead.
-- No client messages are sent by this migration. Existing single-slot proposals remain valid.
ALTER TABLE public.appointment_reschedule_requests
  ADD COLUMN IF NOT EXISTS proposed_options jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE OR REPLACE FUNCTION public.lv_visit_options_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('version',1,'max_options',3);
$$;
REVOKE ALL ON FUNCTION public.lv_visit_options_capabilities() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lv_visit_options_capabilities() TO authenticated;

CREATE OR REPLACE FUNCTION public.lv_advisor_has_conflict(
 p_advisor_id uuid,p_start timestamptz,p_end timestamptz,p_exclude_appointment uuid DEFAULT NULL
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT p_start IS NOT NULL AND p_end IS NOT NULL AND (
  EXISTS(SELECT 1 FROM public.appointments a WHERE a.responsible_id=p_advisor_id
   AND a.id IS DISTINCT FROM p_exclude_appointment AND a.status IN ('solicitada','pendiente','aceptado','reprogramado')
   AND a.start_time<p_end AND a.end_time>p_start)
  OR EXISTS(SELECT 1 FROM public.appointment_time_holds h WHERE h.advisor_id=p_advisor_id
   AND h.appointment_id IS DISTINCT FROM p_exclude_appointment AND h.expires_at>now()
   AND h.start_time<p_end AND h.end_time>p_start)
  OR EXISTS(SELECT 1 FROM public.appointment_reschedule_requests r WHERE r.assigned_advisor_id=p_advisor_id
   AND r.appointment_id IS DISTINCT FROM p_exclude_appointment AND r.status='awaiting_advisor'
   AND r.proposed_start_time<p_end AND r.proposed_end_time>p_start)
  OR EXISTS(SELECT 1 FROM public.project_salesperson_time_off t WHERE t.salesperson_id=p_advisor_id
   AND t.starts_at<p_end AND t.ends_at>p_start));
$$;

CREATE OR REPLACE FUNCTION public.lv_upsert_hold(p_request public.appointment_reschedule_requests)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_hold integer; slots jsonb; slot jsonb;
BEGIN
 DELETE FROM public.appointment_time_holds WHERE request_id=p_request.id;
 IF p_request.proposed_start_time IS NULL OR p_request.assigned_advisor_id IS NULL THEN RETURN; END IF;
 SELECT coalesce(proposal_hold_minutes,120) INTO v_hold FROM public.project_automation_config WHERE project_id=p_request.project_id;
 slots:=CASE WHEN p_request.status='awaiting_client' AND jsonb_array_length(p_request.proposed_options)>0
  THEN p_request.proposed_options ELSE jsonb_build_array(jsonb_build_object('start_time',p_request.proposed_start_time,'end_time',p_request.proposed_end_time)) END;
 FOR slot IN SELECT value FROM jsonb_array_elements(slots) LOOP
  INSERT INTO public.appointment_time_holds(tenant_id,project_id,appointment_id,request_id,advisor_id,start_time,end_time,expires_at)
  VALUES(p_request.tenant_id,p_request.project_id,p_request.appointment_id,p_request.id,p_request.assigned_advisor_id,
   (slot->>'start_time')::timestamptz,(slot->>'end_time')::timestamptz,
   coalesce(p_request.expires_at,now()+make_interval(mins=>coalesce(v_hold,120))));
 END LOOP;
END;
$$;
REVOKE ALL ON FUNCTION public.lv_upsert_hold(public.appointment_reschedule_requests) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.lv_validate_visit_options(p_request_id uuid,p_options jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.appointment_reschedule_requests; item jsonb; start_at timestamptz; end_at timestamptz; seen timestamptz[]:='{}';
BEGIN
 SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=p_request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
 PERFORM public.lv_assert_can_act_on_request(r);
 IF r.status NOT IN ('awaiting_advisor','awaiting_client') THEN RAISE EXCEPTION 'La solicitud cambió. Actualice la cita.'; END IF;
 IF jsonb_typeof(p_options) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Seleccione entre uno y tres horarios'; END IF;
 IF jsonb_array_length(p_options) NOT BETWEEN 1 AND 3 THEN RAISE EXCEPTION 'Seleccione entre uno y tres horarios'; END IF;
 IF NOT public.lv_advisor_eligible_on_project(r.assigned_advisor_id,r.tenant_id,r.project_id) THEN RAISE EXCEPTION 'El asesor no está disponible para este proyecto'; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_options) LOOP
  start_at:=(item->>'start_time')::timestamptz; end_at:=(item->>'end_time')::timestamptz;
  IF start_at IS NULL OR end_at IS NULL OR end_at-start_at<>interval '1 hour' THEN RAISE EXCEPTION 'Cada opción debe durar 60 minutos'; END IF;
  PERFORM public.lv_assert_visit_slot(r.project_id,start_at,end_at);
  IF start_at=ANY(seen) THEN RAISE EXCEPTION 'Hay horarios repetidos'; END IF;
  seen:=array_append(seen,start_at);
  IF public.lv_advisor_has_conflict(r.assigned_advisor_id,start_at,end_at,r.appointment_id) THEN RAISE EXCEPTION 'Un horario ya está ocupado. Revise las recomendaciones.'; END IF;
 END LOOP;
 RETURN jsonb_build_object('request_version',coalesce(r.updated_at,r.created_at)::text,'source_text',coalesce(r.source_message_text,r.preferred_time_text),
  'address',(SELECT address FROM public.projects WHERE id=r.project_id AND tenant_id=r.tenant_id),
  'map_url',(SELECT visit_location_url FROM public.project_automation_config WHERE project_id=r.project_id AND tenant_id=r.tenant_id),
  'mode',(SELECT mode FROM public.project_automation_config WHERE project_id=r.project_id AND tenant_id=r.tenant_id),
  'launch_destination',(SELECT policies_json->'bot_visits'->>'launch_destination' FROM public.projects WHERE id=r.project_id AND tenant_id=r.tenant_id),
  'messages',coalesce((SELECT jsonb_agg(to_jsonb(m)) FROM (SELECT x.role,x.content,x.sent_at FROM public.messages x
   JOIN public.conversations c ON c.id=x.conversation_id WHERE c.lead_id=r.lead_id AND c.tenant_id=r.tenant_id AND c.project_id=r.project_id
   ORDER BY x.sent_at DESC LIMIT 6) m),'[]'::jsonb));
END;
$$;
REVOKE ALL ON FUNCTION public.lv_validate_visit_options(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lv_validate_visit_options(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.lv_advisor_propose_visit_options(p_request_id uuid,p_options jsonb,p_message text,p_expected_version text)
RETURNS public.appointment_reschedule_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.appointment_reschedule_requests; nxt public.appointment_reschedule_requests; first_slot jsonb;
BEGIN
 SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=p_request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
 PERFORM public.lv_lock_project(r.tenant_id,r.project_id);
 -- The advisor may participate in more than one project.
 PERFORM pg_advisory_xact_lock(hashtext('lv_visit_advisor'),hashtext(r.assigned_advisor_id::text));
 SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=p_request_id FOR UPDATE;
 PERFORM public.lv_assert_can_act_on_request(r);
 IF r.status='superseded' THEN
  SELECT * INTO nxt FROM public.appointment_reschedule_requests n WHERE n.previous_request_id=r.id AND n.proposed_options=p_options
   AND n.status='awaiting_client' AND EXISTS(SELECT 1 FROM public.lv_outbox q WHERE q.payload->>'request_id'=n.id::text AND q.payload->>'message_draft'=p_message) LIMIT 1;
  IF FOUND THEN RETURN nxt; END IF;
 END IF;
 IF coalesce(r.updated_at,r.created_at)::text IS DISTINCT FROM p_expected_version THEN RAISE EXCEPTION 'La solicitud cambió. Genere de nuevo el mensaje.'; END IF;
 PERFORM public.lv_validate_visit_options(r.id,p_options);
 IF p_message IS NULL OR length(trim(p_message))<20 OR length(p_message)>1500 THEN RAISE EXCEPTION 'Revise la vista previa antes de enviar'; END IF;
 first_slot:=p_options->0;
 nxt:=public.lv_advisor_propose_request(r.id,(first_slot->>'start_time')::timestamptz,(first_slot->>'end_time')::timestamptz,NULL);
 UPDATE public.appointment_reschedule_requests SET proposed_options=p_options WHERE id=nxt.id RETURNING * INTO nxt;
 PERFORM public.lv_upsert_hold(nxt);
 UPDATE public.lv_outbox SET payload=payload||jsonb_build_object('options',p_options,'message_draft',p_message,'detail',p_message,'text',p_message,'draft_version',1)
  WHERE payload->>'request_id'=nxt.id::text AND kind='visit_propose' AND status='pending';
 RETURN nxt;
END;
$$;
REVOKE ALL ON FUNCTION public.lv_advisor_propose_visit_options(uuid,jsonb,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lv_advisor_propose_visit_options(uuid,jsonb,text,text) TO authenticated;

-- A bare "sí" cannot silently accept the first of several alternatives.
CREATE OR REPLACE FUNCTION public.lv_guard_visit_option_selection()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF jsonb_array_length(NEW.proposed_options)>1 AND NEW.client_accepted_at IS NOT NULL THEN
  RAISE EXCEPTION 'El cliente debe elegir uno de los horarios propuestos';
 END IF;
 RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS lv_guard_visit_option_selection ON public.appointment_reschedule_requests;
CREATE TRIGGER lv_guard_visit_option_selection BEFORE INSERT OR UPDATE ON public.appointment_reschedule_requests
 FOR EACH ROW EXECUTE FUNCTION public.lv_guard_visit_option_selection();

CREATE OR REPLACE FUNCTION public.lv_client_select_visit_option(p_request_id uuid,p_option_index integer,p_message_id text)
RETURNS public.appointment_reschedule_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r public.appointment_reschedule_requests; slot jsonb;
BEGIN
 SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=p_request_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
 PERFORM public.lv_lock_project(r.tenant_id,r.project_id);
 PERFORM pg_advisory_xact_lock(hashtext('lv_visit_advisor'),hashtext(r.assigned_advisor_id::text));
 SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=p_request_id FOR UPDATE;
 IF r.status='confirmed' AND r.client_acceptance_message_id=p_message_id THEN RETURN r; END IF;
 IF r.status<>'awaiting_client' OR r.proposed_by<>'advisor' OR r.advisor_accepted_at IS NULL
  OR r.expires_at IS NULL OR r.expires_at<=now() THEN RAISE EXCEPTION 'La propuesta ya no está vigente'; END IF;
 IF p_option_index IS NULL OR p_option_index<1 OR p_option_index>jsonb_array_length(r.proposed_options) THEN RAISE EXCEPTION 'Elija una opción de la propuesta vigente'; END IF;
 PERFORM public.lv_assert_client_inbound_message(r,p_message_id);
 IF NOT EXISTS(SELECT 1 FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
  WHERE c.lead_id=r.lead_id AND c.tenant_id=r.tenant_id AND c.project_id=r.project_id AND m.role='cliente'
  AND (m.id::text=p_message_id OR m.external_message_id=p_message_id) AND m.sent_at>=r.created_at AND m.sent_at<=now())
  THEN RAISE EXCEPTION 'La selección requiere una respuesta nueva del cliente'; END IF;
 slot:=r.proposed_options->(p_option_index-1);
 PERFORM public.lv_assert_visit_slot(r.project_id,(slot->>'start_time')::timestamptz,(slot->>'end_time')::timestamptz);
 IF NOT public.lv_advisor_eligible_on_project(r.assigned_advisor_id,r.tenant_id,r.project_id)
  OR public.lv_advisor_has_conflict(r.assigned_advisor_id,(slot->>'start_time')::timestamptz,(slot->>'end_time')::timestamptz,r.appointment_id)
  THEN RAISE EXCEPTION 'Ese horario ya no está disponible'; END IF;
 UPDATE public.appointment_reschedule_requests SET proposed_options=jsonb_build_array(slot),
  proposed_start_time=(slot->>'start_time')::timestamptz,proposed_end_time=(slot->>'end_time')::timestamptz,updated_at=now() WHERE id=r.id;
 RETURN public.lv_client_accept_request(r.id,p_message_id);
END;
$$;
REVOKE ALL ON FUNCTION public.lv_client_select_visit_option(uuid,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_client_select_visit_option(uuid,integer,text) TO service_role;

-- Sending must recheck every alternative, including manual agenda changes after the preview.
CREATE OR REPLACE FUNCTION public.lv_outbox_event_is_current(p_outbox_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE o public.lv_outbox; r public.appointment_reschedule_requests; a public.appointments; item jsonb;
BEGIN
 SELECT * INTO o FROM public.lv_outbox WHERE id=p_outbox_id;
 IF NOT FOUND OR o.status NOT IN ('pending','claimed') THEN RETURN false; END IF;
 SELECT * INTO a FROM public.appointments WHERE id=o.appointment_id;
 IF NOT FOUND THEN RETURN false; END IF;
 IF nullif(o.payload->>'request_id','') IS NOT NULL THEN
  SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=(o.payload->>'request_id')::uuid;
 END IF;
 IF o.kind='visit_propose' THEN
  IF jsonb_array_length(coalesce(r.proposed_options,'[]'::jsonb))>0 THEN
   IF o.payload->'options' IS DISTINCT FROM r.proposed_options THEN RETURN false; END IF;
   FOR item IN SELECT value FROM jsonb_array_elements(r.proposed_options) LOOP
    IF (item->>'start_time')::timestamptz<=now()
     OR NOT public.lv_interval_within_business_hours(r.project_id,(item->>'start_time')::timestamptz,(item->>'end_time')::timestamptz)
     OR public.lv_advisor_has_conflict(r.assigned_advisor_id,(item->>'start_time')::timestamptz,(item->>'end_time')::timestamptz,a.id)
     THEN RETURN false; END IF;
   END LOOP;
  END IF;
  RETURN r.id IS NOT NULL AND r.status='awaiting_client' AND r.proposed_start_time IS NOT NULL
   AND (r.expires_at IS NULL OR r.expires_at>now()) AND a.status NOT IN ('cancelado','atendido')
   AND r.assigned_advisor_id IS NOT NULL AND public.lv_advisor_eligible_on_project(r.assigned_advisor_id,r.tenant_id,r.project_id)
   AND public.lv_interval_within_business_hours(r.project_id,r.proposed_start_time,r.proposed_end_time)
   AND NOT public.lv_advisor_has_conflict(r.assigned_advisor_id,r.proposed_start_time,r.proposed_end_time,a.id)
   AND (o.payload->>'start_time' IS NULL OR (o.payload->>'start_time')::timestamptz IS NOT DISTINCT FROM r.proposed_start_time);
 END IF;
 IF o.kind IN ('visit_confirm','visit_reschedule_confirm') THEN
  RETURN r.id IS NOT NULL AND r.status='confirmed' AND a.status IN ('aceptado','reprogramado')
   AND a.start_time IS NOT DISTINCT FROM r.proposed_start_time AND a.end_time IS NOT DISTINCT FROM r.proposed_end_time
   AND a.responsible_id IS NOT DISTINCT FROM r.assigned_advisor_id
   AND public.lv_advisor_eligible_on_project(a.responsible_id,a.tenant_id,a.project_id)
   AND public.lv_interval_within_business_hours(a.project_id,a.start_time,a.end_time);
 END IF;
 IF o.kind='visit_2h' THEN
  RETURN a.status IN ('aceptado','reprogramado') AND NOT public.appointment_reminders_paused(a.id)
   AND a.start_time IS NOT NULL AND (o.payload->>'start_time' IS NULL OR (o.payload->>'start_time')::timestamptz IS NOT DISTINCT FROM a.start_time);
 END IF;
 RETURN false;
END;
$$;

NOTIFY pgrst, 'reload schema';
