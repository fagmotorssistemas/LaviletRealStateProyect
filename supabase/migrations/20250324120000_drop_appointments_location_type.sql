-- Elimina `location_type` de citas (sustituido por proyecto/oficina vía `project_id` / `office_id` si aplica).
ALTER TABLE public.appointments
  DROP COLUMN IF EXISTS location_type;
