-- Ejecutar completo en Supabase SQL Editor. No envía mensajes ni confirma citas.
BEGIN;

-- supabase/migrations/20260914193000_visit_date_context_repair.sql
-- Repair date/time recognition while preserving every original client message.
-- Installing this migration does not confirm, cancel or send any appointment.
CREATE OR REPLACE FUNCTION public.lv_normalize_visit_text(p_text text)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $fn$
DECLARE v text:=lower(translate(coalesce(p_text,''),'áéíóúüñ','aeiouun'));
BEGIN
 v:=regexp_replace(v,'\mma+n+a+(?:n+a+)+\M','manana','g');
 v:=regexp_replace(v,'\mmalana\M','manana','g');
 v:=regexp_replace(v,'\mo+ch+o+i?\M','ocho','g');
 v:=regexp_replace(v,'\mlass+\M','las','g');
 v:=regexp_replace(v,'\men la (manana|tarde|noche)\M','de la \1','g');
 -- Discourse corrections are not a rejection of the supplied date.
 v:=regexp_replace(v,'\mno[, ]+digo\M|\mno[, ]+quise decir\M|\mno[, ]+me refiero a\M','digo','g');
 v:=regexp_replace(v,'^\s*no\s*,\s*(?=(?:para|el|a las?)\M)','','i');
 RETURN v;
END $fn$;
REVOKE ALL ON FUNCTION public.lv_normalize_visit_text(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_normalize_visit_text(text) TO service_role;

CREATE OR REPLACE FUNCTION public.lv_parse_visit_preference(p_text text,p_reference timestamptz,p_timezone text DEFAULT 'America/Guayaquil')
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE
  v text := lower(translate(coalesce(p_text,''),'áéíóúüñ','aeiouun'));
  date_text text; base date; chosen date; matches text[]; clock_parts text[];
  hour_value integer; minute_value integer; meridiem text; day_index integer; delta integer;
  start_value timestamptz; certainty text := 'unknown'; month_index integer;
BEGIN
  IF p_reference IS NULL OR v='' THEN RETURN jsonb_build_object('confidence','unknown'); END IF;
  base := (p_reference AT TIME ZONE p_timezone)::date;
  v := public.lv_normalize_visit_text(v);
  v := regexp_replace(v,'\m([ap])\.?\s*m\.?(?![[:alpha:]])','\1m','g');
  -- Una alternativa, negación o condición no demuestra aceptación de un intervalo único.
  IF v ~ '\m(o|entre|quizas|cancelar|cancelacion)\M|\mno\M|tal vez|proxima semana|\msi\M' THEN
    RETURN jsonb_build_object('confidence','ambiguous');
  END IF;
  date_text := replace(replace(v,'de la manana',''),'por la manana','');
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


CREATE OR REPLACE FUNCTION public.lv_requested_visit_slot(p_request public.appointment_reschedule_requests)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r public.appointment_reschedule_requests; message jsonb; parts jsonb; messages jsonb; current_messages jsonb;
 zone text; day date; new_day date; hours integer[]; mins integer:=0; starts timestamptz; candidates timestamptz[];
 source_at timestamptz; verified boolean:=false; unclear boolean:=false; was_inferred boolean:=false; day_source text; preceding_reply text;
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
   SELECT p_request AS item,0 AS depth
   UNION ALL SELECT prev,lineage.depth+1 FROM public.appointment_reschedule_requests prev JOIN lineage ON prev.id=(lineage.item).previous_request_id
   WHERE lineage.depth<15 AND prev.appointment_id=p_request.appointment_id AND prev.lead_id=p_request.lead_id
     AND prev.project_id=p_request.project_id AND prev.tenant_id=p_request.tenant_id
  ) SELECT (item).* FROM lineage ORDER BY depth DESC
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
    -- A single "mañana" answers AM/PM only when the preceding bot question
    -- explicitly asked that clarification. Otherwise it keeps its calendar meaning.
    IF day IS NOT NULL AND hours IS NOT NULL AND public.lv_normalize_visit_text(message->>'text') ~ '^\s*(?:la )?(?:manana|tarde|noche)\s*$' THEN
     SELECT public.lv_normalize_visit_text(m.content) INTO preceding_reply
      FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
      WHERE c.lead_id=p_request.lead_id AND c.project_id=p_request.project_id AND c.tenant_id=p_request.tenant_id
       AND m.role IN ('bot','asesor') AND m.sent_at<(message->>'sent_at')::timestamptz
      ORDER BY m.sent_at DESC,m.id DESC LIMIT 1;
     IF preceding_reply ~ 'manana.{0,50}(?:tarde|noche)|a\.?\s*m\.?.{0,50}p\.?\s*m' THEN
      parts:=jsonb_build_object('keep_time',true,'period',CASE WHEN public.lv_normalize_visit_text(message->>'text') ~ 'manana' THEN 'morning' ELSE 'afternoon' END);
     END IF;
    END IF;
    new_day:=(parts->>'requested_date')::date;
    IF new_day IS NOT NULL THEN
     IF day IS DISTINCT FROM new_day AND coalesce((parts->>'keep_time')::boolean,false)=false THEN hours:=NULL; END IF;
     day:=new_day; day_source:=message->>'id'; unclear:=false;
    END IF;
    IF parts->>'clear_date'='true' THEN day:=NULL; day_source:=NULL; END IF;
    IF parts->>'clear_time'='true' OR parts->>'ambiguous'='true' THEN hours:=NULL; unclear:=coalesce((parts->>'ambiguous')::boolean,false); END IF;
    IF parts->>'period' IS NOT NULL AND hours IS NOT NULL THEN
     SELECT array_agg(h) INTO hours FROM unnest(hours) h
      WHERE (parts->>'period'='morning' AND h<12) OR (parts->>'period'='afternoon' AND h>=12);
    END IF;
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
  'has_time',hours IS NOT NULL,'hours',to_jsonb(hours),'minute',mins,'inferred_meridiem',was_inferred,'date_source',day_source,
  'source_at',coalesce(source_at,p_request.created_at),'source_verified',verified,
  'source_message_id',p_request.source_message_id,'source_text',coalesce(p_request.source_message_text,p_request.preferred_time_text),
  'source_messages',current_messages,'timezone',zone);
END $fn$;
REVOKE ALL ON FUNCTION public.lv_requested_visit_slot(public.appointment_reschedule_requests) FROM PUBLIC,anon,authenticated;


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
 -- Questions about available alternatives are requests for advisor proposals.
 p_needs_help:=p_needs_help OR coalesce((slot->>'confidence') IS DISTINCT FROM 'exact' AND content ~ '\m(?:prefiero|quiero|mejor|deme|denme)\M.*\m(?:otra|otro|otras|otros)\M|\m(?:que|cuales) (?:otras? )?(?:opciones|horarios|alternativas)\M',false);
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


-- supabase/migrations/20260914200000_visit_proposal_options.sql
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

COMMIT;
