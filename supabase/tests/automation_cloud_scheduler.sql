-- Prueba transaccional: los datos ficticios y cualquier petición HTTP se deshacen.
BEGIN;
DO $test$
DECLARE action text;
BEGIN
  IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='lavilet-automation-minute' AND active) THEN
    RAISE EXCEPTION 'Disable cloud cron before this isolated database test';
  END IF;
  INSERT INTO lv_automation_private.scheduler_runs(request_id,requested_at)
  SELECT id,clock_timestamp()-interval '2 minutes' FROM unnest(ARRAY[-101,-102,-103,-104,-105,-106]::bigint[]) id;
  INSERT INTO lv_automation_private.scheduler_runs(request_id,requested_at) VALUES(-107,clock_timestamp()-interval '6 minutes');
  INSERT INTO net._http_response(id,status_code,content,timed_out,error_msg) VALUES
    (-101,200,'{"mode":"live","processed":1,"results":[{"kind":"maintenance"}]}',false,null),
    (-102,200,'{"mode":"off","processed":0}',false,null),
    (-103,429,'{"error":"limited"}',false,null),
    (-104,200,'not-json',false,null),
    (-105,200,'{"mode":"live","processed":1,"results":[{"status":"uncertain"}]}',false,null),
    (-106,null,null,true,'timeout');
  PERFORM lv_automation_private.collect_results();
  IF NOT EXISTS(SELECT 1 FROM lv_automation_private.scheduler_runs WHERE request_id=-101 AND status='completed' AND processed=1) THEN RAISE EXCEPTION 'Valid response not recognized'; END IF;
  IF NOT EXISTS(SELECT 1 FROM lv_automation_private.scheduler_runs WHERE request_id=-102 AND status='error' AND reason='WORKER_NOT_LIVE') THEN RAISE EXCEPTION 'Off mode reported healthy'; END IF;
  IF NOT EXISTS(SELECT 1 FROM lv_automation_private.scheduler_runs WHERE request_id=-103 AND status='error' AND reason='HTTP_429') THEN RAISE EXCEPTION '429 not recognized'; END IF;
  IF NOT EXISTS(SELECT 1 FROM lv_automation_private.scheduler_runs WHERE request_id=-104 AND status='error' AND reason='INVALID_WORKER_RESPONSE') THEN RAISE EXCEPTION 'Invalid JSON reported healthy'; END IF;
  IF NOT EXISTS(SELECT 1 FROM lv_automation_private.scheduler_runs WHERE request_id=-105 AND status='error' AND uncertain_count=1) THEN RAISE EXCEPTION 'Uncertain result hidden'; END IF;
  IF (SELECT count(*) FROM lv_automation_private.scheduler_runs WHERE request_id IN (-106,-107) AND status='timeout')<>2 THEN RAISE EXCEPTION 'Timeout not recognized'; END IF;
  UPDATE lv_automation_private.scheduler_runs SET requested_at=clock_timestamp() WHERE request_id=-103;
  action := lv_automation_private.tick()->>'action';
  IF action IS DISTINCT FROM 'retry_backoff' THEN RAISE EXCEPTION 'HTTP failure not backed off'; END IF;
  INSERT INTO lv_automation_private.scheduler_runs(request_id) VALUES(-108);
  action := lv_automation_private.tick()->>'action';
  IF action IS DISTINCT FROM 'request_in_flight' THEN RAISE EXCEPTION 'Concurrent HTTP dispatch allowed'; END IF;
  IF has_function_privilege('anon','public.lv_app_set_scheduler_secret(text)','EXECUTE')
    OR has_function_privilege('authenticated','public.lv_app_set_scheduler_secret(text)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.lv_app_set_scheduler_secret(text)','EXECUTE')
    OR has_schema_privilege('authenticated','lv_automation_private','USAGE')
    OR has_table_privilege('anon','vault.decrypted_secrets','SELECT')
    OR has_table_privilege('authenticated','vault.decrypted_secrets','SELECT')
    THEN RAISE EXCEPTION 'Scheduler privilege check failed';
  END IF;
END;
$test$;
ROLLBACK;
