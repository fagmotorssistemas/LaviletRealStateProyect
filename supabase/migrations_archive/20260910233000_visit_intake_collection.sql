-- Collect date/time before creating an appointment or notifying an advisor.
ALTER TABLE public.appointment_reschedule_requests ADD COLUMN IF NOT EXISTS intake_source_ids uuid[] NOT NULL DEFAULT '{}';
CREATE TABLE IF NOT EXISTS public.lv_visit_intakes (
 conversation_id uuid PRIMARY KEY REFERENCES public.conversations(id) ON DELETE CASCADE,
 lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 source_ids uuid[] NOT NULL DEFAULT '{}', status text NOT NULL DEFAULT 'collecting' CHECK(status IN ('collecting','submitted')),
 previous_request_id uuid REFERENCES public.appointment_reschedule_requests(id) ON DELETE SET NULL,
 request_id uuid REFERENCES public.appointment_reschedule_requests(id) ON DELETE SET NULL,
 needs_help boolean NOT NULL DEFAULT false, preferred_period text,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.lv_visit_intakes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lv_visit_intakes FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.lv_visit_intakes TO service_role;
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
AND m.role='cliente' AND m.sent_at<=s.sent_at AND (m.sent_at>b.since OR m.id=ANY(p_request.intake_source_ids));
$fn$;
REVOKE ALL ON FUNCTION public.lv_visit_request_messages(public.appointment_reschedule_requests) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.lv_visit_preference_parts(p_text text,p_at timestamptz,p_timezone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE v text:=lower(translate(coalesce(p_text,''),'áéíóúüñ','aeiouun'));
 parsed jsonb; clock_parts text[]; h integer; mins integer; marker text; hours integer[]; token text; ix integer; negated boolean; keep_clock boolean;
BEGIN
 v:=regexp_replace(v,'\m(malana|manana)\M','manana','g');
 v:=regexp_replace(v,'\mlass\M','las','g');
 v:=regexp_replace(v,'no (?:estoy seguro|se)(?: de)?(?: la hora| a que hora)?','', 'g');
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
    new_day:=(parts->>'requested_date')::date;
    IF new_day IS NOT NULL THEN
     IF day IS DISTINCT FROM new_day AND coalesce((parts->>'keep_time')::boolean,false)=false THEN hours:=NULL; END IF;
     day:=new_day; day_source:=message->>'id'; unclear:=false;
    END IF;
    IF parts->>'clear_date'='true' THEN day:=NULL; day_source:=NULL; END IF;
    IF parts->>'clear_time'='true' OR parts->>'ambiguous'='true' THEN hours:=NULL; unclear:=coalesce((parts->>'ambiguous')::boolean,false); END IF;
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

CREATE OR REPLACE FUNCTION public.lv_collect_visit_intake(p_lead uuid,p_message text,p_needs_help boolean DEFAULT false,p_previous_request uuid DEFAULT NULL,p_snapshot jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE c public.conversations; m public.messages; draft public.lv_visit_intakes; r public.appointment_reschedule_requests;
 slot jsonb; day date; zone text; config jsonb; appt uuid; period text; content text; parent public.appointment_reschedule_requests; a public.appointments; v_sla integer;
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
 content:=lower(translate(m.content,'áéíóúñ','aeioun'));
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
 IF day IS NOT NULL AND NOT coalesce(config ? extract(isodow FROM day)::text,false) THEN RETURN jsonb_build_object('action','closed_day','slot',slot); END IF;
 IF slot->>'confidence'='exact' AND NOT public.lv_interval_within_business_hours(c.project_id,(slot->>'start_time')::timestamptz,(slot->>'end_time')::timestamptz) THEN
  RETURN jsonb_build_object('action','outside_hours','slot',slot,'hours',config->extract(isodow FROM day)::text);
 END IF;
 IF slot->>'confidence'='exact' AND (slot->>'start_time')::timestamptz<=now() THEN RETURN jsonb_build_object('action','past','slot',slot); END IF;
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
  RETURN jsonb_build_object('action','submitted','request_id',r.id,'slot',public.lv_requested_visit_slot(r),'needs_help',p_needs_help OR draft.needs_help,'preferred_period',period);
 END IF;
 RETURN jsonb_build_object('action','collecting','slot',slot,'preferred_period',period);
END $fn$;
REVOKE ALL ON FUNCTION public.lv_collect_visit_intake(uuid,text,boolean,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_collect_visit_intake(uuid,text,boolean,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.appointment_reminders_paused(p_appointment_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.appointment_reschedule_requests r WHERE r.appointment_id=p_appointment_id AND r.status IN ('awaiting_advisor','awaiting_client'))
 OR EXISTS(SELECT 1 FROM public.lv_visit_intakes i JOIN public.appointment_reschedule_requests r ON r.id=i.previous_request_id
   WHERE i.status='collecting' AND r.appointment_id=p_appointment_id AND r.lead_id=i.lead_id AND r.project_id=i.project_id AND r.tenant_id=i.tenant_id);
$fn$;
REVOKE ALL ON FUNCTION public.appointment_reminders_paused(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.appointment_reminders_paused(uuid) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.lv_close_visit_intake() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NEW.status IN ('cancelado','atendido') THEN
  DELETE FROM public.lv_visit_intakes i USING public.appointment_reschedule_requests r
  WHERE r.id=coalesce(i.previous_request_id,i.request_id) AND r.appointment_id=NEW.id AND i.lead_id=NEW.lead_id;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.lv_close_visit_intake() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lv_close_visit_intake AFTER UPDATE OF status ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.lv_close_visit_intake();

CREATE OR REPLACE FUNCTION public.lv_visit_is_collecting(p_appointment uuid) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE a public.appointments;
BEGIN
 SELECT * INTO a FROM public.appointments WHERE id=p_appointment;
 IF a.id IS NULL OR auth.uid() IS NULL OR NOT public.agenda_can_manage_appointment(a) THEN RAISE EXCEPTION 'No autorizado'; END IF;
 RETURN EXISTS(SELECT 1 FROM public.lv_visit_intakes i JOIN public.appointment_reschedule_requests r ON r.id=i.previous_request_id
 WHERE i.status='collecting' AND r.appointment_id=a.id AND i.lead_id=a.lead_id AND i.project_id=a.project_id AND i.tenant_id=a.tenant_id);
END $fn$;
REVOKE ALL ON FUNCTION public.lv_visit_is_collecting(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.lv_visit_is_collecting(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.lv_guard_visit_collection() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
BEGIN
 IF NEW.status IN ('aceptado','reprogramado') AND (OLD.status IS DISTINCT FROM NEW.status OR OLD.start_time IS DISTINCT FROM NEW.start_time OR OLD.end_time IS DISTINCT FROM NEW.end_time)
 AND EXISTS(SELECT 1 FROM public.lv_visit_intakes i JOIN public.appointment_reschedule_requests r ON r.id=i.previous_request_id WHERE i.status='collecting' AND r.appointment_id=NEW.id) THEN
  RAISE EXCEPTION 'El cliente todavía está definiendo el nuevo horario. Espera su respuesta antes de confirmar';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.lv_guard_visit_collection() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER lv_guard_visit_collection BEFORE UPDATE OF status,start_time,end_time ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.lv_guard_visit_collection();

CREATE OR REPLACE FUNCTION public.lv_visit_scheduling_options(p_request_id uuid,p_day date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r public.appointment_reschedule_requests; requested jsonb; desired timestamptz; finish timestamptz;
  zone text; period text; need_help boolean; first_day date; today date; slots jsonb; reason text; eligible boolean; available boolean := false;
BEGIN
  SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
  PERFORM public.lv_assert_can_act_on_request(r);
  IF r.status NOT IN ('awaiting_advisor','awaiting_client') THEN RAISE EXCEPTION 'La solicitud cambió. Actualiza la cita.'; END IF;
  requested := public.lv_requested_visit_slot(r);
  SELECT i.preferred_period,i.needs_help INTO period,need_help FROM public.lv_visit_intakes i WHERE i.request_id=r.id;
  IF period IS NULL THEN period:=CASE WHEN lower(r.source_message_text) ~ 'tarde' THEN 'afternoon' WHEN lower(r.source_message_text) ~ 'por la mañana|en la mañana' THEN 'morning' END; END IF;
  requested:=requested||jsonb_build_object('preferred_period',period,'needs_help',coalesce(need_help,false));
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
      WHERE (period IS NULL OR (period='afternoon' AND m>=24) OR (period='morning' AND m<24))
        AND (d::date+make_interval(mins=>m*30)) AT TIME ZONE zone > now()+interval '15 minutes'
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


NOTIFY pgrst,'reload schema';
