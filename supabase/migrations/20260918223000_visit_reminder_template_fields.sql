BEGIN;

-- Recordatorio autorizado dos horas antes. El Salesbot lee tres campos de la
-- oportunidad; la aplicación los actualiza conjuntamente antes de iniciarlo.
UPDATE public.lv_routes
SET bot_id = 22246,
    detail_field_id = 531120,
    body_template = E'Hola, [Saludo La Vilet]. Es un gusto saludarle. Le recordamos que tiene una cita agendada en La Vilet [Detalle de cita La Vilet].\n\nLe compartimos nuestra ubicación para facilitar su llegada: [Ubicación La Vilet]\n\nSi tiene alguna consulta o necesita cambiar el horario, escríbanos por aquí. ¡Le esperamos!',
    approved = true
WHERE project_id = 'b1b2c3d4-0001-4000-8000-000000000001'
  AND kind = 'visit_2h';

DO $do$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.lv_routes
    WHERE project_id = 'b1b2c3d4-0001-4000-8000-000000000001'
      AND kind = 'visit_2h' AND bot_id = 22246 AND detail_field_id = 531120
      AND enabled IS TRUE AND approved IS TRUE
  ) THEN
    RAISE EXCEPTION 'No se pudo configurar la ruta visit_2h para Salesbot 22246';
  END IF;
END $do$;

COMMIT;
