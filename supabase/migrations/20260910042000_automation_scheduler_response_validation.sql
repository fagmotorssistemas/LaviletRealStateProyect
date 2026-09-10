CREATE OR REPLACE FUNCTION lv_automation_private.collect_results()
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
    ELSIF body IS NULL OR jsonb_typeof(body)<>'object' THEN code := 'INVALID_WORKER_RESPONSE';
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

