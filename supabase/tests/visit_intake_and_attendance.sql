-- Real functions and permissions, synthetic data, rollback; never launches Salesbots.
BEGIN;
SET LOCAL statement_timeout='30s';
DO $test$
<<test_case>>
DECLARE
 tenant uuid:='a1b2c3d4-0001-4000-8000-000000000001'; project uuid:='b1b2c3d4-0001-4000-8000-000000000001';
 lead_id uuid:=gen_random_uuid(); conv uuid:=gen_random_uuid(); source uuid; day date; sunday date;
 r public.appointment_reschedule_requests; old_r public.appointment_reschedule_requests;
 a public.appointments; old_a public.appointments; result jsonb; options jsonb; starts timestamptz; rejected boolean;
 stamp timestamptz:=now()-interval '40 minutes';
BEGIN
 ASSERT to_regclass('public.lv_visit_intakes') IS NOT NULL,'Table installed';
 ASSERT has_function_privilege('service_role','public.lv_collect_visit_intake(uuid,text,boolean,uuid,jsonb)','EXECUTE'),'Worker has access';
 ASSERT NOT has_function_privilege('anon','public.lv_collect_visit_intake(uuid,text,boolean,uuid,jsonb)','EXECUTE'),'Anonymous cannot write intake';
 ASSERT NOT has_table_privilege('authenticated','public.lv_visit_intakes','SELECT'),'Drafts are private';
 SELECT d::date INTO day FROM generate_series((now() AT TIME ZONE 'America/Guayaquil')::date+1,
 (now() AT TIME ZONE 'America/Guayaquil')::date+20,interval '1 day') d
 WHERE extract(isodow FROM d) BETWEEN 1 AND 5 AND NOT EXISTS (
  SELECT 1 FROM public.project_salespeople ps WHERE ps.project_id=project
  AND public.lv_advisor_eligible_on_project(ps.salesperson_id,tenant,project)
  AND public.lv_advisor_has_conflict(ps.salesperson_id,(d::date+time '13:00') AT TIME ZONE 'America/Guayaquil',(d::date+time '17:00') AT TIME ZONE 'America/Guayaquil',NULL)
 ) ORDER BY d LIMIT 1;
 ASSERT day IS NOT NULL,'Available weekday';
 INSERT INTO public.leads(id,tenant_id,project_id,name,channel_origin,bot_enabled)
 VALUES(lead_id,tenant,project,'PRUEBA INTAKE Y ASISTENCIA TRANSACCIONAL','whatsapp',false);
 INSERT INTO public.conversations(id,tenant_id,project_id,lead_id,channel) VALUES(conv,tenant,project,lead_id,'whatsapp');
 source:=gen_random_uuid();
 INSERT INTO public.messages(id,conversation_id,role,content,sent_at) VALUES(source,conv,'cliente','Buenos días, quiero agendar',stamp);
 result:=public.lv_collect_visit_intake(lead_id,source::text);
 ASSERT result->>'action'='collecting','Initial request collects details';
 ASSERT NOT EXISTS(SELECT 1 FROM public.appointments WHERE appointments.lead_id=test_case.lead_id),'No early advisor notification';
 INSERT INTO public.messages(conversation_id,role,content,sent_at) VALUES(conv,'bot','¿Qué día y hora?',stamp+interval '1 minute');
 source:=gen_random_uuid();
 INSERT INTO public.messages(id,conversation_id,role,content,sent_at) VALUES(source,conv,'cliente','Para el '||day::text,stamp+interval '2 minutes');
 result:=public.lv_collect_visit_intake(lead_id,source::text);
 ASSERT result->>'action'='collecting' AND (result->'slot'->>'requested_date')::date=day,'Date alone is retained privately';
 ASSERT NOT EXISTS(SELECT 1 FROM public.appointments WHERE appointments.lead_id=test_case.lead_id),'Date without hour does not create appointment';
 INSERT INTO public.messages(conversation_id,role,content,sent_at) VALUES(conv,'bot','¿A qué hora?',stamp+interval '3 minutes');
 source:=gen_random_uuid();
 INSERT INTO public.messages(id,conversation_id,role,content,sent_at) VALUES(source,conv,'cliente','a lass 14 horas',stamp+interval '4 minutes');
 result:=public.lv_collect_visit_intake(lead_id,source::text);
 ASSERT result->>'action'='submitted','Complete date/time creates request';
 ASSERT jsonb_array_length(result->'slot'->'source_messages')=3,'Evidence includes three turns';
 SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=(result->>'request_id')::uuid;
 ASSERT r.assigned_advisor_id IS NOT NULL,'Real fair assignment succeeded';
 ASSERT public.lv_collect_visit_intake(lead_id,source::text)->>'request_id'=r.id::text,'Duplicate intake is idempotent';
 PERFORM set_config('request.jwt.claim.sub',r.assigned_advisor_id::text,true);
 options:=public.lv_visit_scheduling_options(r.id);
 ASSERT (options->>'can_accept')::boolean,'Advisor can accept complete preference';
 starts:=(options->'requested'->>'start_time')::timestamptz;
 ASSERT starts=(day+time '14:00') AT TIME ZONE 'America/Guayaquil','Original day plus new hour';
 r:=public.lv_accept_client_visit_time(r.id,starts,starts+interval '1 hour',source::text);
 ASSERT r.status='confirmed','Advisor acceptance confirms';
 ASSERT (SELECT count(*) FROM public.lv_outbox WHERE appointment_id=r.appointment_id AND kind='visit_confirm' AND status='pending')=1,'Exactly one confirmation queued';
 INSERT INTO public.messages(conversation_id,role,content,sent_at) VALUES(conv,'bot','Cita confirmada',stamp+interval '5 minutes');
 source:=gen_random_uuid();
 INSERT INTO public.messages(id,conversation_id,role,content,sent_at) VALUES(source,conv,'cliente','Quiero cambiar la hora',stamp+interval '6 minutes');
 result:=public.lv_collect_visit_intake(lead_id,source::text,false,r.id,to_jsonb(r));
 ASSERT result->>'action'='collecting','Partial change waits for lead';
 ASSERT public.lv_visit_is_collecting(r.appointment_id),'Advisor sees coordination in progress';
 ASSERT public.appointment_reminders_paused(r.appointment_id),'Old reminders paused';
 rejected:=false;
 BEGIN UPDATE public.appointments SET start_time=starts+interval '1 hour',end_time=starts+interval '2 hours' WHERE id=r.appointment_id;
 EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 ASSERT rejected,'Cannot confirm an old interval during collection';
 INSERT INTO public.messages(conversation_id,role,content,sent_at) VALUES(conv,'bot','¿A qué hora?',stamp+interval '7 minutes');
 source:=gen_random_uuid();
 INSERT INTO public.messages(id,conversation_id,role,content,sent_at) VALUES(source,conv,'cliente','a las 15 horas',stamp+interval '8 minutes');
 result:=public.lv_collect_visit_intake(lead_id,source::text,false,r.id,to_jsonb(r));
 ASSERT result->>'action'='submitted','Complete counterproposal submitted';
 SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=(result->>'request_id')::uuid;
 starts:=(result->'slot'->>'start_time')::timestamptz;
 ASSERT starts=(day+time '15:00') AT TIME ZONE 'America/Guayaquil','Counterproposal preserves day';
 r:=public.lv_accept_client_visit_time(r.id,starts,starts+interval '1 hour',source::text);
 SELECT * INTO a FROM public.appointments WHERE id=r.appointment_id;
 old_a:=a;
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 rejected:=false;
 BEGIN PERFORM public.lv_record_appointment_attendance(a.id,true,a.updated_at,'Asistió'); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 ASSERT rejected,'Unassigned user cannot change attendance';
 PERFORM set_config('request.jwt.claim.sub',r.assigned_advisor_id::text,true);
 a:=public.lv_record_appointment_attendance(a.id,true,a.updated_at,'Asistió');
 ASSERT a.status='atendido' AND a.no_show=false AND a.updated_at>old_a.updated_at,'Attendance updates result and version';
 rejected:=false;
 BEGIN PERFORM public.lv_record_appointment_attendance(a.id,false,a.updated_at,'Corregido'); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 ASSERT rejected,'Editing requires reason';
 rejected:=false;
 BEGIN PERFORM public.lv_record_appointment_attendance(a.id,false,old_a.updated_at,'Corregido','{}','Error al marcar'); EXCEPTION WHEN raise_exception THEN rejected:=true; END;
 ASSERT rejected,'Stale update rejected';
 a:=public.lv_record_appointment_attendance(a.id,false,a.updated_at,'Corregido','{}','Error al marcar');
 ASSERT EXISTS(SELECT 1 FROM public.appointment_change_log WHERE appointment_id=a.id AND action='asistencia_editada'
  AND detail->>'edit_reason'='Error al marcar' AND detail->>'previous_no_show'='false' AND detail->>'no_show'='true' AND detail->>'actor_name' IS NOT NULL),'Audit contains previous/new values and editor';
 PERFORM public.lv_record_appointment_attendance(a.id,false,a.updated_at,'Corregido');
 ASSERT (SELECT count(*) FROM public.appointment_change_log WHERE appointment_id=a.id AND action='asistencia_editada')=1,'Repeated result does not duplicate audit';
 ASSERT NOT EXISTS(SELECT 1 FROM public.lv_visit_intakes WHERE conversation_id=conv),'Completion clears draft';

 -- Starting over after attendance does not reuse the old preference.
 INSERT INTO public.messages(conversation_id,role,content,sent_at) VALUES(conv,'bot','¿Le ayudamos con otra visita?',stamp+interval '9 minutes');
 source:=gen_random_uuid();
 INSERT INTO public.messages(id,conversation_id,role,content,sent_at) VALUES(source,conv,'cliente','Quiero una visita para el '||(day+7)::text,stamp+interval '10 minutes');
 result:=public.lv_collect_visit_intake(lead_id,source::text);
 ASSERT result->>'action'='collecting','New visit does not inherit old clock';
 INSERT INTO public.messages(conversation_id,role,content,sent_at) VALUES(conv,'bot','¿A qué hora?',stamp+interval '11 minutes');
 source:=gen_random_uuid();
 INSERT INTO public.messages(id,conversation_id,role,content,sent_at) VALUES(source,conv,'cliente','No estoy seguro, pero en la tarde',stamp+interval '12 minutes');
 result:=public.lv_collect_visit_intake(lead_id,source::text,true);
 ASSERT result->>'action'='submitted' AND result->>'needs_help'='true','First uncertainty reaches advisor';
 SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id=(result->>'request_id')::uuid;
 PERFORM set_config('request.jwt.claim.sub',r.assigned_advisor_id::text,true);
 options:=public.lv_visit_scheduling_options(r.id);
 ASSERT options->'requested'->>'preferred_period'='afternoon','Afternoon preference visible';
 ASSERT jsonb_array_length(options->'slots')>0,'Recommendations available';
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(options->'slots') s WHERE
  ((s->>'start_time')::timestamptz AT TIME ZONE 'America/Guayaquil')::date<day+7 OR
  extract(hour FROM (s->>'start_time')::timestamptz AT TIME ZONE 'America/Guayaquil')<12),'Recommendations respect requested future date and afternoon';
 ASSERT NOT (options->>'can_accept')::boolean,'Cannot accept an unspecified client hour';
END $test$;
ROLLBACK;
SELECT 'PASS: real assignment, permissions, date collection, counterproposal, confirmation, attendance edits and recommendations; test data rolled back.' AS result;
