-- Pruebas de permisos, duración, caducidad, reparto y escalamiento.
-- Pensadas para un entorno aislado. No ejecutar en producción.
-- Requieren las migraciones 180000 y 210000 aplicadas.

-- Duración exacta 60 minutos
DO $$
BEGIN
  IF NOT (
    public.lv_format_visit_clock(timestamptz '2026-09-08 18:00:00+00') = 'a la 1 p. m.'
    AND public.lv_format_visit_clock(timestamptz '2026-09-08 19:00:00+00') = 'a las 2 p. m.'
    AND public.lv_format_visit_when(timestamptz '2026-09-08 18:00:00+00')
        = 'el martes 8 de septiembre a la 1 p. m.'
  ) THEN
    RAISE EXCEPTION 'formato de reloj incorrecto';
  END IF;
END $$;

-- Jornada La Vilet: último inicio lun-vie 17:30, sábado 12:30
DO $$
BEGIN
  IF public.lv_interval_within_business_hours(
       'b1b2c3d4-0001-4000-8000-000000000001',
       timestamptz '2026-09-07 22:30:00+00', -- 17:30 GYE lunes
       timestamptz '2026-09-07 23:30:00+00'
     ) IS NOT TRUE THEN
    RAISE EXCEPTION '17:30-18:30 lunes debería ser válido';
  END IF;
  IF public.lv_interval_within_business_hours(
       'b1b2c3d4-0001-4000-8000-000000000001',
       timestamptz '2026-09-07 23:00:00+00', -- 18:00 inicio
       timestamptz '2026-09-08 00:00:00+00'
     ) IS NOT FALSE THEN
    RAISE EXCEPTION '18:00 lunes no debe caber';
  END IF;
END $$;

-- Escalamiento no incluye awaiting_client (inspección del cuerpo)
DO $$
BEGIN
  IF position('awaiting_client' in pg_get_functiondef('public.lv_escalate_overdue_requests()'::regprocedure)) > 0
     AND position('status = ''awaiting_advisor''' in pg_get_functiondef('public.lv_escalate_overdue_requests()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'lv_escalate_overdue_requests no debe escalar awaiting_client';
  END IF;
END $$;

-- EXECUTE: confirm interno no es de authenticated
DO $$
DECLARE
  acl text;
BEGIN
  SELECT p.proacl::text INTO acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'lv_confirm_visit_from_request';
  IF acl ILIKE '%authenticated=X%' THEN
    RAISE EXCEPTION 'lv_confirm_visit_from_request no debe EXECUTE a authenticated';
  END IF;
  SELECT p.proacl::text INTO acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'lv_client_accept_request';
  IF acl ILIKE '%authenticated=X%' OR acl ILIKE '%anon=X%' THEN
    RAISE EXCEPTION 'lv_client_accept_request no debe EXECUTE a authenticated/anon';
  END IF;
END $$;
