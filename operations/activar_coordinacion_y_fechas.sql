-- La Vilet: fechas de semana siguiente, coordinación humana urgente y horarios de atención.
-- Ejecutar completo en Supabase > SQL Editor. No envía mensajes ni confirma citas al ejecutarlo.
-- La confirmación telefónica requiere después una acción explícita y autenticada del asesor.
BEGIN;

-- supabase/migrations/20260914233000_visit_next_week_context.sql
-- Calendar corrections for explicit next-week preferences. No appointments are
-- confirmed or messages sent by applying this migration. Raw transcripts stay intact.
CREATE OR REPLACE FUNCTION public.lv_parse_visit_preference(p_text text,p_reference timestamptz,p_timezone text DEFAULT 'America/Guayaquil')
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE
  v text := lower(translate(coalesce(p_text,''),'áéíóúüñ','aeiouun'));
  date_text text; base date; chosen date; matches text[]; clock_parts text[];
  hour_value integer; minute_value integer; meridiem text; day_index integer; delta integer;
  start_value timestamptz; month_index integer; next_week boolean; this_week boolean;
BEGIN
  IF p_reference IS NULL OR v='' THEN RETURN jsonb_build_object('confidence','unknown'); END IF;
  base := (p_reference AT TIME ZONE p_timezone)::date;
  v := public.lv_normalize_visit_text(v);
  -- The final explicit correction replaces the earlier preference in this message.
  IF v ~ '\m(mejor|prefiero)\M' THEN v:=regexp_replace(v,'^.*\m(mejor|prefiero)\M\s*','','i'); END IF;
  v := regexp_replace(v,'\m([ap])\.?\s*m\.?(?![[:alpha:]])','\1m','g');
  -- Una alternativa, negación o condición no demuestra aceptación de un intervalo único.
  IF v ~ '\m(o|entre|quizas|cancelar|cancelacion)\M|\mno\M|tal vez|\msi\M' THEN
    RETURN jsonb_build_object('confidence','ambiguous');
  END IF;
  date_text := replace(replace(v,'de la manana',''),'por la manana','');
  next_week := date_text ~ '\m(?:(?:proxima|siguiente) semana|semana (?:proxima|siguiente|entrante|que (?:viene|sigue)))\M';
  this_week := date_text ~ '\m(?:esta semana|semana actual)\M';
  -- A week without its weekday is incomplete; never reuse an earlier day.
  IF (next_week OR this_week) AND date_text !~ '\m(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)\M' THEN
    RETURN jsonb_build_object('confidence','ambiguous');
  END IF;
  IF date_text ~ '\msemanas?\M' AND NOT next_week AND NOT this_week THEN
    RETURN jsonb_build_object('confidence','ambiguous');
  END IF;
  IF (SELECT count(*) FROM regexp_matches(date_text,'\m(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}/[0-9]{1,2}|[0-9]{1,2} de (?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre))\M','g'))>1
    OR (SELECT count(*) FROM regexp_matches(v,'\m[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm|de la manana|de la tarde|de la noche|horas?)\M','g'))>1
    OR (SELECT count(*) FROM regexp_matches(v,'(?:a las?|alas?|desde las?)\s+[0-9]{1,2}','g'))>1 THEN
    RETURN jsonb_build_object('confidence','ambiguous');
  END IF;
  matches := regexp_match(date_text,'\m([0-9]{4})-([0-9]{2})-([0-9]{2})\M');
  IF matches IS NOT NULL THEN
    chosen := make_date(matches[1]::integer,matches[2]::integer,matches[3]::integer);
  ELSE
    matches := regexp_match(date_text,'\m([0-9]{1,2})/([0-9]{1,2})(?:/([0-9]{4}))?\M');
    IF matches IS NOT NULL THEN
      chosen := make_date(coalesce(matches[3]::integer,extract(year FROM base)::integer),matches[2]::integer,matches[1]::integer);
    ELSE
      matches := regexp_match(date_text,'\m([0-9]{1,2}) de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)(?: de ([0-9]{4}))?\M');
      IF matches IS NOT NULL THEN
        month_index := array_position(ARRAY['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'],matches[2]);
        chosen := make_date(coalesce(matches[3]::integer,extract(year FROM base)::integer),month_index,matches[1]::integer);
      ELSIF date_text ~ 'pasado manana' THEN chosen := base+2;
      ELSIF date_text ~ '\mmanana\M' THEN chosen := base+1;
      ELSIF date_text ~ '\mhoy\M' THEN chosen := base;
      ELSE
        matches := regexp_match(date_text,'\m(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\M');
        IF matches IS NOT NULL THEN
          day_index := array_position(ARRAY['lunes','martes','miercoles','jueves','viernes','sabado','domingo'],matches[1]);
          IF next_week OR this_week THEN
            -- Weeks begin on Monday. From Monday 14, next-week Monday is 21.
            chosen := base-extract(isodow FROM base)::integer+day_index+CASE WHEN next_week THEN 7 ELSE 0 END;
          ELSE
            delta := (day_index-extract(isodow FROM base)::integer+7)%7;
            IF delta=0 AND date_text ~ '\m(?:proximo|siguiente)\M' THEN delta := 7; END IF;
            chosen := base+delta;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;
  IF chosen IS NULL THEN RETURN jsonb_build_object('confidence','unknown'); END IF;
  clock_parts := regexp_match(v,'(?:a las?|alas?|desde las?)\s+([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm|de la manana|de la tarde|de la noche|h(?:oras?)?)?');
  IF clock_parts IS NULL THEN
    clock_parts := regexp_match(v,'\m([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm|de la manana|de la tarde|de la noche|h(?:oras?)?)\M');
  END IF;
  IF clock_parts IS NULL THEN RETURN jsonb_build_object('confidence','date_only','requested_date',chosen); END IF;
  hour_value := clock_parts[1]::integer; minute_value := coalesce(clock_parts[2]::integer,0);
  meridiem := coalesce(clock_parts[3],'');
  IF minute_value>59 OR hour_value>23 THEN RETURN jsonb_build_object('confidence','ambiguous','requested_date',chosen); END IF;
  IF meridiem IN ('am','pm','de la manana','de la tarde','de la noche') THEN
    IF hour_value<1 OR hour_value>12 THEN RETURN jsonb_build_object('confidence','ambiguous','requested_date',chosen); END IF;
    hour_value := hour_value%12 + CASE WHEN meridiem IN ('pm','de la tarde','de la noche') THEN 12 ELSE 0 END;
  ELSIF clock_parts[2] IS NULL AND meridiem='' AND hour_value BETWEEN 1 AND 12 THEN
    RETURN jsonb_build_object('confidence','ambiguous','requested_date',chosen);
  END IF;
  start_value := (chosen+make_time(hour_value,minute_value,0)) AT TIME ZONE p_timezone;
  RETURN jsonb_build_object('confidence','exact','requested_date',chosen,'start_time',start_value,'end_time',start_value+interval '1 hour');
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format OR invalid_parameter_value THEN
  RETURN jsonb_build_object('confidence','ambiguous');
END;
$fn$;
REVOKE ALL ON FUNCTION public.lv_parse_visit_preference(text,timestamptz,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.lv_visit_preference_parts(p_text text,p_at timestamptz,p_timezone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE v text:=lower(translate(coalesce(p_text,''),'áéíóúüñ','aeiouun'));
 parsed jsonb; clock_parts text[]; h integer; mins integer; marker text; hours integer[]; token text; ix integer; negated boolean; keep_clock boolean;
BEGIN
 v:=public.lv_normalize_visit_text(v);
 v:=regexp_replace(v,'\m(malana|manana)\M','manana','g');
 v:=regexp_replace(v,'\mlass\M','las','g');
 v:=regexp_replace(v,'no (?:estoy seguro|se)(?: de)?(?: la hora| a que hora)?','', 'g');
 v:=regexp_replace(v,'^\s*si\M[, ]*','','i');
 v:=regexp_replace(v,'\m([ap])\.?\s*m\.?(?![[:alpha:]])','\1m','g');
 -- Rejecting the offered option must not retain its date/hour from the lineage.
 IF v ~ '\m(?:prefiero|quiero|mejor|deme|denme)\M.*\m(?:otra|otro|otras|otros)\M|\m(?:que|cuales) (?:otras? )?(?:opciones|horarios|alternativas)\M'
 AND (public.lv_parse_visit_preference(v,p_at,p_timezone)->>'requested_date') IS NULL
 AND v !~ '\m(?:hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo|[0-9]{4}-[0-9]{2}-[0-9]{2}|[0-9]{1,2}/[0-9]{1,2})\M|\m(?:a las?|las?)\s+(?:[0-9]{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\M' THEN
  RETURN jsonb_build_object('clear_time',true,'clear_date',true,'needs_help',true);
 END IF;
 IF v ~ '\m(mejor|prefiero)\M' THEN v:=regexp_replace(v,'^.*\m(mejor|prefiero)\M\s*','','i'); END IF;
 negated:=v ~ '\mno\M|\m(cancelar|cancelo|cancelacion)\M';
 IF negated THEN RETURN jsonb_build_object('clear_time',true,'clear_date',v ~ 'ese dia|esa fecha|otro dia|otra fecha|manana|hoy|lunes|martes|miercoles|jueves|viernes|sabado|domingo'); END IF;
 IF v ~ '\m(o|entre|quizas)\M|tal vez|mas o menos|alrededor' THEN RETURN jsonb_build_object('ambiguous',true); END IF;
 -- Normalizar horas escritas con palabras, sin reemplazar números de fechas.
 FOR ix IN 1..12 LOOP
  token:=(ARRAY['una','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce'])[ix];
  IF trim(v)=token THEN v:='a las '||ix::text; END IF;
  v:=regexp_replace(v,'(\ma las?|\mlas?)\s+'||token||'\M','\1 '||ix::text,'g');
 END LOOP;
 IF trim(v) ~ '^[0-9]{1,2}$' THEN v:='a las '||trim(v); END IF;
 v:=regexp_replace(v,'([0-9]{1,2})\s+y\s+media\M','\1:30','g');
 v:=regexp_replace(v,'([0-9]{1,2})\s+y\s+cuarto\M','\1:15','g');
 IF v ~ '[0-9]{1,2}\s+(y|menos)\s+' THEN RETURN jsonb_build_object('ambiguous',true); END IF;
 parsed:=public.lv_parse_visit_preference(v,p_at,p_timezone);
 -- No reutilizar el día previo si hay dos fechas o una fecha inválida.
 IF parsed->>'confidence'='ambiguous' AND parsed->>'requested_date' IS NULL THEN
  RETURN jsonb_build_object('ambiguous',true);
 END IF;
 IF (SELECT count(*) FROM regexp_matches(v,'\m[0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)\M','g'))>1
 OR (SELECT count(*) FROM regexp_matches(v,'\m(?:a las?|las?|alas?)\s+[0-9]{1,2}','g'))>1 THEN
  RETURN jsonb_build_object('ambiguous',true);
 END IF;
 clock_parts:=regexp_match(v,'\m(?:a las?|las?|alas?|para las?)\s+([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm|de la manana|de la tarde|de la noche|h(?:oras?)?)?');
 IF clock_parts IS NULL THEN
  clock_parts:=regexp_match(v,'\m([0-9]{1,2})(?::([0-9]{2}))?\s*(am|pm|de la manana|de la tarde|de la noche|h(?:oras?)?)\M');
 END IF;
 IF clock_parts IS NULL THEN clock_parts:=regexp_match(v,'\m([0-9]{1,2}):([0-9]{2})\M'); END IF;
 IF clock_parts IS NULL THEN
  keep_clock:=v ~ 'misma hora|mismo horario|^(?:de |por |en )?la (?:manana|tarde|noche)$';
  RETURN jsonb_build_object('requested_date',parsed->>'requested_date','keep_time',keep_clock,'period',CASE WHEN v ~ '^(?:de |por |en )?la manana$' THEN 'morning' WHEN v ~ '^(?:de |por |en )?la (?:tarde|noche)$' THEN 'afternoon' END,
   'clear_time',NOT keep_clock AND v ~ 'reagendar|reprogramar|cambiar|cambio|otro horario|otra hora|mas tarde|mas temprano|por la (manana|tarde|noche)|en la (manana|tarde|noche)',
   'clear_date',parsed->>'requested_date' IS NULL AND v !~ 'mismo dia' AND v ~ 'reagendar|reprogramar|otro dia|otra fecha');
 END IF;
 h:=clock_parts[1]::integer; mins:=coalesce(clock_parts[2]::integer,0); marker:=coalesce(clock_parts[3],'');
 IF h>23 OR mins>59 THEN RETURN jsonb_build_object('ambiguous',true,'requested_date',parsed->>'requested_date'); END IF;
 IF marker IN ('am','pm','de la manana','de la tarde','de la noche') THEN
  IF h NOT BETWEEN 1 AND 12 THEN RETURN jsonb_build_object('ambiguous',true); END IF;
  hours:=ARRAY[h%12+CASE WHEN marker IN ('pm','de la tarde','de la noche') THEN 12 ELSE 0 END];
 ELSIF h BETWEEN 1 AND 12 AND marker='' AND clock_parts[1] !~ '^0' THEN
  hours:=ARRAY[h%12,h%12+12];
 ELSE hours:=ARRAY[h];
 END IF;
 RETURN jsonb_build_object('requested_date',parsed->>'requested_date','hours',hours,'minute',mins);
END $fn$;
REVOKE ALL ON FUNCTION public.lv_visit_preference_parts(text,timestamptz,text) FROM PUBLIC,anon,authenticated;

NOTIFY pgrst,'reload schema';


-- supabase/migrations/20260915100000_urgent_visit_coordination.sql
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


-- supabase/migrations/20260915101000_visit_hours_before_assignment.sql
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

COMMIT;
