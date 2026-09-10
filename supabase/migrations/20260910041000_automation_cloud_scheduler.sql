-- Disparador de La Vilet en Supabase. Se crea DESACTIVADO para configurar y verificar antes del cambio.
CREATE SCHEMA lv_automation_private AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA lv_automation_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE lv_automation_private.scheduler_runs (
  request_id bigint PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','completed','error','timeout')),
  http_status integer,
  worker_mode text,
  processed integer,
  uncertain_count integer NOT NULL DEFAULT 0,
  reason text
);
CREATE INDEX scheduler_runs_pending ON lv_automation_private.scheduler_runs(requested_at) WHERE status='queued';
ALTER TABLE lv_automation_private.scheduler_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE lv_automation_private.scheduler_runs FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION lv_automation_private.collect_results()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE r record; body jsonb; total integer; uncertain integer; outcome text; code text;
BEGIN
  FOR r IN
    SELECT s.request_id, n.status_code, n.timed_out, n.error_msg, n.content, n.created
    FROM lv_automation_private.scheduler_runs s
    JOIN net._http_response n ON n.id=s.request_id
    WHERE s.status='queued'
  LOOP
    body := NULL; total := NULL; uncertain := 0;
    BEGIN body := r.content::jsonb; EXCEPTION WHEN invalid_text_representation THEN body := NULL; END;
    IF (body->>'processed') ~ '^[0-9]{1,6}$' THEN total := (body->>'processed')::integer; END IF;
    IF jsonb_typeof(body->'results')='array' THEN
      SELECT count(*)::integer INTO uncertain FROM jsonb_array_elements(body->'results') e WHERE e->>'status'='uncertain';
    END IF;
    outcome := 'error'; code := 'INVALID_WORKER_RESPONSE';
    IF r.timed_out IS TRUE THEN outcome := 'timeout'; code := 'HTTP_TIMEOUT';
    ELSIF r.error_msg IS NOT NULL THEN code := 'HTTP_TRANSPORT_ERROR';
    ELSIF r.status_code IS DISTINCT FROM 200 THEN code := 'HTTP_' || coalesce(r.status_code::text,'UNKNOWN');
    ELSIF body->>'mode' IS DISTINCT FROM 'live' THEN code := 'WORKER_NOT_LIVE';
    ELSIF total IS NOT NULL THEN
      IF uncertain>0 THEN code := 'WORKER_UNCERTAIN_RESULTS';
      ELSE outcome := 'completed'; code := NULL;
      END IF;
      IF body->>'reason' ~ '^[a-zA-Z0-9_]{1,80}$' THEN code := body->>'reason'; END IF;
    END IF;
    UPDATE lv_automation_private.scheduler_runs
    SET completed_at=r.created,status=outcome,http_status=r.status_code,
        worker_mode=CASE WHEN body->>'mode' IN ('live','off','preview') THEN body->>'mode' ELSE NULL END,
        processed=total,uncertain_count=uncertain,reason=code
    WHERE request_id=r.request_id AND status='queued';
  END LOOP;
  -- pg_net usa 240 segundos; después de cinco minutos ya no damos la petición por saludable.
  UPDATE lv_automation_private.scheduler_runs SET status='timeout',completed_at=clock_timestamp(),reason='HTTP_RESULT_MISSING'
  WHERE status='queued' AND requested_at < clock_timestamp()-interval '5 minutes';
END;
$fn$;
REVOKE ALL ON FUNCTION lv_automation_private.collect_results() FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION lv_automation_private.tick()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE secret_value text; request bigint; last_run lv_automation_private.scheduler_runs;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtextextended('lavilet-cloud-scheduler',0)) THEN
    RETURN jsonb_build_object('action','scheduler_busy');
  END IF;
  PERFORM lv_automation_private.collect_results();
  IF EXISTS(SELECT 1 FROM lv_automation_private.scheduler_runs WHERE status='queued') THEN
    RETURN jsonb_build_object('action','request_in_flight');
  END IF;
  SELECT * INTO last_run FROM lv_automation_private.scheduler_runs ORDER BY requested_at DESC LIMIT 1;
  -- Errores HTTP/configuración: espaciar reintentos del ejecutor, no repetir envíos a clientes.
  IF last_run.status IN ('error','timeout') AND last_run.reason IS DISTINCT FROM 'WORKER_UNCERTAIN_RESULTS'
     AND last_run.completed_at > clock_timestamp()-interval '5 minutes' THEN
    RETURN jsonb_build_object('action','retry_backoff');
  END IF;
  -- Un POST manual y el cron en el mismo minuto tampoco disparan dos peticiones.
  IF last_run.requested_at > clock_timestamp()-interval '55 seconds' THEN
    RETURN jsonb_build_object('action','recent_request');
  END IF;
  SELECT decrypted_secret INTO secret_value FROM vault.decrypted_secrets WHERE name='lavilet_automation_cron_secret';
  IF secret_value IS NULL OR length(secret_value)<32 THEN RAISE EXCEPTION 'SCHEDULER_SECRET_MISSING'; END IF;
  request := net.http_post(
    url := 'https://www.lavilett.com/api/integrations/automation/run',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||secret_value,
                                 'X-Lavilet-Scheduler','supabase-cron'),
    timeout_milliseconds := 240000
  );
  INSERT INTO lv_automation_private.scheduler_runs(request_id) VALUES(request);
  DELETE FROM lv_automation_private.scheduler_runs
  WHERE completed_at < clock_timestamp()-interval '7 days';
  DELETE FROM cron.job_run_details
  WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname='lavilet-automation-minute')
    AND end_time < clock_timestamp()-interval '7 days';
  RETURN jsonb_build_object('action','dispatched','request_id',request);
END;
$fn$;
REVOKE ALL ON FUNCTION lv_automation_private.tick() FROM PUBLIC,anon,authenticated,service_role;

-- Solo el servidor puede provisionar/rotar el secreto. No acepta URL ni SQL arbitrarios.
CREATE FUNCTION public.lv_app_set_scheduler_secret(p_secret text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE secret_id uuid;
BEGIN
  IF p_secret IS NULL OR length(p_secret)<32 OR length(p_secret)>4096
     OR strpos(p_secret,chr(10))>0 OR strpos(p_secret,chr(13))>0 THEN
    RAISE EXCEPTION 'INVALID_SCHEDULER_SECRET';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('lavilet-scheduler-secret',0));
  SELECT id INTO secret_id FROM vault.secrets WHERE name='lavilet_automation_cron_secret';
  IF secret_id IS NULL THEN
    PERFORM vault.create_secret(p_secret,'lavilet_automation_cron_secret','Authorization para el ejecutor de La Vilet en Vercel');
  ELSE
    PERFORM vault.update_secret(secret_id,p_secret);
  END IF;
  RETURN true;
END;
$fn$;
REVOKE ALL ON FUNCTION public.lv_app_set_scheduler_secret(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_app_set_scheduler_secret(text) TO service_role;

DO $do$
DECLARE job bigint;
BEGIN
  job := cron.schedule('lavilet-automation-minute','* * * * *','SELECT lv_automation_private.tick();');
  PERFORM cron.alter_job(job,active:=false);
END;
$do$;
NOTIFY pgrst, 'reload schema';
