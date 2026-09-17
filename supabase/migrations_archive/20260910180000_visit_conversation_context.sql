-- Resuelve preferencias por mensajes y por solicitud; no modifica citas al instalar.
CREATE OR REPLACE FUNCTION public.lv_visit_request_messages(p_request public.appointment_reschedule_requests)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
WITH source AS (
 SELECT m.* FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
 WHERE c.lead_id=p_request.lead_id AND c.project_id=p_request.project_id AND c.tenant_id=p_request.tenant_id
 AND c.channel='whatsapp' AND m.role='cliente'
 AND (m.id::text=p_request.source_message_id OR m.external_message_id=p_request.source_message_id)
 ORDER BY m.sent_at DESC LIMIT 1
), boundary AS (
 SELECT coalesce(max(m.sent_at),s.sent_at-interval '30 minutes') AS since,s.id AS source_id
 FROM source s LEFT JOIN public.messages m ON m.conversation_id=s.conversation_id
 AND m.role IN ('bot','asesor') AND m.sent_at<s.sent_at GROUP BY s.id,s.sent_at
)
SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'external_id',m.external_message_id,'text',m.content,'sent_at',m.sent_at) ORDER BY m.sent_at,m.id),'[]'::jsonb)
FROM source s JOIN boundary b ON b.source_id=s.id JOIN public.messages m ON m.conversation_id=s.conversation_id
AND m.role='cliente' AND m.sent_at>b.since AND m.sent_at<=s.sent_at;
$fn$;
REVOKE ALL ON FUNCTION public.lv_visit_request_messages(public.appointment_reschedule_requests) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.lv_visit_preference_parts(p_text text,p_at timestamptz,p_timezone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE v text:=lower(translate(coalesce(p_text,''),'áéíóúüñ','aeiouun'));
 parsed jsonb; clock_parts text[]; h integer; mins integer; marker text; hours integer[]; token text; ix integer; negated boolean;
BEGIN
 v:=regexp_replace(v,'([ap])\.?\s*m\.?','\1m','g');
 -- Una corrección al final sustituye lo anterior: «no puedo a esa hora, mejor a las 3».
 IF v ~ '\m(mejor|prefiero)\M' THEN v:=regexp_replace(v,'^.*\m(mejor|prefiero)\M\s*','','i'); END IF;
 negated:=v ~ '\mno\M|\m(cancelar|cancelo|cancelacion)\M';
 IF negated THEN RETURN jsonb_build_object('clear_time',true); END IF;
 IF v ~ '\m(o|entre|quizas)\M|tal vez|mas o menos|alrededor|proxima semana' THEN RETURN jsonb_build_object('ambiguous',true); END IF;
 -- Normalizar horas escritas con palabras, sin reemplazar números de fechas.
 FOR ix IN 1..12 LOOP
  token:=(ARRAY['una','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce'])[ix];
  v:=regexp_replace(v,'(\ma las?|\mlas?)\s+'||token||'\M','\1 '||ix::text,'g');
 END LOOP;
 parsed:=public.lv_parse_visit_preference(v,p_at,p_timezone);
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
  RETURN jsonb_build_object('requested_date',parsed->>'requested_date','keep_time',v ~ 'misma hora|mismo horario');
 END IF;
 h:=clock_parts[1]::integer; mins:=coalesce(clock_parts[2]::integer,0); marker:=coalesce(clock_parts[3],'');
 IF h>23 OR mins>59 THEN RETURN jsonb_build_object('ambiguous',true,'requested_date',parsed->>'requested_date'); END IF;
 IF marker IN ('am','pm','de la manana','de la tarde','de la noche') THEN
  IF h NOT BETWEEN 1 AND 12 THEN RETURN jsonb_build_object('ambiguous',true); END IF;
  hours:=ARRAY[h%12+CASE WHEN marker IN ('pm','de la tarde','de la noche') THEN 12 ELSE 0 END];
 ELSIF h BETWEEN 1 AND 12 AND clock_parts[2] IS NULL AND marker='' THEN
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

-- Lectura para el ejecutor, con el mismo alcance cerrado que la integración.
CREATE OR REPLACE FUNCTION public.lv_app_visit_preference(p_request_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT public.lv_requested_visit_slot(r) FROM public.appointment_reschedule_requests r
 WHERE r.id=p_request_id AND r.tenant_id='a1b2c3d4-0001-4000-8000-000000000001'::uuid
 AND r.project_id='b1b2c3d4-0001-4000-8000-000000000001'::uuid;
$fn$;
REVOKE ALL ON FUNCTION public.lv_app_visit_preference(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_app_visit_preference(uuid) TO service_role;
NOTIFY pgrst,'reload schema';

CREATE OR REPLACE FUNCTION public.lv_validate_appointment_request_context()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.appointments a
    JOIN public.leads l
      ON l.id = a.lead_id
    WHERE a.id = NEW.appointment_id
      AND a.tenant_id = NEW.tenant_id
      AND a.project_id = NEW.project_id
      AND a.lead_id = NEW.lead_id
      AND l.tenant_id = NEW.tenant_id
      AND l.project_id = NEW.project_id
  ) THEN
    RAISE EXCEPTION
      'La cita, el lead y el proyecto no corresponden al mismo contexto';
  END IF;

  IF NEW.assigned_advisor_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.project_salespeople ps
       WHERE ps.salesperson_id = NEW.assigned_advisor_id
         AND ps.tenant_id = NEW.tenant_id
         AND ps.project_id = NEW.project_id
     )
  THEN
    RAISE EXCEPTION 'El asesor no pertenece al proyecto';
  END IF;

  IF NEW.previous_request_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.appointment_reschedule_requests r
       WHERE r.id = NEW.previous_request_id
         AND r.tenant_id = NEW.tenant_id
         AND r.project_id = NEW.project_id
         AND r.appointment_id = NEW.appointment_id
         AND r.lead_id = NEW.lead_id
         AND r.status IN ('superseded','confirmed','rejected','expired')
     )
  THEN
    RAISE EXCEPTION
      'La propuesta anterior debe pertenecer a esta cita y tener un estado anterior válido';
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_apply_client_visit_intent(p_tenant uuid, p_project uuid, p_lead uuid, p_request uuid, p_message text, p_intent text, p_snapshot jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
 r public.appointment_reschedule_requests; a public.appointments;
 m public.messages; v_sent timestamptz; nxt uuid; v_sla integer;
 v_text text; v_existing uuid;
BEGIN
 IF p_intent NOT IN ('accept','counterproposal','reject','cancel','question','unclear','opt_out') THEN
  RAISE EXCEPTION 'Intención no válida';
 END IF;
 PERFORM public.lv_lock_project(p_tenant,p_project);
 SELECT * INTO r FROM public.appointment_reschedule_requests
 WHERE id=p_request AND tenant_id=p_tenant AND project_id=p_project AND lead_id=p_lead FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('action','stale','mensaje','La propuesta cambió. ¿Qué día y horario le gustaría coordinar?'); END IF;
 SELECT * INTO a FROM public.appointments
 WHERE id=r.appointment_id AND tenant_id=p_tenant AND project_id=p_project AND lead_id=p_lead FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Contexto de cita inconsistente'; END IF;
 SELECT msg.* INTO m FROM public.messages msg JOIN public.conversations cv ON cv.id=msg.conversation_id
 WHERE cv.tenant_id=p_tenant AND cv.project_id=p_project AND cv.lead_id=p_lead
 AND cv.channel='whatsapp' AND msg.role='cliente'
 AND (msg.id::text=p_message OR msg.external_message_id=p_message)
 ORDER BY msg.sent_at DESC LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'No existe un mensaje entrante de este cliente'; END IF;
 v_text := coalesce(m.content,'');
 IF p_intent='opt_out' THEN
  PERFORM public.set_tracking_preference(p_lead,false,'solicitó no recibir más mensajes');
  RETURN jsonb_build_object('action','reply','mensaje','Hemos registrado su solicitud de no recibir más mensajes.');
 END IF;
 -- Los reintentos de cambios no crean otra solicitud.
 SELECT id INTO v_existing FROM public.appointment_reschedule_requests
 WHERE tenant_id=p_tenant AND project_id=p_project AND lead_id=p_lead
 AND source_channel='whatsapp' AND source_message_id=p_message AND previous_request_id=r.id LIMIT 1;
 IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('action','duplicate'); END IF;
 IF a.status IN ('cancelado','atendido') OR a.no_show IS TRUE THEN
  RETURN jsonb_build_object('action','stale','mensaje','Esa cita ya no está pendiente. ¿Desea solicitar una nueva visita?');
 END IF;
 IF r.updated_at IS DISTINCT FROM (p_snapshot->>'updated_at')::timestamptz
 OR r.proposed_start_time IS DISTINCT FROM (p_snapshot->>'proposed_start_time')::timestamptz
 OR r.proposed_end_time IS DISTINCT FROM (p_snapshot->>'proposed_end_time')::timestamptz
 OR r.assigned_advisor_id IS DISTINCT FROM (p_snapshot->>'assigned_advisor_id')::uuid
 OR r.status IS DISTINCT FROM p_snapshot->>'status' THEN
  RETURN jsonb_build_object('action','stale','mensaje','La propuesta cambió mientras recibíamos su respuesta. ¿Qué horario desea confirmar?');
 END IF;
 IF p_intent='question' THEN RETURN jsonb_build_object('action','conversation'); END IF;
 IF p_intent='unclear' THEN
  RETURN jsonb_build_object('action','reply','mensaje',
    CASE WHEN r.status='awaiting_client' THEN '¿Desea confirmar el horario propuesto o necesita cambiarlo?'
    ELSE '¿Desea cambiar el horario de su visita o consultar algún detalle?' END);
 END IF;
 -- No aceptar un mensaje anterior al envío ni cuando llegaron otros mensajes después.
 IF p_intent='accept' THEN
  SELECT max(q.accepted_at) INTO v_sent FROM public.lv_outbox q
  WHERE q.tenant_id=p_tenant AND q.project_id=p_project AND q.lead_id=p_lead
   AND q.appointment_id=a.id AND q.payload->>'request_id'=r.id::text
   AND q.kind='visit_propose' AND q.status IN ('accepted','delivered');
  IF r.status <> 'awaiting_client' OR r.advisor_accepted_at IS NULL
   OR r.client_accepted_at IS NOT NULL OR r.expires_at IS NULL OR r.expires_at<=now()
   OR r.proposed_start_time<=now() OR v_sent IS NULL OR m.sent_at<=v_sent
   OR (p_snapshot->>'source_sent_at') IS NULL
   OR (p_snapshot->>'source_sent_at')::timestamptz<=v_sent
   OR (p_snapshot->>'source_sent_at')::timestamptz>now()+interval '30 seconds'
   OR a.responsible_id IS DISTINCT FROM r.assigned_advisor_id
   OR EXISTS (SELECT 1 FROM public.messages later JOIN public.conversations cv ON cv.id=later.conversation_id
    WHERE cv.lead_id=p_lead AND cv.tenant_id=p_tenant AND cv.project_id=p_project
     AND later.role='cliente' AND later.sent_at>m.sent_at) THEN
    RETURN jsonb_build_object('action','stale','mensaje','Necesitamos verificar el horario vigente antes de confirmar. ¿Qué día y hora desea visitar La Vilet?');
  END IF;
  r := public.lv_client_accept_request(r.id,p_message);
  IF r.status <> 'confirmed' THEN RAISE EXCEPTION 'La cita no quedó confirmada'; END IF;
  RETURN jsonb_build_object('action','confirmed','request_id',r.id,'appointment_id',a.id);
 END IF;
 IF p_intent='cancel' THEN
  UPDATE public.appointments SET status='cancelado',updated_at=now() WHERE id=a.id;
  UPDATE public.appointment_reschedule_requests SET status='cancelled',resolved_at=now(),updated_at=now(),
   resolution_notes='Cancelación solicitada por cliente. Mensaje: '||p_message
   WHERE appointment_id=a.id AND status IN ('awaiting_advisor','awaiting_client');
  DELETE FROM public.appointment_time_holds WHERE appointment_id=a.id;
  PERFORM public.lv_cancel_pending_visit_outbox(a.id,'cancelación del cliente');
  INSERT INTO public.lv_appointment_assignment_events(tenant_id,project_id,appointment_id,request_id,action,reason)
   VALUES(p_tenant,p_project,a.id,r.id,'client_cancelled',p_message);
  RETURN jsonb_build_object('action','reply','mensaje','No se preocupe, hemos cancelado la cita. ¿Le gustaría visitarnos más tarde o prefiere otro día?');
 END IF;
 IF p_intent='reject' AND r.status='awaiting_client' THEN
  UPDATE public.appointment_reschedule_requests SET status='rejected',resolved_at=now(),updated_at=now(),
   resolution_notes='Rechazo del cliente. Mensaje: '||p_message WHERE id=r.id;
  DELETE FROM public.appointment_time_holds WHERE request_id=r.id;
  PERFORM public.lv_cancel_pending_visit_outbox(a.id,'propuesta rechazada por cliente');
  INSERT INTO public.lv_appointment_assignment_events(tenant_id,project_id,appointment_id,request_id,action,reason)
   VALUES(p_tenant,p_project,a.id,r.id,'client_rejected',p_message);
  RETURN jsonb_build_object('action','reply','mensaje',CASE WHEN a.status IN ('aceptado','reprogramado')
    THEN 'Entendido, dejamos sin efecto esa propuesta. Su cita anterior se mantiene. ¿Qué otro horario le vendría mejor?'
    ELSE 'No se preocupe. ¿Qué día y hora le vendrían mejor para su visita?' END);
 END IF;
 -- Un horario alternativo, incluso vago, se conserva como texto para revisión del asesor.
 -- No se inventa una fecha ni se reserva automáticamente un intervalo.
 IF p_intent IN ('counterproposal','reject') THEN
  IF r.status NOT IN ('awaiting_advisor','awaiting_client','confirmed','rejected','expired') THEN
   RETURN jsonb_build_object('action','stale','mensaje','La solicitud cambió. ¿Qué horario desea coordinar?');
  END IF;
  IF r.status IN ('awaiting_advisor','awaiting_client') THEN
   UPDATE public.appointment_reschedule_requests SET status='superseded',resolved_at=now(),updated_at=now() WHERE id=r.id;
  END IF;
  DELETE FROM public.appointment_time_holds WHERE request_id=r.id;
  PERFORM public.lv_cancel_pending_visit_outbox(a.id,'cliente solicitó revisar el horario');
  SELECT coalesce(review_sla_minutes,90) INTO v_sla FROM public.project_automation_config WHERE project_id=p_project;
  INSERT INTO public.appointment_reschedule_requests(
   tenant_id,project_id,appointment_id,lead_id,request_type,proposed_by,previous_request_id,status,
   previous_start_time,previous_end_time,preferred_time_text,source_message_text,source_channel,source_message_id,
   assigned_advisor_id,assigned_at,escalation_due_at
  ) VALUES(p_tenant,p_project,a.id,p_lead,
   CASE WHEN a.status IN ('aceptado','reprogramado') THEN 'reschedule' ELSE 'new_appointment' END,
   'client',r.id,'awaiting_advisor',a.start_time,a.end_time,v_text,v_text,'whatsapp',p_message,
   a.responsible_id,now(),now()+make_interval(mins=>coalesce(v_sla,90))) RETURNING id INTO nxt;
  INSERT INTO public.lv_appointment_assignment_events(tenant_id,project_id,appointment_id,request_id,from_advisor_id,to_advisor_id,action,reason)
   VALUES(p_tenant,p_project,a.id,nxt,a.responsible_id,a.responsible_id,'counterproposed','client: '||p_message);
  IF a.responsible_id IS NULL THEN PERFORM public.lv_assign_appointment_fairly(nxt,ARRAY[]::uuid[]); END IF;
  RETURN jsonb_build_object('action','reply','request_id',nxt,'mensaje',
   'Hemos registrado su solicitud de cambio. El asesor revisará la disponibilidad y le enviaremos una nueva propuesta.');
 END IF;
 RETURN jsonb_build_object('action','conversation');
END $function$;

CREATE OR REPLACE FUNCTION public.lv_app_conversation_context(p_lead uuid, p_message text)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT to_jsonb(context) FROM (WITH actual AS (
 SELECT m.* FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
 WHERE c.lead_id=p_lead AND c.tenant_id='a1b2c3d4-0001-4000-8000-000000000001'::uuid AND c.project_id='b1b2c3d4-0001-4000-8000-000000000001'::uuid
 AND m.role='cliente' AND (m.external_message_id=p_message OR m.id::text=p_message)
 ORDER BY m.sent_at DESC LIMIT 1
), solicitudes AS (
 SELECT DISTINCT ON (r.appointment_id) r.*,r.id AS request_id,a.status AS appointment_status,
 pr.full_name AS advisor_name,
 (SELECT q.payload->>'detail' FROM public.lv_outbox q WHERE q.tenant_id=r.tenant_id
  AND q.project_id=r.project_id AND q.lead_id=r.lead_id AND q.appointment_id=r.appointment_id
  AND q.payload->>'request_id'=r.id::text AND q.kind='visit_propose'
  AND q.status IN ('accepted','delivered') ORDER BY q.accepted_at DESC NULLS LAST LIMIT 1) AS mensaje_propuesta,
 (SELECT max(q.accepted_at) FROM public.lv_outbox q WHERE q.tenant_id=r.tenant_id
  AND q.project_id=r.project_id AND q.lead_id=r.lead_id AND q.appointment_id=r.appointment_id
  AND q.payload->>'request_id'=r.id::text AND q.kind='visit_propose'
  AND q.status IN ('accepted','delivered')) AS propuesta_enviada_at
 FROM public.appointment_reschedule_requests r JOIN public.appointments a
 ON a.id=r.appointment_id AND a.lead_id=r.lead_id AND a.tenant_id=r.tenant_id AND a.project_id=r.project_id
 LEFT JOIN public.profiles pr ON pr.id=r.assigned_advisor_id
 WHERE r.lead_id=p_lead AND r.tenant_id='a1b2c3d4-0001-4000-8000-000000000001'::uuid AND r.project_id='b1b2c3d4-0001-4000-8000-000000000001'::uuid
 AND a.status NOT IN ('cancelado','atendido') AND a.no_show IS NOT TRUE
 AND (a.start_time IS NULL OR a.start_time>now())
 ORDER BY r.appointment_id,r.created_at DESC,r.id DESC
)
SELECT now() AS hora_actual,
 coalesce((SELECT jsonb_agg(to_jsonb(s)||jsonb_build_object('requested_slot',public.lv_requested_visit_slot((SELECT r FROM public.appointment_reschedule_requests r WHERE r.id=s.id)))) FROM solicitudes s),'[]'::jsonb) AS propuestas,
 (SELECT sent_at FROM actual) AS mensaje_actual_at,
 coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.sent_at,h.id) FROM (
 SELECT m.id,m.role,m.content,m.sent_at FROM public.messages m JOIN public.conversations c ON c.id=m.conversation_id
 WHERE c.lead_id=p_lead AND c.tenant_id='a1b2c3d4-0001-4000-8000-000000000001'::uuid AND c.project_id='b1b2c3d4-0001-4000-8000-000000000001'::uuid
 AND m.id IS DISTINCT FROM (SELECT id FROM actual)
 AND m.sent_at <= (SELECT sent_at FROM actual) AND m.model_used IS DISTINCT FROM 'fallback_static'
 ORDER BY m.sent_at DESC,m.id DESC LIMIT 12
 ) h),'[]'::jsonb) AS historial) context;
$function$;
