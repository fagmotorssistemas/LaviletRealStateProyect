-- El responsable del proyecto autorizó usar este contexto positivo del sector
-- en respuestas comerciales. Solo afecta la tabla nueva project_area_facts.
UPDATE public.project_area_facts
SET review_status = 'verified',
    approved_for_bot = true,
    verified_on = DATE '2026-09-19',
    updated_at = now()
WHERE tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001'::uuid
  AND project_id = 'b1b2c3d4-0001-4000-8000-000000000001'::uuid
  AND fact_key IN (
    'puertas_del_sol_posicionamiento',
    'puertas_del_sol_plazas_comerciales',
    'puertas_del_sol_servicios_cercanos',
    'puertas_del_sol_entorno_tomebamba',
    'puertas_del_sol_oferta_deportiva',
    'puertas_del_sol_conectividad',
    'puertas_del_sol_desarrollo_inmobiliario',
    'puertas_del_sol_potencial_valorizacion'
  );
