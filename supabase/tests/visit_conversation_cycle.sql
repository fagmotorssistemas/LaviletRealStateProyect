-- Prueba completa con lead, conversación y colas temporales. No ejecuta Salesbots.
BEGIN;
SET LOCAL statement_timeout='30s';
DO $test$
DECLARE
 tenant uuid:='a1b2c3d4-0001-4000-8000-000000000001'; project uuid:='b1b2c3d4-0001-4000-8000-000000000001';
 advisor uuid; lead_id uuid:=gen_random_uuid(); conv uuid:=gen_random_uuid(); apt uuid:=gen_random_uuid();
 source_id uuid; req public.appointment_reschedule_requests; prev public.appointment_reschedule_requests;
 res jsonb; opts jsonb; slot jsonb; message_at timestamptz; appointment2 uuid; day date;
 start3 timestamptz; start1 timestamptz; current_at timestamptz:=now(); rejected boolean;
BEGIN
 SELECT salesperson_id INTO advisor FROM public.project_salespeople ps WHERE ps.project_id=project AND ps.tenant_id=tenant
 AND public.lv_advisor_eligible_on_project(ps.salesperson_id,tenant,project) ORDER BY salesperson_id LIMIT 1;
 ASSERT advisor IS NOT NULL,'Asesor elegible para la prueba';
 PERFORM set_config('request.jwt.claim.sub',advisor::text,true);
 SELECT d::date INTO day FROM generate_series((now() AT TIME ZONE 'America/Guayaquil')::date+1,
 (now() AT TIME ZONE 'America/Guayaquil')::date+20,interval '1 day') d
 WHERE extract(isodow FROM d) BETWEEN 1 AND 5
 AND NOT public.lv_advisor_has_conflict(advisor,(d::date+time '13:00') AT TIME ZONE 'America/Guayaquil',(d::date+time '14:00') AT TIME ZONE 'America/Guayaquil',NULL)
 AND NOT public.lv_advisor_has_conflict(advisor,(d::date+time '15:00') AT TIME ZONE 'America/Guayaquil',(d::date+time '16:00') AT TIME ZONE 'America/Guayaquil',NULL)
 ORDER BY d LIMIT 1;
 ASSERT day IS NOT NULL,'Un día libre para probar';
 start3:=(day+time '15:00') AT TIME ZONE 'America/Guayaquil';
 start1:=(day+time '13:00') AT TIME ZONE 'America/Guayaquil';
 INSERT INTO public.leads(id,tenant_id,project_id,name,channel_origin) VALUES(lead_id,tenant,project,'PRUEBA CIRCUITO TRANSACCIONAL','whatsapp');
 INSERT INTO public.conversations(id,tenant_id,project_id,lead_id,channel) VALUES(conv,tenant,project,lead_id,'whatsapp');
 INSERT INTO public.appointments(id,tenant_id,project_id,lead_id,responsible_id,title,status)
 VALUES(apt,tenant,project,lead_id,advisor,'PRUEBA CIRCUITO TRANSACCIONAL','solicitada');
 source_id:=gen_random_uuid();
 INSERT INTO public.messages(id,conversation_id,role,content,sent_at) VALUES(source_id,conv,'cliente','Buenos días, quiero una visita',current_at-interval '20 min');
 INSERT INTO public.appointment_reschedule_requests(tenant_id,project_id,appointment_id,lead_id,request_type,proposed_by,source_message_id,source_channel,assigned_advisor_id)
 VALUES(tenant,project,apt,lead_id,'new_appointment','client',source_id::text,'whatsapp',advisor) RETURNING * INTO req;
 slot:=public.lv_requested_visit_slot(req);
 ASSERT slot->>'confidence'='unknown','Saludo no inventa fecha';
 INSERT INTO public.messages(conversation_id,role,content,sent_at) VALUES(conv,'bot','¿Qué día y hora?',current_at-interval '19 min');
 source_id:=gen_random_uuid();
 INSERT INTO public.messages(id,conversation_id,role,content,sent_at) VALUES(source_id,conv,'cliente','Para el '||day::text,current_at-interval '18 min');
 res:=public.lv_apply_client_visit_intent(tenant,project,lead_id,req.id,source_id::text,'counterproposal',to_jsonb(req));
 SELECT * INTO req FROM public.appointment_reschedule_requests WHERE id=(res->>'request_id')::uuid;
 slot:=public.lv_requested_visit_slot(req);
 ASSERT slot->>'confidence'='date_only' AND (slot->>'requested_date')::date=day,'Conservar el día de un turno anterior';
 INSERT INTO public.messages(conversation_id,role,content,sent_at) VALUES(conv,'bot','¿A qué hora?',current_at-interval '17 min');
 source_id:=gen_random_uuid();
 INSERT INTO public.messages(id,conversation_id,role,content,sent_at) VALUES(source_id,conv,'cliente','A las 4',current_at-interval '16 min');
 prev:=req;
 res:=public.lv_apply_client_visit_intent(tenant,project,lead_id,req.id,source_id::text,'counterproposal',to_jsonb(req));
 SELECT * INTO req FROM public.appointment_reschedule_requests WHERE id=(res->>'request_id')::uuid;
 ASSERT (public.lv_requested_visit_slot(req)->>'start_time')::timestamptz=start3+interval '1 hour','Día previo más hora actual';
 ASSERT public.lv_apply_client_visit_intent(tenant,project,lead_id,prev.id,source_id::text,'counterproposal',to_jsonb(prev))->>'action'='duplicate','Reintento no duplica solicitud';
 req:=public.lv_advisor_propose_request(req.id,start1,start1+interval '1 hour','');
 ASSERT req.status='awaiting_client','Asesor propone sin confirmar';
 ASSERT jsonb_array_length(public.lv_requested_visit_slot(req)->'source_messages')=1,'Propuesta conserva mensajes del cliente para el modal';
 UPDATE public.lv_outbox SET status='accepted',accepted_at=current_at-interval '10 min'
 WHERE appointment_id=apt AND kind='visit_propose' AND payload->>'request_id'=req.id::text;
 INSERT INTO public.messages(conversation_id,role,content,sent_at) VALUES(conv,'bot','Podemos recibirle a la 1. ¿Le queda bien?',current_at-interval '10 min');
 source_id:=gen_random_uuid();
 INSERT INTO public.messages(id,conversation_id,role,content,sent_at) VALUES(source_id,conv,'cliente','no puedo a esa hora, mejor a las 3',current_at-interval '9 min');
 res:=public.lv_apply_client_visit_intent(tenant,project,lead_id,req.id,source_id::text,'counterproposal',to_jsonb(req));
 SELECT * INTO req FROM public.appointment_reschedule_requests WHERE id=(res->>'request_id')::uuid;
 opts:=public.lv_visit_scheduling_options(req.id);
 ASSERT (opts->'requested'->>'start_time')::timestamptz=start3,'Contrapropuesta conserva el día y sustituye la hora';
 ASSERT (opts->>'can_accept')::boolean,'Asesor puede aceptar hora alternativa disponible';
 ASSERT NOT EXISTS(SELECT 1 FROM public.appointment_time_holds WHERE appointment_id=apt),'Soltar la propuesta anterior';
 req:=public.lv_accept_client_visit_time(req.id,start3,start3+interval '1 hour',source_id::text);
 ASSERT req.status='confirmed','Asesor acepta contrapropuesta';
 ASSERT EXISTS(SELECT 1 FROM public.appointments WHERE id=apt AND start_time=start3 AND status='aceptado'),'Calendario contiene horario aceptado';
 ASSERT (SELECT count(*) FROM public.lv_outbox WHERE appointment_id=apt AND kind='visit_confirm' AND status='pending')=1,'Una sola confirmación en cola';
 prev:=req;
 req:=public.lv_accept_client_visit_time(req.id,start3,start3+interval '1 hour',source_id::text);
 ASSERT (SELECT count(*) FROM public.lv_outbox WHERE appointment_id=apt AND kind='visit_confirm' AND status='pending')=1,'Doble clic idempotente';
 INSERT INTO public.messages(conversation_id,role,content,sent_at) VALUES(conv,'bot','Confirmamos la cita',current_at-interval '8 min');
 source_id:=gen_random_uuid();
 INSERT INTO public.messages(id,conversation_id,role,content,sent_at) VALUES(source_id,conv,'cliente','Mejor el '||(day+1)::text,current_at-interval '7 min');
 res:=public.lv_apply_client_visit_intent(tenant,project,lead_id,req.id,source_id::text,'counterproposal',to_jsonb(req));
 SELECT * INTO req FROM public.appointment_reschedule_requests WHERE id=(res->>'request_id')::uuid;
 ASSERT req.previous_request_id=prev.id AND req.request_type='reschedule','Reagendar después de confirmación es válido';
 ASSERT public.lv_requested_visit_slot(req)->>'confidence'='date_only','Cambiar de día no reutiliza una hora sin confirmación';
 ASSERT NOT EXISTS(SELECT 1 FROM public.lv_outbox WHERE appointment_id=apt AND status='pending'),'Invalidar confirmaciones pendientes al cambiar';
 INSERT INTO public.messages(conversation_id,role,content,sent_at) VALUES(conv,'bot','¿A qué hora ese día?',current_at-interval '6 min');
 source_id:=gen_random_uuid();
 INSERT INTO public.messages(id,conversation_id,role,content,sent_at) VALUES(source_id,conv,'cliente','Perdón, no podré asistir',current_at-interval '5 min');
 res:=public.lv_apply_client_visit_intent(tenant,project,lead_id,req.id,source_id::text,'cancel',to_jsonb(req));
 ASSERT res->>'mensaje' LIKE 'No se preocupe%otro día?','Cancelación cálida y abierta a otra visita';
 ASSERT EXISTS(SELECT 1 FROM public.appointments WHERE id=apt AND status='cancelado'),'Cancelar realmente la cita';
 ASSERT NOT EXISTS(SELECT 1 FROM public.lv_outbox WHERE appointment_id=apt AND status IN ('pending','claimed')),'Cancelación sin avisos pendientes';
 INSERT INTO public.messages(conversation_id,role,content,sent_at) VALUES(conv,'bot',res->>'mensaje',current_at-interval '4 min');
 source_id:=gen_random_uuid();
 INSERT INTO public.messages(id,conversation_id,role,content,sent_at) VALUES(source_id,conv,'cliente','Buenos días, quiero agendar de nuevo',current_at-interval '3 min');
 appointment2:=public.lv_intake_visit_once(lead_id,project,NULL,NULL,NULL,source_id::text,'Buenos días, quiero agendar de nuevo');
 ASSERT appointment2<>apt,'Nueva cita tras cancelación';
 SELECT * INTO req FROM public.appointment_reschedule_requests WHERE appointment_id=appointment2 ORDER BY created_at DESC LIMIT 1;
 ASSERT public.lv_requested_visit_slot(req)->>'confidence'='unknown','No heredar preferencias de una cita cancelada';

 -- La respuesta del cliente a una propuesta enviada confirma por la otra entrada del circuito.
 PERFORM set_config('request.jwt.claim.sub',req.assigned_advisor_id::text,true);
 opts:=public.lv_visit_scheduling_options(req.id);
 start1:=(opts->'slots'->0->>'start_time')::timestamptz;
 req:=public.lv_advisor_propose_request(req.id,start1,start1+interval '1 hour','');
 UPDATE public.lv_outbox SET status='accepted',accepted_at=current_at-interval '2 min'
 WHERE appointment_id=appointment2 AND kind='visit_propose' AND payload->>'request_id'=req.id::text;
 INSERT INTO public.messages(conversation_id,role,content,sent_at) VALUES(conv,'bot','¿Le queda bien este horario?',current_at-interval '2 min');
 source_id:=gen_random_uuid(); message_at:=current_at-interval '1 min';
 INSERT INTO public.messages(id,conversation_id,role,content,sent_at) VALUES(source_id,conv,'cliente','Está bien, gracias',message_at);
 res:=public.lv_apply_client_visit_intent(tenant,project,lead_id,req.id,source_id::text,'accept',to_jsonb(req)||jsonb_build_object('source_sent_at',message_at));
 ASSERT res->>'action'='confirmed','Cliente confirma propuesta enviada';
 ASSERT EXISTS(SELECT 1 FROM public.appointments WHERE id=appointment2 AND confirmed_by_client),'Aceptación del cliente llega al calendario';
 ASSERT (SELECT count(*) FROM public.lv_outbox WHERE appointment_id=appointment2 AND kind='visit_confirm' AND status='pending')=1,'Cliente genera solo una confirmación';
 ASSERT public.lv_visit_preference_parts('Sí, mañana a las 10 am','2026-09-10T14:00:00Z','America/Guayaquil')->>'requested_date'='2026-09-11','Sí afirmativo no impide detectar fecha';
 ASSERT public.lv_visit_preference_parts('lunes y martes a las 3','2026-09-10T14:00:00Z','America/Guayaquil')->>'ambiguous'='true','No elegir entre dos días';
 ASSERT public.lv_visit_preference_parts('hoy a las 3 o mañana a las 4','2026-09-10T14:00:00Z','America/Guayaquil')->>'ambiguous'='true','No elegir entre dos opciones';
 ASSERT public.lv_visit_preference_parts('no puedo a esa hora','2026-09-10T14:00:00Z','America/Guayaquil')->>'clear_time'='true','Rechazar hora no confirma la anterior';

ASSERT (public.lv_visit_preference_parts('a las tres y media',now(),'America/Guayaquil')->>'minute')::integer=30,'No perder la media hora';
 ASSERT (public.lv_visit_preference_parts('a las cuatro y cuarto',now(),'America/Guayaquil')->>'minute')::integer=15,'No perder el cuarto de hora';
 ASSERT public.lv_visit_preference_parts('4',now(),'America/Guayaquil')->'hours'='[4,16]'::jsonb,'Hora aislada tras preguntar la hora';
 ASSERT public.lv_visit_preference_parts('quiero reagendar',now(),'America/Guayaquil')->>'clear_date'='true','Reagendamiento sin alternativa no reutiliza horario anterior';
 ASSERT public.lv_visit_preference_parts('quiero cambiar la hora',now(),'America/Guayaquil')->>'clear_time'='true','Pedir cambiar la hora invalida la anterior';
 ASSERT public.lv_visit_preference_parts('a las tres menos veinte',now(),'America/Guayaquil')->>'ambiguous'='true','Expresión no soportada requiere aclaración, no redondeo';
 UPDATE public.project_automation_config SET visit_latitude=-2.9,visit_longitude=-79.1,visit_location_url='https://example.invalid/stale' WHERE project_id=project;
 ASSERT (SELECT visit_location_url FROM public.project_automation_config WHERE project_id=project)='https://www.google.com/maps/search/?api=1&query=-2.900000%2C-79.100000','Coordenadas y enlace se guardan juntos';
 rejected:=false;
 BEGIN UPDATE public.project_automation_config SET visit_latitude=100 WHERE project_id=project; EXCEPTION WHEN check_violation THEN rejected:=true; END;
 ASSERT rejected,'No guardar coordenadas inválidas';
END $test$;
ROLLBACK;
SELECT 'Circuito completo validado. Lead, citas, mensajes, configuración y colas de prueba revertidos.' AS result;
