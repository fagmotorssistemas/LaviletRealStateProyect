BEGIN;

-- Shared mutex makes old/global workers and new/contact workers mutually safe
-- during rolling deployments. Three distinct conversations may run together.
CREATE OR REPLACE FUNCTION public.lv_app_worker_lock(p_token uuid, p_action text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_token IS NULL THEN RAISE EXCEPTION 'token required'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('lavilet-conversation-workers'));
  IF p_action = 'acquire' THEN
    IF EXISTS (SELECT 1 FROM public.lv_integration_events
      WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001' AND kind='lock'
        AND starts_with(event_key,'__conversation__:') AND lease_until > now()) THEN RETURN false; END IF;
    INSERT INTO public.lv_integration_events(tenant_id,project_id,event_key,kind,status,claim_token,lease_until)
    VALUES('a1b2c3d4-0001-4000-8000-000000000001','b1b2c3d4-0001-4000-8000-000000000001',
      '__worker__','lock','completed',p_token,now()+interval '3 minutes')
    ON CONFLICT(project_id,event_key) DO UPDATE SET claim_token=p_token,lease_until=now()+interval '3 minutes'
    WHERE lv_integration_events.lease_until IS NULL OR lv_integration_events.lease_until < now()
    RETURNING id INTO v_id;
  ELSIF p_action = 'renew' THEN
    UPDATE public.lv_integration_events SET lease_until=now()+interval '3 minutes'
    WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001' AND kind='lock'
      AND (event_key='__worker__' OR starts_with(event_key,'__conversation__:'))
      AND claim_token=p_token AND lease_until>now() RETURNING id INTO v_id;
  ELSIF p_action = 'release' THEN
    UPDATE public.lv_integration_events SET lease_until=NULL,claim_token=NULL
    WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001' AND kind='lock'
      AND (event_key='__worker__' OR starts_with(event_key,'__conversation__:'))
      AND claim_token=p_token RETURNING id INTO v_id;
  ELSE RAISE EXCEPTION 'invalid action'; END IF;
  RETURN v_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.lv_app_contact_lock(p_token uuid, p_contact text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_token IS NULL OR coalesce(p_contact,'')='' OR length(p_contact)>200 THEN RAISE EXCEPTION 'invalid contact lease'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext('lavilet-conversation-workers'));
  IF EXISTS (SELECT 1 FROM public.lv_integration_events
    WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001' AND event_key='__worker__' AND lease_until>now())
    OR (SELECT count(*) FROM public.lv_integration_events
      WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001' AND kind='lock'
        AND starts_with(event_key,'__conversation__:') AND lease_until>now()) >= 3 THEN RETURN false; END IF;
  INSERT INTO public.lv_integration_events(tenant_id,project_id,event_key,kind,status,claim_token,lease_until)
  VALUES('a1b2c3d4-0001-4000-8000-000000000001','b1b2c3d4-0001-4000-8000-000000000001',
    '__conversation__:'||p_contact,'lock','completed',p_token,now()+interval '3 minutes')
  ON CONFLICT(project_id,event_key) DO UPDATE SET claim_token=p_token,lease_until=now()+interval '3 minutes'
  WHERE lv_integration_events.lease_until IS NULL OR lv_integration_events.lease_until < now()
  RETURNING id INTO v_id;
  RETURN v_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.lv_app_contact_wakeup(p_contact text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('event_id',e.id,'due_at',CASE WHEN e.kind='advisor_outbound' THEN e.available_at ELSE
    (SELECT max(p.available_at) FROM public.lv_integration_events p WHERE p.project_id=e.project_id
      AND p.contact_key=e.contact_key AND p.status='pending' AND p.kind='inbound') END)
  FROM public.lv_integration_events e
  WHERE e.project_id='b1b2c3d4-0001-4000-8000-000000000001' AND e.contact_key=p_contact
    AND e.kind IN ('inbound','advisor_outbound') AND e.status='pending'
    AND NOT EXISTS (SELECT 1 FROM public.lv_integration_events u WHERE u.project_id=e.project_id
      AND u.contact_key=e.contact_key AND u.status='uncertain')
  ORDER BY CASE e.kind WHEN 'advisor_outbound' THEN 0 ELSE 1 END,e.received_at DESC,e.id DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.lv_app_claim_contact(p_token uuid, p_contact text)
RETURNS SETOF public.lv_integration_events LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE chosen public.lv_integration_events; batch_limit integer:=10;
BEGIN
  -- Also locks the lease row until the claim commits. Never renew somebody
  -- else's contact, and never touch another conversation's processing rows.
  PERFORM 1 FROM public.lv_integration_events
    WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001'
      AND event_key='__conversation__:'||p_contact AND kind='lock'
      AND claim_token=p_token AND lease_until>now() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contact lease lost'; END IF;
  UPDATE public.lv_integration_events SET status='uncertain',result=jsonb_build_object('reason','worker_interrupted')
    WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001' AND contact_key=p_contact
      AND status='processing' AND claim_token IS DISTINCT FROM p_token;
  IF EXISTS (SELECT 1 FROM public.lv_integration_events WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001'
    AND contact_key=p_contact AND status IN ('uncertain','processing')) THEN RETURN; END IF;
  SELECT e.* INTO chosen FROM public.lv_integration_events e
    WHERE e.project_id='b1b2c3d4-0001-4000-8000-000000000001' AND e.contact_key=p_contact
      AND e.status='pending' AND e.available_at<=now() AND e.kind IN ('inbound','advisor_outbound')
      AND (e.kind='advisor_outbound' OR NOT EXISTS (SELECT 1 FROM public.lv_integration_events later
        WHERE later.project_id=e.project_id AND later.contact_key=e.contact_key AND later.status='pending'
          AND later.kind IN ('inbound','advisor_outbound') AND later.available_at>now()))
    ORDER BY CASE e.kind WHEN 'advisor_outbound' THEN 0 ELSE 1 END,e.received_at,e.id
    LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM public.lv_integration_events WHERE project_id=chosen.project_id
    AND contact_key=p_contact AND status='pending' AND kind='inbound' AND jsonb_typeof(payload->'media')='object')
    THEN batch_limit:=2; END IF;
  RETURN QUERY WITH picked AS (
    SELECT e.id FROM public.lv_integration_events e WHERE e.id=chosen.id OR
      (chosen.kind='inbound' AND e.project_id=chosen.project_id AND e.contact_key=p_contact
        AND e.kind='inbound' AND e.status='pending' AND e.available_at<=now())
    ORDER BY e.received_at,e.id LIMIT batch_limit FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.lv_integration_events e SET status='processing',claimed_at=now(),claim_token=p_token
    WHERE e.id IN (SELECT id FROM picked) RETURNING e.*
  ) SELECT * FROM claimed ORDER BY received_at,id;
END;
$$;

REVOKE ALL ON FUNCTION public.lv_app_contact_lock(uuid,text),public.lv_app_contact_wakeup(text),public.lv_app_claim_contact(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_app_contact_lock(uuid,text),public.lv_app_contact_wakeup(text),public.lv_app_claim_contact(uuid,text) TO service_role;
-- CREATE OR REPLACE retains the worker lock's existing service-only grants.
NOTIFY pgrst, 'reload schema';
COMMIT;
