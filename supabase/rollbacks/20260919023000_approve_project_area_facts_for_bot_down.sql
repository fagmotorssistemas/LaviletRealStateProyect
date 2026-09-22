UPDATE public.project_area_facts
SET review_status = 'draft',
    approved_for_bot = false,
    verified_on = NULL,
    updated_at = now()
WHERE tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001'::uuid
  AND project_id = 'b1b2c3d4-0001-4000-8000-000000000001'::uuid
  AND fact_key LIKE 'puertas_del_sol_%';
