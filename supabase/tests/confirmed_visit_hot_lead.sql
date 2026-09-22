-- Ejecutar después de 20260918233000_confirmed_visit_hot_lead.sql.
-- Todas las filas de prueba se revierten.
BEGIN;
SET LOCAL statement_timeout = '20s';

DO $test$
DECLARE
  v_tenant uuid := 'a1b2c3d4-0001-4000-8000-000000000001';
  v_project uuid := 'b1b2c3d4-0001-4000-8000-000000000001';
  v_lead uuid := gen_random_uuid();
  v_cold_lead uuid := gen_random_uuid();
  v_appointment uuid := gen_random_uuid();
  v_cold_appointment uuid := gen_random_uuid();
  v_advisor uuid;
  v_hot integer;
  v_before integer;
BEGIN
  SELECT ps.salesperson_id
  INTO v_advisor
  FROM public.project_salespeople ps
  JOIN public.profiles p ON p.id = ps.salesperson_id
  WHERE ps.tenant_id = v_tenant
    AND ps.project_id = v_project
    AND ps.receives_leads = true
    AND p.is_active = true
  ORDER BY ps.rotation_order, ps.id
  LIMIT 1;

  ASSERT v_advisor IS NOT NULL, 'La prueba necesita un asesor activo';

  SELECT temperature_hot_min
  INTO v_hot
  FROM public.project_automation_config
  WHERE project_id = v_project;

  ASSERT v_hot = 60, 'La prueba contractual espera el corte caliente actual de 60 puntos';

  INSERT INTO public.leads(id, tenant_id, project_id, name, channel_origin, bot_enabled)
  VALUES (v_lead, v_tenant, v_project, 'PRUEBA CITA CALIENTE NO PUBLICAR', 'whatsapp', true);

  PERFORM public.apply_lead_events(
    v_lead,
    '["first_response", "requested_visit"]'::jsonb,
    'test:visit-request'
  );

  SELECT temperature_score INTO v_before FROM public.leads WHERE id = v_lead;
  ASSERT v_before = 45, 'La solicitud debe quedar inicialmente en 45 puntos';

  INSERT INTO public.appointments(
    id, tenant_id, project_id, lead_id, responsible_id, title, status,
    start_time, end_time, confirmed_by_client
  ) VALUES (
    v_appointment, v_tenant, v_project, v_lead, v_advisor,
    'PRUEBA CITA CALIENTE NO PUBLICAR', 'solicitada',
    now() + interval '3 days', now() + interval '3 days 1 hour', false
  );

  ASSERT (SELECT temperature_score FROM public.leads WHERE id = v_lead) = 45,
    'Una solicitud sin confirmar no debe sumar appointment_confirmed';

  UPDATE public.appointments
  SET status = 'aceptado', confirmed_by_client = true
  WHERE id = v_appointment;

  ASSERT (SELECT temperature FROM public.leads WHERE id = v_lead) = 'caliente',
    'La cita confirmada debe convertir el lead en caliente';
  ASSERT (SELECT temperature_score FROM public.leads WHERE id = v_lead) = 65,
    'La confirmación debe sumar 20 puntos una sola vez';
  ASSERT (SELECT assigned_to FROM public.leads WHERE id = v_lead) = v_advisor,
    'El lead debe conservar al asesor responsable de la cita';
  ASSERT (SELECT status FROM public.leads WHERE id = v_lead) = 'agendado',
    'El estado operativo debe quedar agendado';
  ASSERT (SELECT handoff_status FROM public.leads WHERE id = v_lead) = 'assigned',
    'El traspaso debe quedar asignado';
  ASSERT (SELECT bot_enabled FROM public.leads WHERE id = v_lead) = true,
    'La confirmación no debe apagar el bot';
  ASSERT (SELECT count(*) FROM public.lead_score_events WHERE lead_id = v_lead AND event_type = 'appointment_confirmed') = 1,
    'Debe existir un solo evento de confirmación';

  UPDATE public.appointments
  SET responsible_id = v_advisor
  WHERE id = v_appointment;

  ASSERT (SELECT temperature_score FROM public.leads WHERE id = v_lead) = 65,
    'Guardar o reasignar la misma cita no debe duplicar puntos';
  ASSERT (SELECT count(*) FROM public.lead_score_events WHERE lead_id = v_lead AND event_type = 'appointment_confirmed') = 1,
    'La idempotencia debe mantenerse después de otra actualización';

  -- La cita confirmada debe ser suficiente por sí sola para llegar a Caliente,
  -- incluso si el lead no tenía eventos de puntaje anteriores.
  INSERT INTO public.leads(id, tenant_id, project_id, name, channel_origin, bot_enabled)
  VALUES (v_cold_lead, v_tenant, v_project, 'PRUEBA CITA DIRECTA CALIENTE NO PUBLICAR', 'whatsapp', true);

  INSERT INTO public.appointments(
    id, tenant_id, project_id, lead_id, responsible_id, title, status,
    start_time, end_time, confirmed_by_client
  ) VALUES (
    v_cold_appointment, v_tenant, v_project, v_cold_lead, v_advisor,
    'PRUEBA CITA DIRECTA CALIENTE NO PUBLICAR', 'aceptado',
    now() + interval '4 days', now() + interval '4 days 1 hour', true
  );

  ASSERT (SELECT temperature FROM public.leads WHERE id = v_cold_lead) = 'caliente',
    'Toda cita confirmada debe convertir el lead en caliente';
  ASSERT (SELECT temperature_score FROM public.leads WHERE id = v_cold_lead) = v_hot,
    'Sin puntaje previo, la confirmación debe completar exactamente el umbral caliente';
  ASSERT (SELECT assigned_to FROM public.leads WHERE id = v_cold_lead) = v_advisor,
    'La cita directa también debe conservar a su asesor responsable';
END;
$test$;

ROLLBACK;
SELECT 'Cita confirmada: temperatura y asesor validados' AS result;

