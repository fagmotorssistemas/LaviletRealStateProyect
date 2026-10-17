-- AI supplies linguistic meaning as typed metadata. SQL checks provenance,
-- calendar, availability and records only; it never parses customer/bot prose.
-- No existing draft is processed and no message is sent by this migration.
BEGIN;
CREATE OR REPLACE FUNCTION public.lv_visit_preference_contract()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT 'visit-preference-v2'::text $$;
REVOKE ALL ON FUNCTION public.lv_visit_preference_contract() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_visit_preference_contract() TO service_role;

-- Retain signatures for older callers, but retire their linguistic authority.
-- A legacy invocation needs a new typed interpretation; it cannot book a slot.
CREATE OR REPLACE FUNCTION public.lv_parse_visit_preference(p_text text,p_reference timestamptz,p_timezone text DEFAULT 'America/Guayaquil')
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $fn$
 SELECT jsonb_build_object('confidence','unknown','requires_typed_recovery',true,'contract_version','visit-preference-v2');
$fn$;
REVOKE ALL ON FUNCTION public.lv_parse_visit_preference(text,timestamptz,text) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION public.lv_visit_preference_parts(p_text text,p_at timestamptz,p_timezone text)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $fn$
 SELECT jsonb_build_object('confidence','unknown','requires_typed_recovery',true,'contract_version','visit-preference-v2');
$fn$;
REVOKE ALL ON FUNCTION public.lv_visit_preference_parts(text,timestamptz,text) FROM PUBLIC,anon,authenticated;

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
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'external_id',m.external_message_id,
  'text',m.content,'raw_text',m.content,'interpretation',p_request.interpreted_source_texts->m.id::text,'sent_at',m.sent_at)
  ORDER BY m.sent_at,m.id),'[]'::jsonb)
 FROM source s JOIN boundary b ON b.source_id=s.id JOIN public.messages m ON m.conversation_id=s.conversation_id
  AND m.role='cliente' AND m.sent_at<=s.sent_at AND (m.sent_at>b.since OR m.id=ANY(p_request.intake_source_ids));
$fn$;
REVOKE ALL ON FUNCTION public.lv_visit_request_messages(public.appointment_reschedule_requests) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.lv_visit_json_integer(p_value jsonb,p_min integer,p_max integer)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $fn$
 SELECT CASE WHEN jsonb_typeof(p_value)='number' THEN (p_value::text)::numeric=trunc((p_value::text)::numeric)
   AND (p_value::text)::numeric BETWEEN p_min AND p_max ELSE false END;
$fn$;
REVOKE ALL ON FUNCTION public.lv_visit_json_integer(jsonb,integer,integer) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.lv_visit_typed_parts(p_preference jsonb,p_at timestamptz,p_timezone text)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path='' AS $fn$
DECLARE d jsonb:=p_preference->'date'; t jsonb:=p_preference->'time'; field text;
 base date; chosen date; y integer; h integer; hours integer[]; result jsonb; decision text:=p_preference->>'decision';
BEGIN
 IF p_preference->>'version' IS DISTINCT FROM 'visit-preference-v2' OR decision IS NULL OR decision NOT IN ('specified','ambiguous','declined','none')
  OR jsonb_typeof(d) IS DISTINCT FROM 'object' OR jsonb_typeof(t) IS DISTINCT FROM 'object'
  OR jsonb_typeof(p_preference->'uncertain_fields') IS DISTINCT FROM 'array'
  OR p_preference->>'confidence' IS NULL OR p_preference->>'confidence' NOT IN ('high','medium') OR p_at IS NULL THEN RETURN jsonb_build_object('valid',false); END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_preference->'uncertain_fields') x WHERE x NOT IN ('date','time','location')) THEN RETURN jsonb_build_object('valid',false); END IF;
 IF d->>'kind' IS NULL OR d->>'kind' NOT IN ('absolute','relative_day','weekday','month_day','unchanged','none')
  OR t->>'kind' IS NULL OR t->>'kind' NOT IN ('clock','period','unchanged','none') THEN RETURN jsonb_build_object('valid',false); END IF;
 base:=(p_at AT TIME ZONE p_timezone)::date;
 IF d->>'kind' IN ('absolute','month_day') THEN
  IF NOT public.lv_visit_json_integer(d->'month',1,12) OR NOT public.lv_visit_json_integer(d->'day',1,31)
   OR d->>'kind'='absolute' AND NOT public.lv_visit_json_integer(d->'year',1,9999) THEN RETURN jsonb_build_object('valid',false); END IF;
  IF d->>'kind'='month_day' AND d->>'year' IS NOT NULL THEN RETURN jsonb_build_object('valid',false); END IF;
  y:=CASE WHEN d->>'kind'='absolute' THEN (d->>'year')::integer ELSE extract(year FROM base)::integer END;
  chosen:=make_date(y,(d->>'month')::integer,(d->>'day')::integer);
  IF d->>'weekday' IS NOT NULL AND (NOT public.lv_visit_json_integer(d->'weekday',1,7)
   OR extract(isodow FROM chosen)::integer<>(d->>'weekday')::integer) THEN RETURN jsonb_build_object('valid',false); END IF;
  FOREACH field IN ARRAY ARRAY['offset_days','week_offset','occurrence'] LOOP IF d->>field IS NOT NULL THEN RETURN jsonb_build_object('valid',false); END IF; END LOOP;
 ELSIF d->>'kind'='relative_day' THEN
  IF NOT public.lv_visit_json_integer(d->'offset_days',-366,3660) THEN RETURN jsonb_build_object('valid',false); END IF;
  chosen:=base+(d->>'offset_days')::integer;
  FOREACH field IN ARRAY ARRAY['year','month','day','weekday','week_offset','occurrence'] LOOP IF d->>field IS NOT NULL THEN RETURN jsonb_build_object('valid',false); END IF; END LOOP;
 ELSIF d->>'kind'='weekday' THEN
  IF NOT public.lv_visit_json_integer(d->'weekday',1,7) THEN RETURN jsonb_build_object('valid',false); END IF;
  IF d->>'week_offset' IS NOT NULL THEN
   IF NOT public.lv_visit_json_integer(d->'week_offset',0,104) OR d->>'occurrence' IS NOT NULL THEN RETURN jsonb_build_object('valid',false); END IF;
   chosen:=base-extract(isodow FROM base)::integer+(d->>'weekday')::integer+(d->>'week_offset')::integer*7;
  ELSE
   IF d->>'occurrence' IS NULL OR d->>'occurrence' NOT IN ('on_or_after','strictly_next') THEN RETURN jsonb_build_object('valid',false); END IF;
   chosen:=base+(((d->>'weekday')::integer-extract(isodow FROM base)::integer+7)%7);
   IF chosen=base AND d->>'occurrence'='strictly_next' THEN chosen:=chosen+7; END IF;
  END IF;
  FOREACH field IN ARRAY ARRAY['year','month','day','offset_days'] LOOP IF d->>field IS NOT NULL THEN RETURN jsonb_build_object('valid',false); END IF; END LOOP;
 ELSE
  FOREACH field IN ARRAY ARRAY['year','month','day','offset_days','weekday','week_offset','occurrence'] LOOP IF d->>field IS NOT NULL THEN RETURN jsonb_build_object('valid',false); END IF; END LOOP;
 END IF;
 result:=jsonb_build_object('valid',true,'decision',decision,'requested_date',chosen,'keep_time',t->>'kind'='unchanged');
 IF t->>'kind'='clock' THEN
  IF NOT public.lv_visit_json_integer(t->'minute',0,59) OR t->>'period' IS NOT NULL THEN RETURN jsonb_build_object('valid',false); END IF;
  IF t->>'meridiem'='24h' THEN
   IF NOT public.lv_visit_json_integer(t->'hour',0,23) THEN RETURN jsonb_build_object('valid',false); END IF;
   hours:=ARRAY[(t->>'hour')::integer];
  ELSE
   IF NOT public.lv_visit_json_integer(t->'hour',1,12) OR t->>'meridiem' IS NOT NULL AND t->>'meridiem' NOT IN ('am','pm') THEN RETURN jsonb_build_object('valid',false); END IF;
   h:=(t->>'hour')::integer%12;
   hours:=CASE t->>'meridiem' WHEN 'am' THEN ARRAY[h] WHEN 'pm' THEN ARRAY[h+12] ELSE ARRAY[h,h+12] END;
  END IF;
  result:=result||jsonb_build_object('hours',to_jsonb(hours),'minute',(t->>'minute')::integer);
 ELSIF t->>'kind'='period' THEN
  IF t->>'period' IS NULL OR t->>'period' NOT IN ('morning','afternoon','evening') THEN RETURN jsonb_build_object('valid',false); END IF;
  FOREACH field IN ARRAY ARRAY['hour','minute','meridiem'] LOOP IF t->>field IS NOT NULL THEN RETURN jsonb_build_object('valid',false); END IF; END LOOP;
  result:=result||jsonb_build_object('period',t->>'period');
 ELSE
  FOREACH field IN ARRAY ARRAY['hour','minute','meridiem','period'] LOOP IF t->>field IS NOT NULL THEN RETURN jsonb_build_object('valid',false); END IF; END LOOP;
 END IF;
 IF decision IN ('ambiguous','declined') THEN result:=result||jsonb_build_object('ambiguous',true,
  'clear_date',jsonb_array_length(p_preference->'uncertain_fields')=0 OR p_preference->'uncertain_fields' ? 'date',
  'clear_time',jsonb_array_length(p_preference->'uncertain_fields')=0 OR p_preference->'uncertain_fields' ? 'time');
  IF result->>'clear_time'='true' THEN result:=result-'hours'-'minute'; END IF;
  IF result->>'clear_date'='true' THEN result:=result-'requested_date'; END IF;
 END IF;
 RETURN result;
EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format OR invalid_parameter_value OR invalid_text_representation OR numeric_value_out_of_range THEN
 RETURN jsonb_build_object('valid',false);
END $fn$;
REVOKE ALL ON FUNCTION public.lv_visit_typed_parts(jsonb,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_visit_typed_parts(jsonb,timestamptz,text) TO service_role;

CREATE OR REPLACE FUNCTION public.lv_requested_visit_slot(p_request public.appointment_reschedule_requests)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r public.appointment_reschedule_requests; source public.messages; pref jsonb; parts jsonb; metadata_entry record;
 zone text; day date; new_day date; hours integer[]; mins integer:=0; starts timestamptz; ends timestamptz; candidates timestamptz[];
 verified boolean:=false; unclear boolean:=false; legacy boolean:=false; source_at timestamptz; day_source text; current_messages jsonb;
BEGIN
 SELECT coalesce(timezone,'America/Guayaquil') INTO zone FROM public.project_automation_config WHERE project_id=p_request.project_id AND tenant_id=p_request.tenant_id;
 zone:=coalesce(zone,'America/Guayaquil');
 current_messages:=public.lv_visit_request_messages(p_request);
 IF p_request.status='confirmed' THEN
  SELECT a.start_time,a.end_time INTO starts,ends FROM public.appointments a
   WHERE a.id=p_request.appointment_id AND a.lead_id=p_request.lead_id
    AND a.tenant_id=p_request.tenant_id AND a.project_id=p_request.project_id
    AND a.status IN ('aceptado','reprogramado');
 END IF;
 IF starts IS NOT NULL OR p_request.proposed_by='advisor' THEN
  starts:=coalesce(starts,p_request.proposed_start_time); ends:=coalesce(ends,p_request.proposed_end_time);
  day:=(starts AT TIME ZONE zone)::date;
  IF starts IS NOT NULL THEN hours:=ARRAY[extract(hour FROM starts AT TIME ZONE zone)::integer]; mins:=extract(minute FROM starts AT TIME ZONE zone)::integer; END IF;
  verified:=starts IS NOT NULL;
 ELSE
  FOR r IN WITH RECURSIVE lineage AS (
   SELECT p_request AS item,0 AS depth UNION ALL
   SELECT prev,lineage.depth+1 FROM public.appointment_reschedule_requests prev JOIN lineage ON prev.id=(lineage.item).previous_request_id
    WHERE lineage.depth<15 AND prev.appointment_id=p_request.appointment_id AND prev.lead_id=p_request.lead_id
     AND prev.project_id=p_request.project_id AND prev.tenant_id=p_request.tenant_id
  ) SELECT (item).* FROM lineage ORDER BY depth DESC LOOP
   IF r.proposed_by='advisor' AND r.proposed_start_time IS NOT NULL THEN
    day:=(r.proposed_start_time AT TIME ZONE zone)::date; hours:=ARRAY[extract(hour FROM r.proposed_start_time AT TIME ZONE zone)::integer];
    mins:=extract(minute FROM r.proposed_start_time AT TIME ZONE zone)::integer; day_source:='proposal'; unclear:=false; CONTINUE;
   END IF;
   FOR metadata_entry IN SELECT value AS metadata,key AS source_id FROM jsonb_each(coalesce(r.interpreted_source_texts,'{}'::jsonb)) entry
    JOIN public.messages m ON m.id::text=entry.key JOIN public.conversations c ON c.id=m.conversation_id
    WHERE c.lead_id=r.lead_id AND c.project_id=r.project_id AND c.tenant_id=r.tenant_id AND m.role='cliente'
     AND (m.id=ANY(coalesce(r.intake_source_ids,'{}'::uuid[])) OR m.id::text=r.source_message_id OR m.external_message_id=r.source_message_id)
    ORDER BY m.sent_at,m.id LOOP
    pref:=metadata_entry.metadata;
    SELECT m.* INTO source FROM public.messages m WHERE m.id::text=metadata_entry.source_id;
    IF pref->>'version' IS DISTINCT FROM 'visit-preference-v2' THEN legacy:=true; CONTINUE; END IF;
    IF nullif(trim(pref->>'evidence'),'') IS NULL OR position(lower(pref->>'evidence') in lower(source.content))=0 THEN CONTINUE; END IF;
    parts:=public.lv_visit_typed_parts(pref,source.sent_at,zone);
    IF parts->>'valid' IS DISTINCT FROM 'true' THEN CONTINUE; END IF;
    verified:=true; source_at:=source.sent_at;
    new_day:=(parts->>'requested_date')::date;
    IF new_day IS NOT NULL THEN
     IF day IS NOT NULL AND day IS DISTINCT FROM new_day AND parts->>'keep_time' IS DISTINCT FROM 'true' THEN hours:=NULL; END IF;
     day:=new_day; day_source:=source.id::text; unclear:=false;
    END IF;
    IF parts->>'clear_date'='true' THEN day:=NULL; day_source:=NULL; END IF;
    IF parts->>'clear_time'='true' THEN hours:=NULL; END IF;
    IF parts->>'ambiguous'='true' THEN unclear:=true; END IF;
    IF parts ? 'hours' THEN SELECT array_agg(value::integer) INTO hours FROM jsonb_array_elements_text(parts->'hours'); mins:=(parts->>'minute')::integer; unclear:=false; END IF;
    IF parts->>'period' IS NOT NULL AND hours IS NOT NULL THEN SELECT array_agg(h) INTO hours FROM unnest(hours) h
      WHERE parts->>'period'='morning' AND h<12 OR parts->>'period'='afternoon' AND h>=12 AND h<18 OR parts->>'period'='evening' AND h>=18; END IF;
   END LOOP;
  END LOOP;
  IF day IS NOT NULL AND hours IS NOT NULL AND NOT unclear THEN
   IF cardinality(hours)=1 THEN starts:=(day+make_time(hours[1],mins,0)) AT TIME ZONE zone;
   ELSE SELECT array_agg(candidate ORDER BY candidate) INTO candidates FROM (
     SELECT (day+make_time(h,mins,0)) AT TIME ZONE zone AS candidate FROM unnest(hours) h
    ) times WHERE public.lv_interval_within_business_hours(p_request.project_id,candidate,candidate+interval '1 hour');
    IF cardinality(candidates)=1 THEN starts:=candidates[1]; END IF;
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('contract_version','visit-preference-v2','confidence',CASE WHEN starts IS NOT NULL THEN 'exact' WHEN unclear THEN 'ambiguous' WHEN day IS NOT NULL THEN 'date_only' WHEN hours IS NOT NULL THEN 'time_only' ELSE 'unknown' END,
  'requested_date',day,'start_time',starts,'end_time',coalesce(ends,starts+interval '1 hour'),'has_time',hours IS NOT NULL,'hours',to_jsonb(hours),'minute',mins,
  'source_verified',verified,'source_at',coalesce(source_at,p_request.created_at),'source_message_id',p_request.source_message_id,
  'date_source',day_source,'source_text',p_request.source_message_text,'source_messages',current_messages,'timezone',zone,
  'legacy_metadata_present',legacy,'requires_typed_recovery',NOT verified,
  'missing_fields',to_jsonb(array_remove(ARRAY[CASE WHEN day IS NULL THEN 'date' END,CASE WHEN starts IS NULL THEN 'time' END],NULL)));
END $fn$;
REVOKE ALL ON FUNCTION public.lv_requested_visit_slot(public.appointment_reschedule_requests) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.lv_verified_visit_dialogue_source(p_conversation uuid,p_current_message uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE c public.conversations; current_message public.messages; source_message public.messages;
 state jsonb; preference jsonb; intent jsonb; policies jsonb; source_id text;
BEGIN
 SELECT * INTO c FROM public.conversations WHERE id=p_conversation;
 SELECT * INTO current_message FROM public.messages WHERE id=p_current_message AND conversation_id=c.id AND role='cliente';
 IF c.id IS NULL OR current_message.id IS NULL OR jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RETURN NULL; END IF;
 BEGIN state:=(coalesce(nullif(c.summary,''),'{}')::jsonb)->'_visit_dialogue'; EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
 preference:=p_payload->'source_preference'; intent:=p_payload->'current_intent';
 IF state->>'version' IS DISTINCT FROM 'visit-dialogue-v1' OR state->>'status' IS DISTINCT FROM 'offered'
  OR coalesce((state->>'alternative_accepted')::boolean,false) OR state->>'offered_destination' IS NULL
  OR preference->>'version' IS DISTINCT FROM 'visit-preference-v2' OR preference->>'decision' IS DISTINCT FROM 'specified'
  OR intent->>'kind' IS DISTINCT FROM 'accept_visit_preference' OR intent->>'purpose' IS DISTINCT FROM 'accept_alternative'
  OR intent->>'target' IS DISTINCT FROM 'project' OR intent->>'confidence' NOT IN ('high','medium')
  OR intent->>'destination' IS DISTINCT FROM state->>'offered_destination' THEN RETURN NULL; END IF;
 IF nullif(trim(intent->>'evidence'),'') IS NULL OR position(lower(intent->>'evidence') in lower(current_message.content))=0 THEN RETURN NULL; END IF;
 source_id:=coalesce(preference#>>'{source,message_id}',preference->>'source_message_id');
 IF source_id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(
   CASE WHEN jsonb_typeof(state->'pending_preferences')='array' THEN state->'pending_preferences'
    ELSE jsonb_build_array(state->'pending_preference') END) saved
   WHERE source_id=coalesce(saved#>>'{source,message_id}',saved->>'source_message_id')
    AND preference->'date'=saved->'date' AND preference->'time'=saved->'time'
    AND preference->>'evidence'=saved->>'evidence' AND preference->>'decision'=saved->>'decision') THEN RETURN NULL; END IF;
 SELECT * INTO source_message FROM public.messages WHERE conversation_id=c.id AND role='cliente'
  AND (id::text=source_id OR external_message_id=source_id) AND sent_at<current_message.sent_at LIMIT 1;
 IF source_message.id IS NULL OR nullif(trim(preference->>'evidence'),'') IS NULL
  OR position(lower(preference->>'evidence') in lower(source_message.content))=0 THEN RETURN NULL; END IF;
 IF public.lv_visit_typed_parts(preference,source_message.sent_at,
   coalesce((SELECT timezone FROM public.project_automation_config WHERE project_id=c.project_id AND tenant_id=c.tenant_id),'America/Guayaquil'))->>'valid' IS DISTINCT FROM 'true' THEN RETURN NULL; END IF;
 SELECT policies_json INTO policies FROM public.projects WHERE id=c.project_id AND tenant_id=c.tenant_id;
 IF NOT coalesce((policies#>'{project_readiness,current,enabledPlaces}') ? (state->>'offered_destination'),false) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('source_id',source_message.id,'destination',state->>'offered_destination',
  'interpretation',preference||jsonb_build_object('location_type',state->>'offered_destination'));
END $fn$;
REVOKE ALL ON FUNCTION public.lv_verified_visit_dialogue_source(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lv_verified_visit_dialogue_source(uuid,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.lv_collect_visit_intake(p_lead uuid,p_message text,p_needs_help boolean DEFAULT false,p_previous_request uuid DEFAULT NULL,p_snapshot jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE c public.conversations; m public.messages; original public.messages; draft public.lv_visit_intakes; r public.appointment_reschedule_requests;
 parent public.appointment_reschedule_requests; a public.appointments; slot jsonb; day date; zone text; config jsonb; appt uuid; v_sla integer;
 policies jsonb; readiness jsonb; enabled_places jsonb:='[]'::jsonb; preferred_place text; metadata jsonb; metadata_parts jsonb;
 source_id text; current_context jsonb; answer jsonb; saved_state jsonb; valid_metadata boolean:=false; dialogue_source jsonb;
 batch_item jsonb;
BEGIN
 SELECT cv.* INTO c FROM public.conversations cv JOIN public.messages msg ON msg.conversation_id=cv.id
 WHERE cv.lead_id=p_lead AND cv.project_id='b1b2c3d4-0001-4000-8000-000000000001' AND cv.tenant_id='a1b2c3d4-0001-4000-8000-000000000001'
 AND cv.channel='whatsapp' AND msg.role='cliente' AND (msg.external_message_id=p_message OR msg.id::text=p_message) LIMIT 1;
 IF NOT FOUND THEN RAISE EXCEPTION 'Mensaje de visita no verificado'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.tenant_id::text||':'||c.project_id::text,0));
 PERFORM 1 FROM public.leads WHERE id=p_lead FOR UPDATE;
 SELECT * INTO m FROM public.messages WHERE conversation_id=c.id AND role='cliente' AND (external_message_id=p_message OR id::text=p_message) LIMIT 1;
 SELECT coalesce(timezone,'America/Guayaquil'),business_hours,coalesce(review_sla_minutes,90) INTO zone,config,v_sla
 FROM public.project_automation_config WHERE project_id=c.project_id AND tenant_id=c.tenant_id;
 zone:=coalesce(zone,'America/Guayaquil');
 INSERT INTO public.lv_visit_intakes(conversation_id,lead_id,tenant_id,project_id) VALUES(c.id,c.lead_id,c.tenant_id,c.project_id) ON CONFLICT DO NOTHING;
 SELECT * INTO draft FROM public.lv_visit_intakes WHERE conversation_id=c.id FOR UPDATE;
 IF draft.status='submitted' AND m.id=ANY(draft.source_ids) THEN
  SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=draft.request_id;
  RETURN jsonb_build_object('action','submitted','request_id',draft.request_id,'slot',public.lv_requested_visit_slot(r),'needs_help',draft.needs_help,'preferred_location_type',r.preferred_location_type);
 END IF;
 IF draft.status='submitted' THEN
  draft.source_ids:='{}'; draft.needs_help:=false; draft.preferred_period:=NULL; draft.previous_request_id:=NULL;
  draft.preferred_location_type:=NULL; draft.interpreted_source_texts:='{}'::jsonb;
 END IF;
 metadata:=p_snapshot->'_interpreted_visit';
 IF metadata->>'version'='visit-preference-v2' THEN
  IF metadata#>>'{source,kind}'='current' AND (metadata#>>'{source,message_id}' IS NULL OR metadata#>>'{source,message_id}' IN (m.id::text,m.external_message_id)) THEN original:=m;
  ELSIF metadata#>>'{source,kind}'='history' THEN
   current_context:=p_snapshot->'_visit_preference_context'; answer:=current_context->'answer';
   BEGIN saved_state:=coalesce(nullif(c.summary,''),'{}')::jsonb; EXCEPTION WHEN OTHERS THEN saved_state:='{}'::jsonb; END;
   IF draft.status='collecting' AND current_context->>'question_id'='visit_date_time' AND saved_state#>>'{_pending_question,id}'='visit_date_time'
    AND answer->>'question_id'='visit_date_time' AND answer->>'kind' IN ('affirmative','value') AND answer->>'confidence' IN ('high','medium')
    AND nullif(trim(answer->>'evidence'),'') IS NOT NULL AND position(lower(answer->>'evidence') in lower(m.content))>0 THEN
    SELECT * INTO original FROM public.messages WHERE conversation_id=c.id AND role='cliente' AND id=ANY(draft.source_ids)
     AND (id::text=metadata#>>'{source,message_id}' OR external_message_id=metadata#>>'{source,message_id}') AND sent_at<m.sent_at LIMIT 1;
   END IF;
  END IF;
  IF original.id IS NOT NULL AND nullif(trim(metadata->>'evidence'),'') IS NOT NULL AND length(metadata->>'evidence')<=1000
   AND position(lower(metadata->>'evidence') in lower(original.content))>0 THEN
   metadata_parts:=public.lv_visit_typed_parts(metadata,original.sent_at,zone);
   IF metadata_parts->>'valid'='true' THEN
    draft.interpreted_source_texts:=coalesce(draft.interpreted_source_texts,'{}'::jsonb)||jsonb_build_object(original.id::text,metadata);
    valid_metadata:=true;
   END IF;
  END IF;
 END IF;
 -- Each current component retains its own customer message. The service supplies
 -- the actual inbound batch IDs; no prose or historical model ID grants access.
 IF jsonb_typeof(p_snapshot->'_interpreted_visits')='array'
  AND jsonb_array_length(p_snapshot->'_interpreted_visits')<=12
  AND jsonb_typeof(p_snapshot->'_current_visit_message_ids')='array' THEN
  FOR batch_item IN SELECT value FROM jsonb_array_elements(p_snapshot->'_interpreted_visits') LOOP
   original:=NULL;
   IF batch_item->>'version'='visit-preference-v2' AND batch_item#>>'{source,kind}'='current'
    AND (p_snapshot->'_current_visit_message_ids') ? (batch_item#>>'{source,message_id}') THEN
    SELECT * INTO original FROM public.messages WHERE conversation_id=c.id AND role='cliente'
     AND (external_message_id=batch_item#>>'{source,message_id}' OR id::text=batch_item#>>'{source,message_id}')
     AND sent_at<=m.sent_at AND sent_at>=m.sent_at-interval '5 minutes' LIMIT 1;
    IF original.id IS NOT NULL AND nullif(trim(batch_item->>'evidence'),'') IS NOT NULL
     AND length(batch_item->>'evidence')<=1000 AND position(lower(batch_item->>'evidence') in lower(original.content))>0
     AND public.lv_visit_typed_parts(batch_item,original.sent_at,zone)->>'valid'='true' THEN
     draft.interpreted_source_texts:=coalesce(draft.interpreted_source_texts,'{}'::jsonb)||jsonb_build_object(original.id::text,batch_item);
     SELECT array_agg(DISTINCT x) INTO draft.source_ids FROM (SELECT unnest(draft.source_ids) x UNION ALL SELECT original.id) ids;
     valid_metadata:=true; metadata:=batch_item;
    END IF;
   END IF;
  END LOOP;
 END IF;
 FOR batch_item IN SELECT value FROM jsonb_array_elements(
   CASE WHEN jsonb_typeof(p_snapshot#>'{_visit_dialogue_consent,source_preferences}')='array'
    AND jsonb_array_length(p_snapshot#>'{_visit_dialogue_consent,source_preferences}')<=12
    THEN p_snapshot#>'{_visit_dialogue_consent,source_preferences}'
    ELSE jsonb_build_array(p_snapshot#>'{_visit_dialogue_consent,source_preference}') END) LOOP
  dialogue_source:=public.lv_verified_visit_dialogue_source(c.id,m.id,
    (p_snapshot->'_visit_dialogue_consent')||jsonb_build_object('source_preference',batch_item));
  IF dialogue_source IS NOT NULL THEN
   draft.interpreted_source_texts:=coalesce(draft.interpreted_source_texts,'{}'::jsonb)||jsonb_build_object(dialogue_source->>'source_id',dialogue_source->'interpretation');
   SELECT array_agg(DISTINCT x) INTO draft.source_ids FROM (SELECT unnest(draft.source_ids) x UNION ALL SELECT (dialogue_source->>'source_id')::uuid) ids;
   valid_metadata:=true;
  END IF;
 END LOOP;
 dialogue_source:=public.lv_verified_visit_dialogue_source(c.id,m.id,p_snapshot->'_visit_dialogue_consent');
 SELECT array_agg(DISTINCT x) INTO draft.source_ids FROM (SELECT unnest(draft.source_ids) x UNION ALL SELECT m.id) ids;
 p_previous_request:=coalesce(p_previous_request,draft.previous_request_id);
 IF p_previous_request IS NOT NULL THEN
  SELECT * INTO parent FROM public.appointment_reschedule_requests WHERE id=p_previous_request AND lead_id=p_lead AND project_id=c.project_id AND tenant_id=c.tenant_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Solicitud no encontrada'; END IF;
  IF p_snapshot ? 'updated_at' AND (p_snapshot->>'updated_at')::timestamptz IS DISTINCT FROM parent.updated_at THEN RETURN jsonb_build_object('action','stale'); END IF;
  SELECT * INTO a FROM public.appointments WHERE id=parent.appointment_id FOR UPDATE;
  IF a.status IN ('cancelado','atendido') OR a.no_show IS TRUE THEN RETURN jsonb_build_object('action','stale'); END IF;
  IF EXISTS(SELECT 1 FROM public.appointment_reschedule_requests q WHERE q.appointment_id=a.id AND q.id<>parent.id AND q.created_at>parent.created_at) THEN RETURN jsonb_build_object('action','stale'); END IF;
  r.appointment_id:=a.id; r.previous_request_id:=parent.id; draft.previous_request_id:=parent.id;
 END IF;
 r.tenant_id:=c.tenant_id; r.project_id:=c.project_id; r.lead_id:=p_lead; r.source_message_id:=p_message; r.source_message_text:=m.content;
 r.preferred_time_text:=NULL; r.interpreted_source_texts:=draft.interpreted_source_texts; r.proposed_by:='client'; r.created_at:=m.sent_at; r.intake_source_ids:=draft.source_ids;
 slot:=public.lv_requested_visit_slot(r); day:=(slot->>'requested_date')::date;
 SELECT p.policies_json INTO policies FROM public.projects p WHERE p.id=c.project_id AND p.tenant_id=c.tenant_id;
 readiness:=policies#>'{project_readiness,current}';
 IF jsonb_typeof(readiness->'enabledPlaces')='array' THEN enabled_places:=readiness->'enabledPlaces';
 ELSE enabled_places:=jsonb_build_array(CASE WHEN policies#>>'{bot_visits,launch_destination}'='office' THEN 'office' ELSE 'site' END); END IF;
 preferred_place:=draft.preferred_location_type;
 IF valid_metadata AND metadata->>'location_type' IS NOT NULL AND enabled_places ? (metadata->>'location_type') THEN preferred_place:=metadata->>'location_type'; END IF;
 IF dialogue_source IS NOT NULL THEN preferred_place:=dialogue_source->>'destination'; END IF;
 IF preferred_place IS NULL AND jsonb_array_length(enabled_places)=1 THEN SELECT value INTO preferred_place FROM jsonb_array_elements_text(enabled_places) LIMIT 1; END IF;
 IF metadata_parts->>'period' IS NOT NULL THEN draft.preferred_period:=metadata_parts->>'period'; END IF;
 UPDATE public.lv_visit_intakes SET source_ids=draft.source_ids,status='collecting',needs_help=draft.needs_help OR p_needs_help,
  preferred_period=draft.preferred_period,previous_request_id=draft.previous_request_id,preferred_location_type=preferred_place,
  interpreted_source_texts=draft.interpreted_source_texts,updated_at=now() WHERE conversation_id=c.id;
 IF NOT valid_metadata THEN RETURN jsonb_build_object('action','collecting','slot',slot,'preferred_location_type',preferred_place,
  'requires_typed_recovery',true,'missing_fields',slot->'missing_fields'); END IF;
 IF metadata->>'location_type' IS NOT NULL AND NOT enabled_places ? (metadata->>'location_type') AND dialogue_source IS NULL THEN
  RETURN jsonb_build_object('action','collecting','slot',slot,'needs_location',true,'requires_destination_acceptance',true,'enabled_places',enabled_places);
 END IF;
 IF day IS NOT NULL AND day<(now() AT TIME ZONE zone)::date THEN RETURN jsonb_build_object('action','past','slot',slot); END IF;
 IF day IS NOT NULL AND NOT coalesce(config ? extract(isodow FROM day)::text,false) THEN RETURN jsonb_build_object('action','closed_day','slot',slot); END IF;
 IF slot->>'confidence'='exact' AND NOT public.lv_interval_within_business_hours(c.project_id,(slot->>'start_time')::timestamptz,(slot->>'end_time')::timestamptz) THEN RETURN jsonb_build_object('action','outside_hours','slot',slot,'hours',config->extract(isodow FROM day)::text); END IF;
 IF slot->>'confidence'='exact' AND (slot->>'start_time')::timestamptz<=now() THEN RETURN jsonb_build_object('action','past','slot',slot); END IF;
 IF slot->>'confidence'='exact' AND preferred_place IS NULL AND jsonb_array_length(enabled_places)>1 THEN RETURN jsonb_build_object('action','collecting','slot',slot,'needs_location',true,'enabled_places',enabled_places); END IF;
 IF metadata->>'decision' IN ('ambiguous','declined','none') THEN RETURN jsonb_build_object('action','collecting','slot',slot,'missing_fields',slot->'missing_fields'); END IF;
 IF slot->>'confidence'='exact' OR p_needs_help OR draft.needs_help THEN
  IF parent.id IS NOT NULL THEN
   UPDATE public.appointment_reschedule_requests SET status='superseded',resolved_at=now(),updated_at=now() WHERE id=parent.id AND status IN ('awaiting_advisor','awaiting_client');
   DELETE FROM public.appointment_time_holds WHERE request_id=parent.id;
   PERFORM public.lv_cancel_pending_visit_outbox(a.id,'cliente eligió un nuevo horario');
  END IF;
  IF parent.id IS NULL THEN
   appt:=public.lv_intake_visit_once(p_lead,c.project_id,NULL,NULL,NULL,p_message,m.content);
   UPDATE public.appointments SET location_type=CASE WHEN preferred_place='office' THEN 'oficina' ELSE 'proyecto' END WHERE id=appt;
   SELECT * INTO r FROM public.appointment_reschedule_requests WHERE appointment_id=appt AND source_message_id=p_message ORDER BY created_at DESC LIMIT 1;
  ELSE
   INSERT INTO public.appointment_reschedule_requests(tenant_id,project_id,appointment_id,lead_id,request_type,proposed_by,previous_request_id,status,
     previous_start_time,previous_end_time,preferred_time_text,source_message_text,source_channel,source_message_id,intake_source_ids,
     assigned_advisor_id,assigned_at,escalation_due_at,preferred_location_type,interpreted_source_texts)
   VALUES(c.tenant_id,c.project_id,a.id,p_lead,CASE WHEN a.status IN ('aceptado','reprogramado') THEN 'reschedule' ELSE 'new_appointment' END,
     'client',parent.id,'awaiting_advisor',a.start_time,a.end_time,NULL,m.content,'whatsapp',p_message,draft.source_ids,
     a.responsible_id,now(),now()+make_interval(mins=>coalesce(v_sla,90)),preferred_place,draft.interpreted_source_texts) RETURNING * INTO r;
   INSERT INTO public.lv_appointment_assignment_events(tenant_id,project_id,appointment_id,request_id,from_advisor_id,to_advisor_id,action,reason)
   VALUES(c.tenant_id,c.project_id,a.id,r.id,a.responsible_id,a.responsible_id,'counterproposed','client: '||p_message);
   IF a.responsible_id IS NULL THEN PERFORM public.lv_assign_appointment_fairly(r.id,ARRAY[]::uuid[]); END IF;
  END IF;
  IF r.id IS NULL THEN RAISE EXCEPTION 'No se pudo registrar la solicitud'; END IF;
  UPDATE public.appointment_reschedule_requests SET intake_source_ids=draft.source_ids,preferred_location_type=preferred_place,
   interpreted_source_texts=draft.interpreted_source_texts WHERE id=r.id RETURNING * INTO r;
  UPDATE public.lv_visit_intakes SET status='submitted',request_id=r.id WHERE conversation_id=c.id;
  RETURN jsonb_build_object('action','submitted','request_id',r.id,'slot',public.lv_requested_visit_slot(r),'needs_help',p_needs_help OR draft.needs_help,'preferred_period',draft.preferred_period,'preferred_location_type',preferred_place);
 END IF;
 RETURN jsonb_build_object('action','collecting','slot',slot,'preferred_period',draft.preferred_period,'preferred_location_type',preferred_place,'missing_fields',slot->'missing_fields');
END $fn$;
REVOKE ALL ON FUNCTION public.lv_collect_visit_intake(uuid,text,boolean,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_collect_visit_intake(uuid,text,boolean,uuid,jsonb) TO service_role;
NOTIFY pgrst,'reload schema';
COMMIT;
