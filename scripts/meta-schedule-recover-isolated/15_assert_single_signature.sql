-- Nest/PostgREST: una sola firma (p_limit, p_lookback_days); llamada solo p_limit.
\set ON_ERROR_STOP on

DO $$
DECLARE
  n integer;
  sigs text;
BEGIN
  SELECT string_agg(pg_get_function_identity_arguments(p.oid), ' | ' ORDER BY p.oid)
  INTO sigs
  FROM pg_proc p
  JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
  WHERE nsp.nspname = 'public'
    AND p.proname = 'lv_recover_missing_meta_schedule_outbox';

  IF sigs IS DISTINCT FROM 'p_limit integer, p_lookback_days integer' THEN
    RAISE EXCEPTION 'expected single signature (p_limit, p_lookback_days), got: %', sigs;
  END IF;

  -- Equivalente al body Nest {"p_limit":50}: un solo argumento nombrado/posicional.
  n := public.lv_recover_missing_meta_schedule_outbox(50);
  IF n IS NULL THEN
    RAISE EXCEPTION 'call with only p_limit failed';
  END IF;

  RAISE NOTICE 'meta_schedule_single_signature_ok n=%', n;
END $$;
