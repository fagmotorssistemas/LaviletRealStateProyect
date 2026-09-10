-- Completar contexto, reglas de conversación y ubicación inicial ya usada por la web.
CREATE OR REPLACE FUNCTION public.lv_visit_preference_parts(p_text text,p_at timestamptz,p_timezone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE v text:=lower(translate(coalesce(p_text,''),'áéíóúüñ','aeiouun'));
 parsed jsonb; clock_parts text[]; h integer; mins integer; marker text; hours integer[]; token text; ix integer; negated boolean;
BEGIN
 v:=regexp_replace(v,'^\s*si\M[, ]*','','i');
 v:=regexp_replace(v,'([ap])\.?\s*m\.?','\1m','g');
 -- Una corrección al final sustituye lo anterior: «no puedo a esa hora, mejor a las 3».
 IF v ~ '\m(mejor|prefiero)\M' THEN v:=regexp_replace(v,'^.*\m(mejor|prefiero)\M\s*','','i'); END IF;
 negated:=v ~ '\mno\M|\m(cancelar|cancelo|cancelacion)\M';
 IF negated THEN RETURN jsonb_build_object('clear_time',true); END IF;
 IF v ~ '\m(o|entre|quizas)\M|tal vez|mas o menos|alrededor|proxima semana' THEN RETURN jsonb_build_object('ambiguous',true); END IF;
 IF (SELECT count(*) FROM regexp_matches(v,'\m(hoy|manana|lunes|martes|miercoles|jueves|viernes|sabado|domingo)\M','g'))>1 AND v !~ 'pasado manana|de la manana' THEN RETURN jsonb_build_object('ambiguous',true); END IF;
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

CREATE OR REPLACE FUNCTION public.lv_app_visit_context(p_job uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
SELECT jsonb_build_object(
  'job', to_jsonb(q),
  'location', (SELECT visit_location_url FROM public.project_automation_config WHERE project_id=q.project_id AND tenant_id=q.tenant_id),
  'advisor_name', (SELECT full_name FROM public.profiles WHERE id=a.responsible_id),
  'lead', to_jsonb(l),
  'config', to_jsonb(c),
  'route', to_jsonb(rt),
  'appointment', to_jsonb(a),
  'request', to_jsonb(ar),

  'now', now(),

  'event_current',
    public.lv_outbox_event_is_current(q.id),

  'reminders_paused',
    public.appointment_reminders_paused(a.id),

  'revision',
    md5(concat_ws(
      '|',
      a.id,
      a.lead_id,
      a.start_time,
      a.location_type,
      a.office_id,
      a.project_id,
      p.address,
      o.address,
      vp.location_override
    )),

  'last_client_message_at',
    (
      SELECT max(m.sent_at)
      FROM public.messages m
      JOIN public.conversations cv
        ON cv.id = m.conversation_id
      WHERE cv.lead_id = l.id
        AND cv.tenant_id = l.tenant_id
        AND cv.project_id = l.project_id
        AND cv.channel = 'whatsapp'
        AND m.role = 'cliente'
        AND m.sent_at <= now()
    ),

  'recent_jobs',
    COALESCE(
      (
        SELECT jsonb_agg(to_jsonb(x))
        FROM public.lv_outbox x
        WHERE x.lead_id = l.id
          AND x.id <> q.id
          AND (
            x.status IN ('claimed', 'uncertain')
            OR x.accepted_at > now() - interval '24 hours'
          )
      ),
      '[]'::jsonb
    )

) AS data

FROM public.lv_outbox q

JOIN public.leads l
  ON l.id = q.lead_id

JOIN public.lv_auto_config c
  ON c.project_id = l.project_id
  AND c.tenant_id = l.tenant_id

LEFT JOIN public.lv_routes rt
  ON rt.project_id = q.project_id
  AND rt.kind = q.kind

LEFT JOIN public.appointments a
  ON a.id = q.appointment_id

LEFT JOIN public.appointment_reschedule_requests ar
  ON ar.id::text = q.payload->>'request_id'
  AND ar.appointment_id = q.appointment_id
  AND ar.lead_id = q.lead_id
  AND ar.tenant_id = q.tenant_id
  AND ar.project_id = q.project_id

LEFT JOIN public.projects p
  ON p.id = a.project_id
  AND p.tenant_id = a.tenant_id

LEFT JOIN public.offices o
  ON o.id = a.office_id
  AND o.tenant_id = a.tenant_id

LEFT JOIN public.lv_visit_policy vp
  ON vp.appointment_id = a.id

WHERE q.id=p_job AND q.project_id='b1b2c3d4-0001-4000-8000-000000000001' AND q.tenant_id='a1b2c3d4-0001-4000-8000-000000000001';
$function$
;
UPDATE public.project_automation_config
SET visit_latitude=-2.89234,visit_longitude=-79.030352,updated_at=now()
WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001'
AND tenant_id='a1b2c3d4-0001-4000-8000-000000000001'
AND visit_latitude IS NULL AND visit_longitude IS NULL
AND visit_location_url='https://maps.app.goo.gl/cjkNv7c4siehTqAN9';

UPDATE public.agent_prompts SET content=
replace(replace(replace(content,
'El contexto conversacion.ya_saludamos manda: si es true, no vuelvas a saludar ni presentar el proyecto, incluso si el cliente dice «Hola» o «Buenas tardes». Retoma su necesidad y la pregunta pendiente con otra formulación breve.',
'conversacion.ya_saludamos se refiere a la sesión reciente: evita otra bienvenida en mensajes consecutivos. Al retomar después de una pausa o en un nuevo día, corresponde devolver su saludo con calidez y continuar la coordinación.'),
'Usa su nombre ocasionalmente solo si es fiable; no en cada mensaje.',
'Usa solo su PRIMER nombre, ocasionalmente y si es fiable; nunca el nombre completo para dirigirte al cliente.'),
'Si falta horario, pregunta «¿Qué día y horario le vendrían bien para una visita?».',
'Conserva el día y la hora ya indicados en esta coordinación; pregunta solo el dato faltante. Si agradece después de registrar la preferencia, basta «Con mucho gusto», sin repetir fecha, resumen ni otra pregunta.')
,version=version+1,updated_at=now()
WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001' AND tenant_id='a1b2c3d4-0001-4000-8000-000000000001'
AND name='respuesta_comercial' AND is_active AND content LIKE '%incluso si el cliente dice «Hola»%';

UPDATE public.agent_prompts SET content=replace(content,
'el sistema preguntará por su preferencia antes de crear la solicitud.',
'el sistema abrirá la coordinación pendiente y preguntará únicamente el día o la hora que falte. Un agradecimiento sin otra petición no genera requested_visit.'),
version=version+1,updated_at=now()
WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001' AND tenant_id='a1b2c3d4-0001-4000-8000-000000000001'
AND name='extractor_eventos' AND is_active AND content LIKE '%antes de crear la solicitud.%';
NOTIFY pgrst,'reload schema';

