-- Ejecutar después de 20260919003000_handoff_keeps_bot_active.sql.
BEGIN;

DO $test$
DECLARE
  v_lead uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.leads(id, tenant_id, project_id, name, channel_origin, bot_enabled)
  VALUES (
    v_lead,
    'a1b2c3d4-0001-4000-8000-000000000001',
    'b1b2c3d4-0001-4000-8000-000000000001',
    'PRUEBA TRASPASO SIN PAUSA NO PUBLICAR',
    'whatsapp',
    true
  );

  UPDATE public.leads
  SET bot_enabled = false,
      handoff_status = 'queued',
      handoff_reason = 'prueba de asignación',
      handoff_requested_at = now()
  WHERE id = v_lead;

  ASSERT (SELECT bot_enabled FROM public.leads WHERE id = v_lead) = true,
    'El traspaso automático no debe detener el bot';

  UPDATE public.leads SET bot_enabled = false WHERE id = v_lead;
  ASSERT (SELECT bot_enabled FROM public.leads WHERE id = v_lead) = false,
    'DETENER IA independiente debe seguir funcionando';

  UPDATE public.leads SET bot_enabled = true WHERE id = v_lead;
  UPDATE public.leads
  SET bot_enabled = false,
      tracking_opt_out_at = now(),
      tracking_opt_out_reason = 'prueba de opt-out'
  WHERE id = v_lead;

  ASSERT (SELECT bot_enabled FROM public.leads WHERE id = v_lead) = false,
    'El opt-out debe poder detener el bot';
END;
$test$;

ROLLBACK;
SELECT 'Traspaso, DETENER IA y opt-out validados' AS result;
