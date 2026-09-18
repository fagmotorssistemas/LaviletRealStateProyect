-- Reinicio manual limitado al contacto de prueba autorizado. No se ejecuta al instalar la función.
CREATE OR REPLACE FUNCTION public.lv_reset_lavilet_test_lead()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $fn$
DECLARE
 lid CONSTANT uuid:='52fa6e93-4bd4-42ad-963a-666e9c7902a7';
 l public.leads; token uuid:=gen_random_uuid(); backup_id uuid;
 snapshot jsonb; rows_json jsonb; deleted jsonb:='{}'::jsonb; op record; affected bigint;
BEGIN
 -- Reservar el ejecutor evita borrar una conversación mientras se está enviando su respuesta.
 IF NOT public.lv_app_worker_lock(token,'acquire') THEN
  RAISE EXCEPTION 'El ejecutor está trabajando. Espere unos segundos y vuelva a ejecutar el mismo comando.';
 END IF;
 PERFORM public.lv_lock_project('a1b2c3d4-0001-4000-8000-000000000001','b1b2c3d4-0001-4000-8000-000000000001');
 SELECT * INTO l FROM public.leads WHERE id=lid FOR UPDATE;
 IF NOT FOUND OR l.tenant_id IS DISTINCT FROM 'a1b2c3d4-0001-4000-8000-000000000001'::uuid
 OR l.project_id IS DISTINCT FROM 'b1b2c3d4-0001-4000-8000-000000000001'::uuid
 OR l.kommo_id IS DISTINCT FROM 2710090
 OR regexp_replace(coalesce(l.phone,''),'[^0-9]','','g')<>'593987110032' THEN
  RAISE EXCEPTION 'El contacto no coincide con el lead de prueba autorizado. No se borró nada.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.contracts WHERE lead_id=lid)
 OR EXISTS(SELECT 1 FROM public.reservations WHERE lead_id=lid)
 OR EXISTS(SELECT 1 FROM public.unit_sales_closings WHERE lead_id=lid) THEN
  RAISE EXCEPTION 'Este lead tiene contratos, reservas o ventas. No corresponde un reinicio de conversación de prueba.';
 END IF;
 IF EXISTS(SELECT 1 FROM public.lv_outbox WHERE lead_id=lid AND status IN ('claimed','uncertain'))
 OR EXISTS(SELECT 1 FROM public.lv_integration_events WHERE tenant_id=l.tenant_id AND project_id=l.project_id
  AND payload->>'kommoId'=l.kommo_id::text AND status='processing') THEN
  RAISE EXCEPTION 'Hay una operación de este lead en curso o sin resolver. No se reinició la conversación.';
 END IF;

 snapshot:=jsonb_build_object('reason','Reinicio manual de conversación de prueba','lead',to_jsonb(l),
  'conversations',(SELECT coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) FROM public.conversations c WHERE c.lead_id=lid),
  'appointments',(SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]'::jsonb) FROM public.appointments a WHERE a.lead_id=lid),
  'integration_events',(SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) FROM public.lv_integration_events e
   WHERE e.tenant_id=l.tenant_id AND e.project_id=l.project_id AND e.kind='inbound' AND e.payload->>'kommoId'=l.kommo_id::text));
 FOR op IN SELECT * FROM (VALUES
   ('lv_outbox','lead_id = $1'),
   ('lv_cycles','lead_id = $1'),
   ('lead_financing','lead_id = $1'),
   ('financing_prequalifications','lead_id = $1'),
   ('asesoria_financiamiento','lead_id = $1'),
   ('datos_solicitados_clientes','lead_id = $1'),
   ('lead_nutrition','lead_id = $1'),
   ('lead_recovery','lead_id = $1'),
   ('nutrition_delivery_history','lead_id = $1'),
   ('lead_interactions','lead_id = $1'),
   ('lead_score_events','lead_id = $1'),
   ('lead_temperature_history','lead_id = $1'),
   ('lead_stage_history','lead_id = $1'),
   ('lead_units','lead_id = $1'),
   ('lv_decay_applied','lead_id = $1'),
   ('lv_test_clock','lead_id = $1'),
   ('messages','conversation_id IN (SELECT id FROM public.conversations WHERE lead_id = $1)'),
   ('units_shown','conversation_id IN (SELECT id FROM public.conversations WHERE lead_id = $1)'),
   ('bot_escalations','conversation_id IN (SELECT id FROM public.conversations WHERE lead_id = $1)'),
   ('unanswered_questions','conversation_id IN (SELECT id FROM public.conversations WHERE lead_id = $1)'),
   ('lv_appointment_bot_assignment_history','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('lv_appointment_bot_assignments','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('appointment_time_holds','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('lv_appointment_assignment_events','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('appointment_change_log','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('appointment_units','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('lv_visit_state','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('lv_visit_policy','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('lavilet_appointment_reminders','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('appointment_reschedule_requests','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)')
 ) AS allowed(table_name,filter_sql) LOOP
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(t)),''[]''::jsonb) FROM public.%I t WHERE %s',op.table_name,op.filter_sql)
   INTO rows_json USING lid;
  snapshot:=snapshot||jsonb_build_object(op.table_name,rows_json);
 END LOOP;
 INSERT INTO public.lv_manual_test_reset_backups(lead_id,snapshot) VALUES(lid,snapshot) RETURNING id INTO backup_id;

 -- Mantener solo identificadores de deduplicación: un webhook antiguo no debe iniciar otra conversación.
 UPDATE public.lv_integration_events SET status='cancelled',claim_token=NULL,
  payload=jsonb_strip_nulls(jsonb_build_object('externalId',payload->'externalId','kommoId',payload->'kommoId',
    'contactId',payload->'contactId','sentAt',payload->'sentAt')),
  result=jsonb_build_object('reason','manual_test_lead_reset','backup_id',backup_id)
 WHERE tenant_id=l.tenant_id AND project_id=l.project_id AND kind='inbound' AND payload->>'kommoId'=l.kommo_id::text;
 GET DIAGNOSTICS affected=ROW_COUNT;
 deleted:=deleted||jsonb_build_object('events_cancelled_and_scrubbed',affected);

 FOR op IN SELECT * FROM (VALUES
   ('lv_outbox','lead_id = $1'),
   ('lv_cycles','lead_id = $1'),
   ('lead_financing','lead_id = $1'),
   ('financing_prequalifications','lead_id = $1'),
   ('asesoria_financiamiento','lead_id = $1'),
   ('datos_solicitados_clientes','lead_id = $1'),
   ('lead_nutrition','lead_id = $1'),
   ('lead_recovery','lead_id = $1'),
   ('nutrition_delivery_history','lead_id = $1'),
   ('lead_interactions','lead_id = $1'),
   ('lead_score_events','lead_id = $1'),
   ('lead_temperature_history','lead_id = $1'),
   ('lead_stage_history','lead_id = $1'),
   ('lead_units','lead_id = $1'),
   ('lv_decay_applied','lead_id = $1'),
   ('lv_test_clock','lead_id = $1'),
   ('messages','conversation_id IN (SELECT id FROM public.conversations WHERE lead_id = $1)'),
   ('units_shown','conversation_id IN (SELECT id FROM public.conversations WHERE lead_id = $1)'),
   ('bot_escalations','conversation_id IN (SELECT id FROM public.conversations WHERE lead_id = $1)'),
   ('unanswered_questions','conversation_id IN (SELECT id FROM public.conversations WHERE lead_id = $1)'),
   ('lv_appointment_bot_assignment_history','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('lv_appointment_bot_assignments','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('appointment_time_holds','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('lv_appointment_assignment_events','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('appointment_change_log','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('appointment_units','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('lv_visit_state','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('lv_visit_policy','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('lavilet_appointment_reminders','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)'),
   ('appointment_reschedule_requests','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id = $1)')
 ) AS allowed(table_name,filter_sql) LOOP
  EXECUTE format('DELETE FROM public.%I WHERE %s',op.table_name,op.filter_sql) USING lid;
  GET DIAGNOSTICS affected=ROW_COUNT;
  deleted:=deleted||jsonb_build_object(op.table_name,affected);
 END LOOP;
 DELETE FROM public.appointments WHERE lead_id=lid AND tenant_id=l.tenant_id AND project_id=l.project_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 deleted:=deleted||jsonb_build_object('appointments',affected);
 DELETE FROM public.conversations WHERE lead_id=lid AND tenant_id=l.tenant_id AND project_id=l.project_id;
 GET DIAGNOSTICS affected=ROW_COUNT;
 deleted:=deleted||jsonb_build_object('conversations',affected);

 UPDATE public.leads SET status='nuevo',budget=NULL,financing=false,assigned_to=NULL,resume=NULL,
  budget_min=NULL,budget_max=NULL,preferred_bedrooms=NULL,preferred_category=NULL,purchase_purpose=NULL,financing_type=NULL,
  temperature='frio',temperature_score=0,temperature_updated_at=NULL,bot_enabled=true,last_bot_message_at=NULL,
  behavior_signals='{}'::jsonb,day_detected=NULL,hour_detected=NULL,time_reference=NULL,quiere_llamada=false,
  respondio_post_fotos=false,fotos_enviadas_at=NULL,presupuesto_cliente=NULL,mensajes_enviados=ARRAY[]::text[],
  stage='lanzamiento',stage_updated_at=now(),stage_reason=NULL,last_interaction_at=NULL,
  tracking_consent=false,tracking_consent_at=NULL,tracking_opt_out_at=NULL,tracking_opt_out_reason=NULL,
  handoff_status='none',handoff_reason=NULL,handoff_requested_at=NULL,handoff_assigned_at=NULL,
  seller_response_due_at=NULL,seller_first_response_at=NULL,admin_escalated_at=NULL,updated_at=now()
 WHERE id=lid AND tenant_id=l.tenant_id AND project_id=l.project_id;
 PERFORM public.lv_app_worker_lock(token,'release');
 RETURN jsonb_build_object('status','reset','lead_id',lid,'phone',l.phone,'backup_id',backup_id,'deleted',deleted,'bot_enabled',true);
END $fn$;
-- Solo SQL Editor/administración de base de datos; no exponer un reinicio destructivo por la API.
REVOKE ALL ON FUNCTION public.lv_reset_lavilet_test_lead() FROM PUBLIC,anon,authenticated,service_role;
COMMENT ON FUNCTION public.lv_reset_lavilet_test_lead() IS 'Reinicia exclusivamente +593987110032 (Kommo 2710090) en La Vilet. Conserva identidad, respalda datos y no envía mensajes.';

