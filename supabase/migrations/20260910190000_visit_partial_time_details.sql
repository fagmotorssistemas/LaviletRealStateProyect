-- Horas parciales y solicitudes genéricas de cambio no confirman el intervalo anterior.
CREATE OR REPLACE FUNCTION public.lv_visit_preference_parts(p_text text,p_at timestamptz,p_timezone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE v text:=lower(translate(coalesce(p_text,''),'áéíóúüñ','aeiouun'));
 parsed jsonb; clock_parts text[]; h integer; mins integer; marker text; hours integer[]; token text; ix integer; negated boolean; keep_clock boolean;
BEGIN
 v:=regexp_replace(v,'^\s*si\M[, ]*','','i');
 v:=regexp_replace(v,'([ap])\.?\s*m\.?','\1m','g');
 -- Una corrección al final sustituye lo anterior: «no puedo a esa hora, mejor a las 3».
 IF v ~ '\m(mejor|prefiero)\M' THEN v:=regexp_replace(v,'^.*\m(mejor|prefiero)\M\s*','','i'); END IF;
 negated:=v ~ '\mno\M|\m(cancelar|cancelo|cancelacion)\M';
 IF negated THEN RETURN jsonb_build_object('clear_time',true,'clear_date',v ~ 'ese dia|esa fecha|otro dia|otra fecha'); END IF;
 IF v ~ '\m(o|entre|quizas)\M|tal vez|mas o menos|alrededor|proxima semana' THEN RETURN jsonb_build_object('ambiguous',true); END IF;
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
  keep_clock:=v ~ 'misma hora|mismo horario';
  RETURN jsonb_build_object('requested_date',parsed->>'requested_date','keep_time',keep_clock,
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

CREATE OR REPLACE FUNCTION public.lv_requested_visit_slot(p_request public.appointment_reschedule_requests)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r public.appointment_reschedule_requests; message jsonb; parts jsonb; messages jsonb; current_messages jsonb;
 zone text; day date; new_day date; hours integer[]; mins integer:=0; starts timestamptz; candidates timestamptz[];
 source_at timestamptz; verified boolean:=false; unclear boolean:=false; was_inferred boolean:=false; day_source text;
BEGIN
 SELECT coalesce(timezone,'America/Guayaquil') INTO zone FROM public.project_automation_config WHERE project_id=p_request.project_id;
 zone:=coalesce(zone,'America/Guayaquil');
 current_messages:=public.lv_visit_request_messages(p_request);
 SELECT (x->>'sent_at')::timestamptz INTO source_at FROM jsonb_array_elements(current_messages) x
 WHERE x->>'id'=p_request.source_message_id OR x->>'external_id'=p_request.source_message_id LIMIT 1;
 verified:=source_at IS NOT NULL;
 -- Una propuesta del asesor tiene intervalo propio. Una contrapropuesta del cliente se reconstruye desde su evidencia.
 IF p_request.proposed_by='advisor' THEN
  day:=(p_request.proposed_start_time AT TIME ZONE zone)::date; starts:=p_request.proposed_start_time;
  IF jsonb_array_length(current_messages)=0 AND p_request.previous_request_id IS NOT NULL THEN
   SELECT public.lv_visit_request_messages(prev) INTO current_messages FROM public.appointment_reschedule_requests prev
   WHERE prev.id=p_request.previous_request_id AND prev.appointment_id=p_request.appointment_id
     AND prev.lead_id=p_request.lead_id AND prev.project_id=p_request.project_id AND prev.tenant_id=p_request.tenant_id;
  END IF;
 ELSE
  FOR r IN WITH RECURSIVE lineage AS (
   SELECT q.*,0 AS depth FROM public.appointment_reschedule_requests q WHERE q.id=p_request.id
   UNION ALL
   SELECT prev.*,lineage.depth+1 FROM public.appointment_reschedule_requests prev JOIN lineage ON prev.id=lineage.previous_request_id
   WHERE lineage.depth<15 AND prev.appointment_id=p_request.appointment_id AND prev.lead_id=p_request.lead_id
    AND prev.project_id=p_request.project_id AND prev.tenant_id=p_request.tenant_id
  ) SELECT q.* FROM lineage l JOIN public.appointment_reschedule_requests q ON q.id=l.id ORDER BY l.depth DESC
  LOOP
   IF r.proposed_by='advisor' AND r.proposed_start_time IS NOT NULL THEN
    day:=(r.proposed_start_time AT TIME ZONE zone)::date;
    hours:=ARRAY[extract(hour FROM r.proposed_start_time AT TIME ZONE zone)::integer];
    mins:=extract(minute FROM r.proposed_start_time AT TIME ZONE zone)::integer;
    day_source:='proposal'; unclear:=false;
    CONTINUE;
   END IF;
   messages:=public.lv_visit_request_messages(r);
   FOR message IN SELECT x FROM jsonb_array_elements(messages) x LOOP
    parts:=public.lv_visit_preference_parts(message->>'text',(message->>'sent_at')::timestamptz,zone);
    new_day:=(parts->>'requested_date')::date;
    IF new_day IS NOT NULL THEN
     IF day IS DISTINCT FROM new_day AND coalesce((parts->>'keep_time')::boolean,false)=false THEN hours:=NULL; END IF;
     day:=new_day; day_source:=message->>'id'; unclear:=false;
    END IF;
    IF parts->>'clear_date'='true' THEN day:=NULL; day_source:=NULL; END IF;
    IF parts->>'clear_time'='true' OR parts->>'ambiguous'='true' THEN hours:=NULL; unclear:=true; END IF;
    IF parts ? 'hours' THEN
     SELECT array_agg(value::integer) INTO hours FROM jsonb_array_elements_text(parts->'hours');
     mins:=(parts->>'minute')::integer; unclear:=false;
    END IF;
   END LOOP;
  END LOOP;
  IF day IS NOT NULL AND hours IS NOT NULL AND NOT unclear THEN
   IF cardinality(hours)=1 THEN starts:=(day+make_time(hours[1],mins,0)) AT TIME ZONE zone;
   ELSE
    -- Inferir AM/PM solo si la jornada admite una única lectura; no usar huecos libres como evidencia.
    SELECT array_agg(candidate ORDER BY candidate) INTO candidates FROM (
     SELECT (day+make_time(h,mins,0)) AT TIME ZONE zone AS candidate FROM unnest(hours) h
    ) times WHERE public.lv_interval_within_business_hours(p_request.project_id,candidate,candidate+interval '1 hour');
    IF cardinality(candidates)=1 THEN starts:=candidates[1]; was_inferred:=true; END IF;
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object(
  'confidence',CASE WHEN starts IS NOT NULL THEN 'exact' WHEN unclear THEN 'ambiguous' WHEN day IS NOT NULL THEN 'date_only' WHEN hours IS NOT NULL THEN 'time_only' ELSE 'unknown' END,
  'requested_date',day,'start_time',starts,'end_time',starts+interval '1 hour',
  'has_time',hours IS NOT NULL,'inferred_meridiem',was_inferred,'date_source',day_source,
  'source_at',coalesce(source_at,p_request.created_at),'source_verified',verified,
  'source_message_id',p_request.source_message_id,'source_text',coalesce(p_request.source_message_text,p_request.preferred_time_text),
  'source_messages',current_messages,'timezone',zone);
END $fn$;
REVOKE ALL ON FUNCTION public.lv_requested_visit_slot(public.appointment_reschedule_requests) FROM PUBLIC,anon,authenticated;

NOTIFY pgrst,'reload schema';
