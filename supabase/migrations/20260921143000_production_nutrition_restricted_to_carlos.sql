-- Activa los seguimientos aprobados de los dias 7, 14 y 21 para conversaciones
-- nuevas y deja preparado el paso de 24 h. Ese paso permanece apagado hasta
-- que su plantilla WABA sea aprobada y vinculada al Salesbot 20968.
-- La automatizacion conserva un alcance restringido al lead de Carlos; los
-- demas leads permanecen con la IA apagada.
--
-- nutrition_steps y lead_nutrition son estructuras historicas. Esta migracion
-- no las modifica: el ejecutor actual usa projects.policies_json y
-- lv_integration_events.
BEGIN;

DO $migration$
DECLARE
  v_carlos_id uuid;
  v_activated_at timestamptz := clock_timestamp();
  v_policies jsonb;
BEGIN
  SELECT l.id
  INTO v_carlos_id
  FROM public.leads l
  WHERE l.tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001'::uuid
    AND l.project_id = 'b1b2c3d4-0001-4000-8000-000000000001'::uuid
    AND right(regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g'), 9) = '987110032'
  ORDER BY l.updated_at DESC NULLS LAST
  LIMIT 1;

  IF v_carlos_id IS NULL THEN
    RAISE EXCEPTION 'No se encontro el lead autorizado 0987110032 en La Vilet';
  END IF;

  -- Los nombres test_only/test_lead_id son heredados, pero actualmente forman
  -- la compuerta autoritativa en SQL y servidor. Mantenerlos evita abrir la IA
  -- accidentalmente a otros leads mientras se usa la configuracion productiva.
  UPDATE public.lv_auto_config
  SET enabled = true,
      dry_run = false,
      test_only = true,
      test_lead_id = v_carlos_id
  WHERE tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001'::uuid
    AND project_id = 'b1b2c3d4-0001-4000-8000-000000000001'::uuid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Falta lv_auto_config para el proyecto La Vilet';
  END IF;

  UPDATE public.leads
  SET bot_enabled = (id = v_carlos_id),
      updated_at = clock_timestamp()
  WHERE tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001'::uuid
    AND project_id = 'b1b2c3d4-0001-4000-8000-000000000001'::uuid
    AND bot_enabled IS DISTINCT FROM (id = v_carlos_id);

  SELECT coalesce(p.policies_json, '{}'::jsonb)
  INTO v_policies
  FROM public.projects p
  WHERE p.id = 'b1b2c3d4-0001-4000-8000-000000000001'::uuid
    AND p.tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001'::uuid
  FOR UPDATE;

  IF v_policies IS NULL THEN
    RAISE EXCEPTION 'No se encontro el proyecto La Vilet';
  END IF;

  v_policies := jsonb_set(
    v_policies,
    '{nutrition_24h}',
    coalesce(v_policies->'nutrition_24h', '{}'::jsonb) || jsonb_build_object(
      'enabled', false,
      'metaApproved', false,
      'templateLinked', false,
      'templateName', 'NUTRICION_MENSAJE_24H',
      'botId', 20968,
      'fieldId', 530422,
      'activatedAt', v_activated_at
    ),
    true
  );

  v_policies := jsonb_set(
    v_policies,
    '{nutrition_week_one}',
    jsonb_build_object(
      'brochureEnabled', true,
      'alreadyShared', 'relevant',
      'unitDetails', true,
      'comparison', true,
      'financing', true,
      'visits', false
    ) || coalesce(v_policies->'nutrition_week_one', '{}'::jsonb) || jsonb_build_object(
      'enabled', true,
      'activatedAt', CASE
        WHEN (v_policies#>>'{nutrition_week_one,enabled}')::boolean IS TRUE
          AND (v_policies#>>'{nutrition_week_one,activatedAt}') IS NOT NULL
        THEN v_policies#>>'{nutrition_week_one,activatedAt}'
        ELSE v_activated_at::text
      END
    ),
    true
  );

  v_policies := jsonb_set(
    v_policies,
    '{nutrition_later}',
    coalesce(v_policies->'nutrition_later', '{}'::jsonb) || jsonb_build_object(
      '2', coalesce(v_policies#>'{nutrition_later,2}', '{}'::jsonb)
        || jsonb_build_object(
          'enabled', true,
          'activatedAt', CASE
            WHEN (v_policies#>>'{nutrition_later,2,enabled}')::boolean IS TRUE
              AND (v_policies#>>'{nutrition_later,2,activatedAt}') IS NOT NULL
            THEN v_policies#>>'{nutrition_later,2,activatedAt}'
            ELSE v_activated_at::text
          END
        ),
      '3', coalesce(v_policies#>'{nutrition_later,3}', '{}'::jsonb)
        || jsonb_build_object(
          'enabled', true,
          'activatedAt', CASE
            WHEN (v_policies#>>'{nutrition_later,3,enabled}')::boolean IS TRUE
              AND (v_policies#>>'{nutrition_later,3,activatedAt}') IS NOT NULL
            THEN v_policies#>>'{nutrition_later,3,activatedAt}'
            ELSE v_activated_at::text
          END
        )
    ),
    true
  );

  UPDATE public.projects
  SET policies_json = v_policies,
      updated_at = clock_timestamp()
  WHERE id = 'b1b2c3d4-0001-4000-8000-000000000001'::uuid
    AND tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001'::uuid;
END;
$migration$;

-- El detalle del lead solo necesita los trabajos de nutricion. Esta politica
-- no expone mensajes entrantes ni otras tareas internas: un administrador ve
-- todos los leads y un asesor unicamente los que tiene asignados.
DROP POLICY IF EXISTS "CRM read current nutrition jobs" ON public.lv_integration_events;
CREATE POLICY "CRM read current nutrition jobs"
  ON public.lv_integration_events
  FOR SELECT
  TO authenticated
  USING (
    kind = 'maintenance'
    AND payload->>'task' IN (
      'nutrition_24h',
      'nutrition_week_one',
      'nutrition_week_two',
      'nutrition_week_three'
    )
    AND EXISTS (
      SELECT 1
      FROM public.leads l
      WHERE l.id::text = lv_integration_events.payload->>'leadId'
        AND l.tenant_id = lv_integration_events.tenant_id
        AND l.project_id = lv_integration_events.project_id
        AND (public.is_admin() OR l.assigned_to = auth.uid())
    )
  );

COMMIT;
