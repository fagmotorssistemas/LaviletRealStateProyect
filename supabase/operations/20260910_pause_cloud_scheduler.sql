-- Reversión operativa: pausa solo este disparador. Conserva eventos, datos, funciones y secreto.
-- No activar simultáneamente otro disparador sin revisar la petición/worker en curso.
DO $$
DECLARE job bigint;
BEGIN
  SELECT jobid INTO STRICT job FROM cron.job WHERE jobname='lavilet-automation-minute';
  PERFORM cron.alter_job(job,active:=false);
END $$;
