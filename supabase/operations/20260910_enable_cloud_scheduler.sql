-- Ya aplicado. Reactivación idempotente después de verificar una llamada desde Supabase.
DO $$
DECLARE job bigint;
BEGIN
  SELECT jobid INTO STRICT job FROM cron.job WHERE jobname='lavilet-automation-minute';
  IF NOT EXISTS (
    SELECT 1 FROM lv_automation_private.scheduler_runs
    WHERE status='completed' AND http_status=200 AND worker_mode='live' AND reason IS NULL
      AND completed_at>now()-interval '10 minutes'
  ) THEN
    RAISE EXCEPTION 'Verify cloud worker before activation';
  END IF;
  PERFORM cron.alter_job(job,active:=true);
END $$;
