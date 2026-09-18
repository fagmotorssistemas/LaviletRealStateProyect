-- URL de ubicación de referencia del proyecto (Maps del edificio).

ALTER TABLE public.financing_config
  ADD COLUMN IF NOT EXISTS reference_location_url text;

UPDATE public.financing_config
SET
  reference_location_url = COALESCE(
    NULLIF(trim(reference_location_url), ''),
    'https://maps.app.goo.gl/3N5YR6QY4vxiHQue6'
  ),
  reference_latitude = COALESCE(reference_latitude, -2.8923876),
  reference_longitude = COALESCE(reference_longitude, -79.0301792)
WHERE project_id IS NOT NULL;

COMMENT ON COLUMN public.financing_config.reference_location_url IS
  'Enlace Google Maps del edificio; lat/lng se derivan o confirman desde este punto de referencia.';
