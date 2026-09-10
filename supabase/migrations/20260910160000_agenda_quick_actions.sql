-- Acciones rápidas de Agenda. Solo añade funciones; no confirma ni modifica citas al instalar.
CREATE FUNCTION public.lv_parse_visit_preference(p_text text,p_reference timestamptz,p_timezone text DEFAULT 'America/Guayaquil')
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE
  v text := lower(translate(coalesce(p_text,''),'áéíóúüñ','aeiouun'));
  date_text text; base date; chosen date; matches text[]; clock_parts text[];
  hour_value integer; minute_value integer; meridiem text; day_index integer; delta integer;
  start_value timestamptz; certainty text := 'unknown'; month_index integer;
BEGIN
  IF p_reference IS NULL OR v='' THEN RETURN jsonb_build_object('confidence','unknown'); END IF;
  base := (p_reference AT TIME ZONE p_timezone)::date;
  v := regexp_replace(v,'([ap])\.?\s*m\.?','\1m','g');
  -- Una alternativa, negación o condición no demuestra aceptación de un intervalo único.
  IF v ~ '\m(o|entre|quizas|cancelar|cancelacion)\M|no puedo|no me|tal vez|proxima semana|\msi\M' THEN
    RETURN jsonb_build_object('confidence','ambiguous');
  END IF;
  date_text := replace(replace(v,'de la manana',''),'por la manana','');
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
          delta := (day_index-extract(isodow FROM base)::integer+7)%7;
          IF delta=0 AND date_text ~ '\mproximo\M' THEN delta := 7; END IF;
          chosen := base+delta;
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

CREATE FUNCTION public.lv_requested_visit_slot(p_request public.appointment_reschedule_requests)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE source_message public.messages; zone text; resolved jsonb;
BEGIN
  SELECT coalesce(timezone,'America/Guayaquil') INTO zone FROM public.project_automation_config WHERE project_id=p_request.project_id;
  zone := coalesce(zone,'America/Guayaquil');
  SELECT m.* INTO source_message FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
  WHERE c.lead_id=p_request.lead_id AND c.tenant_id=p_request.tenant_id AND c.project_id=p_request.project_id
    AND c.channel='whatsapp' AND m.role='cliente'
    AND (m.external_message_id=p_request.source_message_id OR m.id::text=p_request.source_message_id)
  ORDER BY m.sent_at DESC LIMIT 1;
  IF p_request.proposed_start_time IS NOT NULL AND p_request.proposed_end_time IS NOT NULL THEN
    resolved := jsonb_build_object('confidence','exact','requested_date',(p_request.proposed_start_time AT TIME ZONE zone)::date,
      'start_time',p_request.proposed_start_time,'end_time',p_request.proposed_end_time);
  ELSIF p_request.proposed_by='client' THEN
    resolved := public.lv_parse_visit_preference(coalesce(source_message.content,p_request.source_message_text,p_request.preferred_time_text),
      coalesce(source_message.sent_at,p_request.created_at),zone);
  ELSE resolved := jsonb_build_object('confidence','unknown');
  END IF;
  RETURN resolved || jsonb_build_object('source_at',coalesce(source_message.sent_at,p_request.created_at),
    'source_verified',source_message.id IS NOT NULL,'source_message_id',p_request.source_message_id,
    'source_text',coalesce(source_message.content,p_request.source_message_text,p_request.preferred_time_text),'timezone',zone);
END;
$fn$;
REVOKE ALL ON FUNCTION public.lv_requested_visit_slot(public.appointment_reschedule_requests) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.lv_visit_scheduling_options(p_request_id uuid,p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r public.appointment_reschedule_requests; requested jsonb; desired timestamptz; finish timestamptz;
  zone text; first_day date; today date; slots jsonb; reason text; eligible boolean; available boolean := false;
BEGIN
  SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
  PERFORM public.lv_assert_can_act_on_request(r);
  IF r.status NOT IN ('awaiting_advisor','awaiting_client') THEN RAISE EXCEPTION 'La solicitud cambió. Actualiza la cita.'; END IF;
  requested := public.lv_requested_visit_slot(r);
  zone := requested->>'timezone'; today := (now() AT TIME ZONE zone)::date;
  desired := (requested->>'start_time')::timestamptz; finish := (requested->>'end_time')::timestamptz;
  eligible := public.lv_advisor_eligible_on_project(r.assigned_advisor_id,r.tenant_id,r.project_id);
  IF NOT eligible THEN reason := 'advisor_unavailable';
  ELSIF desired IS NULL THEN reason := 'needs_time';
  ELSIF desired<=now() THEN reason := 'past';
  ELSIF NOT public.lv_interval_within_business_hours(r.project_id,desired,finish) THEN reason := 'outside_hours';
  ELSIF public.lv_advisor_has_conflict(r.assigned_advisor_id,desired,finish,r.appointment_id) THEN reason := 'busy';
  ELSIF r.expires_at IS NOT NULL AND r.expires_at<=now() THEN reason := 'expired';
  ELSE available := true;
  END IF;
  first_day := greatest(today,coalesce(p_day,(requested->>'requested_date')::date,today));
  IF first_day>today+90 OR (p_day IS NOT NULL AND p_day<today) THEN RAISE EXCEPTION 'Elige una fecha entre hoy y los próximos 90 días'; END IF;
  IF eligible THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object('start_time',s,'end_time',s+interval '1 hour')),'[]'::jsonb) INTO slots
    FROM (
      SELECT (d::date+make_interval(mins=>m*30)) AT TIME ZONE zone AS s
      FROM generate_series(first_day::timestamp,(first_day+CASE WHEN p_day IS NULL THEN 13 ELSE 0 END)::timestamp,interval '1 day') d
      CROSS JOIN generate_series(0,47) m
      WHERE (d::date+make_interval(mins=>m*30)) AT TIME ZONE zone > now()+interval '15 minutes'
        AND public.lv_interval_within_business_hours(r.project_id,
          (d::date+make_interval(mins=>m*30)) AT TIME ZONE zone,
          (d::date+make_interval(mins=>m*30+60)) AT TIME ZONE zone)
        AND NOT public.lv_advisor_has_conflict(r.assigned_advisor_id,
          (d::date+make_interval(mins=>m*30)) AT TIME ZONE zone,
          (d::date+make_interval(mins=>m*30+60)) AT TIME ZONE zone,r.appointment_id)
      ORDER BY d,CASE WHEN desired IS NOT NULL THEN abs(extract(epoch FROM (((d::date+make_interval(mins=>m*30)) AT TIME ZONE zone)-desired))) ELSE m*1800 END,m
      LIMIT CASE WHEN p_day IS NULL THEN 3 ELSE 24 END
    ) candidates;
  ELSE slots := '[]'::jsonb;
  END IF;
  RETURN jsonb_build_object('request_id',r.id,'advisor_id',r.assigned_advisor_id,'requested',requested,
    'available',available,'reason',reason,'can_accept',available AND r.status='awaiting_advisor'
      AND r.proposed_by='client' AND (requested->>'source_verified')::boolean,'slots',slots);
END;
$fn$;
REVOKE ALL ON FUNCTION public.lv_visit_scheduling_options(uuid,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lv_visit_scheduling_options(uuid,date) TO authenticated;

CREATE FUNCTION public.lv_accept_client_visit_time(p_request_id uuid,p_expected_start timestamptz,p_expected_end timestamptz,p_source_message_id text)
RETURNS public.appointment_reschedule_requests LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r public.appointment_reschedule_requests; resolved jsonb; start_value timestamptz; end_value timestamptz; kommo_id_value integer;
BEGIN
  SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
  PERFORM public.lv_lock_project(r.tenant_id,r.project_id);
  SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=p_request_id FOR UPDATE;
  PERFORM public.lv_assert_can_act_on_request(r);
  IF r.status='confirmed' AND r.proposed_start_time=p_expected_start AND r.proposed_end_time=p_expected_end THEN RETURN r; END IF;
  IF r.status<>'awaiting_advisor' OR r.proposed_by<>'client' THEN RAISE EXCEPTION 'La solicitud cambió. Actualiza la cita antes de aceptar.'; END IF;
  IF r.source_message_id IS DISTINCT FROM p_source_message_id THEN RAISE EXCEPTION 'El mensaje del cliente cambió'; END IF;
  resolved := public.lv_requested_visit_slot(r);
  start_value := (resolved->>'start_time')::timestamptz; end_value := (resolved->>'end_time')::timestamptz;
  IF resolved->>'confidence' IS DISTINCT FROM 'exact' OR (resolved->>'source_verified')::boolean IS DISTINCT FROM true
    OR start_value IS DISTINCT FROM p_expected_start OR end_value IS DISTINCT FROM p_expected_end THEN
    RAISE EXCEPTION 'No hay un horario inequívoco del cliente que aceptar. Propón un horario para que lo confirme.';
  END IF;
  IF r.expires_at IS NOT NULL AND r.expires_at<=now() THEN RAISE EXCEPTION 'La solicitud venció. Envía una nueva propuesta.'; END IF;
  SELECT kommo_id INTO kommo_id_value FROM public.leads WHERE id=r.lead_id;
  IF EXISTS(SELECT 1 FROM public.lv_integration_events e WHERE e.project_id=r.project_id AND e.kind='inbound'
    AND e.payload->>'kommoId'=kommo_id_value::text AND e.status IN ('pending','processing')) THEN
    RAISE EXCEPTION 'Hay mensajes recientes del cliente por procesar. Actualiza la cita en unos segundos.';
  END IF;
  PERFORM public.lv_assert_visit_slot(r.project_id,start_value,end_value);
  IF NOT public.lv_advisor_eligible_on_project(r.assigned_advisor_id,r.tenant_id,r.project_id)
    OR public.lv_advisor_has_conflict(r.assigned_advisor_id,start_value,end_value,r.appointment_id) THEN
    RAISE EXCEPTION 'Ese horario ya no está disponible. Elige otra recomendación.';
  END IF;
  UPDATE public.appointment_reschedule_requests SET proposed_start_time=start_value,proposed_end_time=end_value,
    client_accepted_at=(resolved->>'source_at')::timestamptz,client_acceptance_message_id=r.source_message_id,
    advisor_accepted_at=now(),escalation_due_at=NULL,updated_at=now()
  WHERE id=r.id;
  RETURN public.lv_confirm_visit_from_request(r.id);
END;
$fn$;
REVOKE ALL ON FUNCTION public.lv_accept_client_visit_time(uuid,timestamptz,timestamptz,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lv_accept_client_visit_time(uuid,timestamptz,timestamptz,text) TO authenticated;
NOTIFY pgrst,'reload schema';
