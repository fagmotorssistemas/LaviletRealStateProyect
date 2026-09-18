DROP TRIGGER IF EXISTS sync_confirmed_appointment_lead ON public.appointments;
DROP FUNCTION IF EXISTS public.lv_sync_confirmed_appointment_lead();

DELETE FROM public.lead_score_events
WHERE event_type = 'appointment_confirmed';

DELETE FROM public.lead_scoring_rules
WHERE event_type = 'appointment_confirmed';

WITH scores AS (
  SELECT l.id,
         greatest(0, coalesce(sum(e.points), 0))::integer AS score,
         coalesce(c.temperature_warm_min, 25) AS warm_min,
         coalesce(c.temperature_hot_min, 60) AS hot_min
  FROM public.leads l
  LEFT JOIN public.lead_score_events e ON e.lead_id = l.id
  LEFT JOIN public.project_automation_config c ON c.project_id = l.project_id
  GROUP BY l.id, c.temperature_warm_min, c.temperature_hot_min
)
UPDATE public.leads l
SET temperature_score = s.score,
    temperature = CASE
      WHEN s.score >= s.hot_min THEN 'caliente'
      WHEN s.score >= s.warm_min THEN 'tibio'
      ELSE 'frio'
    END,
    temperature_updated_at = now(),
    updated_at = now()
FROM scores s
WHERE s.id = l.id;

-- No se revierten automáticamente assigned_to, status ni handoff_status:
-- después de operar con la regla no es seguro inferir los valores anteriores.
