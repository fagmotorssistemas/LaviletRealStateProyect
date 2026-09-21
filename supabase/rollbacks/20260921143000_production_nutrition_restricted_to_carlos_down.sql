-- Desactiva los cuatro pasos nuevos. Conserva la restriccion a Carlos para que
-- un rollback de nutricion nunca habilite la IA para los demas leads.
BEGIN;

DROP POLICY IF EXISTS "CRM read current nutrition jobs" ON public.lv_integration_events;

UPDATE public.projects
SET policies_json = jsonb_set(
  jsonb_set(
    jsonb_set(
      coalesce(policies_json, '{}'::jsonb),
      '{nutrition_24h}',
      coalesce(policies_json->'nutrition_24h', '{}'::jsonb)
        || jsonb_build_object('enabled', false, 'activatedAt', null),
      true
    ),
    '{nutrition_week_one}',
    coalesce(policies_json->'nutrition_week_one', '{}'::jsonb)
      || jsonb_build_object('enabled', false, 'activatedAt', null),
    true
  ),
  '{nutrition_later}',
  coalesce(policies_json->'nutrition_later', '{}'::jsonb) || jsonb_build_object(
    '2', coalesce(policies_json#>'{nutrition_later,2}', '{}'::jsonb)
      || jsonb_build_object('enabled', false, 'activatedAt', null),
    '3', coalesce(policies_json#>'{nutrition_later,3}', '{}'::jsonb)
      || jsonb_build_object('enabled', false, 'activatedAt', null)
  ),
  true
), updated_at = clock_timestamp()
WHERE id = 'b1b2c3d4-0001-4000-8000-000000000001'::uuid
  AND tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001'::uuid;

COMMIT;
