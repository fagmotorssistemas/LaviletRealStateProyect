-- Preparada, NO aplicada. No cambia funciones o tablas de negocio existentes.
BEGIN;

CREATE TABLE public.lv_integration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  event_key text NOT NULL CHECK (length(event_key) <= 300),
  kind text NOT NULL CHECK (kind IN ('inbound', 'maintenance', 'decay', 'lock')),
  contact_key text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','cancelled','uncertain')),
  available_at timestamptz NOT NULL DEFAULT now(),
  received_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claim_token uuid,
  lease_until timestamptz,
  completed_at timestamptz,
  UNIQUE(project_id, event_key)
);
CREATE INDEX lv_integration_events_pending ON public.lv_integration_events(project_id, status, available_at);
CREATE INDEX lv_integration_events_contact ON public.lv_integration_events(project_id, contact_key, status);
ALTER TABLE public.lv_integration_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lv_integration_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.lv_integration_events TO service_role;

-- Un único worker por proyecto; tokens distintos impiden que dos cron ejecuten el mismo lote.
CREATE FUNCTION public.lv_app_worker_lock(p_token uuid, p_action text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF p_token IS NULL THEN RAISE EXCEPTION 'token required'; END IF;
  IF p_action = 'acquire' THEN
    INSERT INTO public.lv_integration_events(tenant_id, project_id, event_key, kind, status, claim_token, lease_until)
    VALUES('a1b2c3d4-0001-4000-8000-000000000001','b1b2c3d4-0001-4000-8000-000000000001','__worker__','lock','completed',p_token,now()+interval '3 minutes')
    ON CONFLICT(project_id,event_key) DO UPDATE SET claim_token=p_token, lease_until=now()+interval '3 minutes'
    WHERE lv_integration_events.lease_until IS NULL OR lv_integration_events.lease_until < now()
    RETURNING id INTO v_id;
  ELSIF p_action = 'renew' THEN
    UPDATE public.lv_integration_events SET lease_until=now()+interval '3 minutes'
    WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001' AND event_key='__worker__'
      AND claim_token=p_token AND lease_until>now() RETURNING id INTO v_id;
  ELSIF p_action = 'release' THEN
    UPDATE public.lv_integration_events SET lease_until=NULL,claim_token=NULL
    WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001' AND event_key='__worker__'
      AND claim_token=p_token RETURNING id INTO v_id;
  ELSE RAISE EXCEPTION 'invalid action'; END IF;
  RETURN v_id IS NOT NULL;
END;
$$;

CREATE FUNCTION public.lv_app_receive(p_events jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE event jsonb; count_inserted integer := 0; added integer;
BEGIN
  IF jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) > 100 THEN RAISE EXCEPTION 'invalid events'; END IF;
  FOR event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    IF coalesce(event->>'externalId','') = '' OR coalesce(event->>'contactId','') = '' THEN RAISE EXCEPTION 'invalid event'; END IF;
    INSERT INTO public.lv_integration_events(tenant_id,project_id,event_key,kind,contact_key,payload,available_at)
    VALUES('a1b2c3d4-0001-4000-8000-000000000001','b1b2c3d4-0001-4000-8000-000000000001',
      'inbound:'||(event->>'externalId'),'inbound',(event->>'kommoId')||':'||(event->>'contactId'),event,now()+interval '30 seconds')
    ON CONFLICT(project_id,event_key) DO NOTHING;
    GET DIAGNOSTICS added = ROW_COUNT;
    count_inserted := count_inserted + added;
  END LOOP;
  RETURN count_inserted;
END;
$$;

CREATE FUNCTION public.lv_app_claim(p_token uuid)
RETURNS SETOF public.lv_integration_events LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE chosen public.lv_integration_events; batch_limit integer := 10;
BEGIN
  IF NOT public.lv_app_worker_lock(p_token,'renew') THEN RAISE EXCEPTION 'worker lease lost'; END IF;
  -- No se reenvían operaciones abandonadas: pueden haber alcanzado Kommo o aplicado acciones.
  UPDATE public.lv_integration_events SET status='uncertain',result=jsonb_build_object('reason','worker_interrupted')
  WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001' AND status='processing' AND claim_token IS DISTINCT FROM p_token;
  SELECT e.* INTO chosen FROM public.lv_integration_events e
  WHERE e.project_id='b1b2c3d4-0001-4000-8000-000000000001' AND e.status='pending' AND e.available_at<=now()
    AND e.kind<>'lock'
    AND (e.kind<>'inbound' OR NOT EXISTS (
      SELECT 1 FROM public.lv_integration_events later
      WHERE later.project_id=e.project_id AND later.contact_key=e.contact_key
        AND later.status='pending' AND later.available_at>now()
    ))
    AND (e.contact_key IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.lv_integration_events unresolved
      WHERE unresolved.project_id=e.project_id AND unresolved.contact_key=e.contact_key AND unresolved.status='uncertain'
    ))
  ORDER BY CASE e.kind WHEN 'inbound' THEN 0 ELSE 1 END,e.available_at,e.id LIMIT 1 FOR UPDATE SKIP LOCKED;
  IF NOT FOUND THEN RETURN; END IF;
  IF EXISTS(SELECT 1 FROM public.lv_integration_events e WHERE e.project_id=chosen.project_id
    AND e.contact_key=chosen.contact_key AND e.status='pending' AND jsonb_typeof(e.payload->'media')='object') THEN
    batch_limit := 2;
  END IF;
  RETURN QUERY UPDATE public.lv_integration_events SET status='processing',claimed_at=now(),claim_token=p_token
    WHERE id IN (SELECT e.id FROM public.lv_integration_events e WHERE e.id=chosen.id
      OR (chosen.kind='inbound' AND e.project_id=chosen.project_id
        AND e.contact_key=chosen.contact_key AND e.status='pending' AND e.available_at<=now())
      ORDER BY e.received_at,e.id LIMIT batch_limit)
    RETURNING *;
END;
$$;

CREATE FUNCTION public.lv_app_finish(p_token uuid, p_ids uuid[], p_status text, p_result jsonb)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer;
BEGIN
  IF NOT public.lv_app_worker_lock(p_token,'renew') THEN RAISE EXCEPTION 'worker lease lost'; END IF;
  IF p_status NOT IN ('completed','cancelled','uncertain') THEN RAISE EXCEPTION 'invalid status'; END IF;
  UPDATE public.lv_integration_events SET status=p_status,result=p_result,completed_at=now()
  WHERE id=ANY(p_ids) AND status='processing' AND claim_token=p_token AND kind<>'lock';
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;

REVOKE ALL ON FUNCTION public.lv_app_worker_lock(uuid,text),public.lv_app_receive(jsonb),public.lv_app_claim(uuid),public.lv_app_finish(uuid,uuid[],text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_app_worker_lock(uuid,text),public.lv_app_receive(jsonb),public.lv_app_claim(uuid),public.lv_app_finish(uuid,uuid[],text,jsonb) TO service_role;

COMMIT;
