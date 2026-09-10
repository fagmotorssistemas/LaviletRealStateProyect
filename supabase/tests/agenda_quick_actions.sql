-- Ejecutar completo: todas las filas de prueba y mensajes en cola se revierten.
BEGIN;
SET LOCAL statement_timeout='25s';
DO $test$
DECLARE
 base public.appointment_reschedule_requests;
 a_id uuid:=gen_random_uuid(); b_id uuid:=gen_random_uuid(); block_id uuid:=gen_random_uuid();
 req_id uuid:=gen_random_uuid(); msg_id uuid:=gen_random_uuid(); conv_id uuid; absence_id uuid;
 opts jsonb; starts timestamptz; ends timestamptz; result public.appointment_reschedule_requests; blocked boolean;
BEGIN
 ASSERT public.lv_parse_visit_preference('Me viene bien mañana a las 10 am','2026-09-10T14:21:00Z')->>'confidence'='exact','Fecha y hora explícitas';
 ASSERT (public.lv_parse_visit_preference('Me viene bien mañana a las 10 am','2026-09-10T14:21:00Z')->>'start_time')::timestamptz='2026-09-11T15:00:00Z'::timestamptz,'Mañana se calcula desde el mensaje';
 ASSERT public.lv_parse_visit_preference('Bueno mejor quiero reagendar para hoy','2026-09-10T14:47:00Z')->>'confidence'='date_only','Bueno mejor no es una negación';
 ASSERT public.lv_parse_visit_preference('No me viene bien mañana a las 10 am','2026-09-10T14:47:00Z')->>'confidence'='ambiguous','No aceptar negaciones';
 ASSERT public.lv_parse_visit_preference('mañana a las 10 am y 11 am','2026-09-10T14:47:00Z')->>'confidence'='ambiguous','No elegir entre dos horas';
 ASSERT public.lv_parse_visit_preference('hoy o mañana a las 10 am','2026-09-10T14:47:00Z')->>'confidence'='ambiguous','No elegir entre dos días';
 ASSERT public.lv_parse_visit_preference('mañana a las 5','2026-09-10T14:47:00Z')->>'confidence'='ambiguous','No inventar AM o PM';
 SELECT r.* INTO base FROM public.appointment_reschedule_requests r
 WHERE public.lv_advisor_eligible_on_project(r.assigned_advisor_id,r.tenant_id,r.project_id)
 AND EXISTS(SELECT 1 FROM public.conversations c WHERE c.lead_id=r.lead_id AND c.project_id=r.project_id AND c.channel='whatsapp')
 ORDER BY r.created_at DESC LIMIT 1;
 ASSERT base.id IS NOT NULL,'Se necesita un asesor activo y una conversación de prueba existente';
 PERFORM set_config('request.jwt.claim.sub',base.assigned_advisor_id::text,true);
 SELECT id INTO conv_id FROM public.conversations WHERE lead_id=base.lead_id AND project_id=base.project_id AND channel='whatsapp' LIMIT 1;
 INSERT INTO public.appointments(id,tenant_id,project_id,lead_id,responsible_id,title,status)
 VALUES(a_id,base.tenant_id,base.project_id,base.lead_id,base.assigned_advisor_id,'PRUEBA TRANSACCIONAL NO PUBLICAR','solicitada');
 INSERT INTO public.messages(id,conversation_id,role,content,sent_at) VALUES(msg_id,conv_id,'cliente','Bueno mejor quiero reagendar para hoy',now());
 INSERT INTO public.appointment_reschedule_requests(id,tenant_id,project_id,appointment_id,lead_id,request_type,proposed_by,source_message_id,source_channel,assigned_advisor_id)
 VALUES(req_id,base.tenant_id,base.project_id,a_id,base.lead_id,'new_appointment','client',msg_id::text,'whatsapp',base.assigned_advisor_id);
 opts:=public.lv_visit_scheduling_options(req_id);
 ASSERT NOT (opts->>'can_accept')::boolean AND opts->'requested'->>'confidence'='date_only','No aceptar un día sin hora';
 ASSERT jsonb_array_length(opts->'slots')>0,'Debe encontrar espacios';
 starts:=(opts->'slots'->0->>'start_time')::timestamptz;
 ends:=(opts->'slots'->0->>'end_time')::timestamptz;
 ASSERT NOT EXISTS(SELECT 1 FROM public.lv_outbox WHERE appointment_id=a_id),'Consultar recomendaciones no envía mensajes';
 UPDATE public.messages SET content=to_char(starts AT TIME ZONE 'America/Guayaquil','YYYY-MM-DD "a las" HH24:MI') WHERE id=msg_id;
 opts:=public.lv_visit_scheduling_options(req_id);
 ASSERT (opts->>'can_accept')::boolean,'Horario inequívoco disponible';
 blocked:=false;
 BEGIN PERFORM public.lv_accept_client_visit_time(req_id,starts,ends,'mensaje-falso'); EXCEPTION WHEN OTHERS THEN blocked:=true; END;
 ASSERT blocked,'Rechazar mensaje ajeno';
 blocked:=false;
 BEGIN PERFORM public.lv_accept_client_visit_time(req_id,starts+interval '30 min',ends+interval '30 min',msg_id::text); EXCEPTION WHEN OTHERS THEN blocked:=true; END;
 ASSERT blocked,'No sustituir la hora autorizada';
 PERFORM set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 blocked:=false;
 BEGIN PERFORM public.lv_visit_scheduling_options(req_id); EXCEPTION WHEN OTHERS THEN blocked:=true; END;
 ASSERT blocked,'No acceder como otro usuario';
 PERFORM set_config('request.jwt.claim.sub',base.assigned_advisor_id::text,true);
 INSERT INTO public.appointments(id,tenant_id,project_id,lead_id,responsible_id,title,status,start_time,end_time)
 VALUES(block_id,base.tenant_id,base.project_id,base.lead_id,base.assigned_advisor_id,'CONFLICTO TEMPORAL','aceptado',starts,ends);
 opts:=public.lv_visit_scheduling_options(req_id);
 ASSERT opts->>'reason'='busy' AND NOT (opts->>'can_accept')::boolean,'Detectar cruce de citas';
 ASSERT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(opts->'slots') s WHERE tstzrange((s->>'start_time')::timestamptz,(s->>'end_time')::timestamptz,'[)') && tstzrange(starts,ends,'[)')),'No recomendar cruces';
 blocked:=false;
 BEGIN PERFORM public.lv_accept_client_visit_time(req_id,starts,ends,msg_id::text); EXCEPTION WHEN OTHERS THEN blocked:=true; END;
 ASSERT blocked,'Revalidar agenda al aceptar';
 DELETE FROM public.appointments WHERE id=block_id;
 INSERT INTO public.project_salesperson_time_off(tenant_id,project_id,salesperson_id,starts_at,ends_at,reason)
 VALUES(base.tenant_id,base.project_id,base.assigned_advisor_id,starts,ends,'PRUEBA TRANSACCIONAL') RETURNING id INTO absence_id;
 ASSERT public.lv_visit_scheduling_options(req_id)->>'reason'='busy','Respetar ausencias';
 DELETE FROM public.project_salesperson_time_off WHERE id=absence_id;
 result:=public.lv_accept_client_visit_time(req_id,starts,ends,msg_id::text);
 ASSERT result.status='confirmed' AND result.client_acceptance_message_id=msg_id::text,'Confirmación con evidencia real';
 ASSERT EXISTS(SELECT 1 FROM public.appointments WHERE id=a_id AND start_time=starts AND end_time=ends AND status='aceptado' AND confirmed_by_client),'Cita en calendario';
 ASSERT (SELECT count(*) FROM public.lv_outbox WHERE appointment_id=a_id)=1,'Una confirmación en cola';
 result:=public.lv_accept_client_visit_time(req_id,starts,ends,msg_id::text);
 ASSERT (SELECT count(*) FROM public.lv_outbox WHERE appointment_id=a_id)=1,'Doble clic no duplica';
 INSERT INTO public.appointments(id,tenant_id,project_id,lead_id,responsible_id,title,status)
 VALUES(b_id,base.tenant_id,base.project_id,base.lead_id,base.assigned_advisor_id,'PROPUESTA TEMPORAL','solicitada');
 req_id:=gen_random_uuid(); msg_id:=gen_random_uuid();
 INSERT INTO public.messages(id,conversation_id,role,content) VALUES(msg_id,conv_id,'cliente','Quiero una visita');
 INSERT INTO public.appointment_reschedule_requests(id,tenant_id,project_id,appointment_id,lead_id,request_type,proposed_by,source_message_id,source_channel,assigned_advisor_id)
 VALUES(req_id,base.tenant_id,base.project_id,b_id,base.lead_id,'new_appointment','client',msg_id::text,'whatsapp',base.assigned_advisor_id);
 opts:=public.lv_visit_scheduling_options(req_id);
 starts:=(opts->'slots'->0->>'start_time')::timestamptz; ends:=(opts->'slots'->0->>'end_time')::timestamptz;
 ASSERT NOT EXISTS(SELECT 1 FROM public.lv_outbox WHERE appointment_id=b_id),'Elegir horario no envía';
 result:=public.lv_advisor_propose_request(req_id,starts,ends,'');
 ASSERT result.status='awaiting_client','Enviar propuesta espera aceptación del cliente';
 ASSERT EXISTS(SELECT 1 FROM public.appointment_time_holds WHERE request_id=result.id),'Propuesta reserva temporalmente el horario';
 ASSERT EXISTS(SELECT 1 FROM public.appointments WHERE id=b_id AND status='solicitada' AND start_time IS NULL),'Propuesta no confirma visita antes del cliente';
 ASSERT (SELECT count(*) FROM public.lv_outbox WHERE appointment_id=b_id)=1,'Una propuesta en cola tras envío explícito';
 ASSERT NOT has_function_privilege('anon','public.lv_accept_client_visit_time(uuid,timestamp with time zone,timestamp with time zone,text)','EXECUTE'),'Anónimo sin acceso';
END $test$;
ROLLBACK;
SELECT 'Pruebas de agenda completadas; todas las filas temporales revertidas' AS result;
