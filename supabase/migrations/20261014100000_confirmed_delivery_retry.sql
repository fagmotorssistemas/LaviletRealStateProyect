BEGIN;
ALTER TABLE public.lv_integration_events DROP CONSTRAINT IF EXISTS lv_integration_events_kind_check;
ALTER TABLE public.lv_integration_events ADD CONSTRAINT lv_integration_events_kind_check CHECK (kind IN ('inbound','advisor_outbound','delivery_retry','maintenance','decay','lock'));

CREATE OR REPLACE FUNCTION public.lv_app_claim_contact(p_token uuid,p_contact text)
RETURNS SETOF public.lv_integration_events LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE chosen lv_integration_events; batch_limit integer:=10;
BEGIN
 PERFORM 1 FROM lv_integration_events WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001'
  AND event_key='__conversation__:'||p_contact AND kind='lock' AND claim_token=p_token AND lease_until>now() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONTACT_LEASE_LOST'; END IF;
 UPDATE lv_integration_events SET status='uncertain',result=jsonb_build_object('reason','WORKER_INTERRUPTED','requires_review',true)
  WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001' AND public.lv_app_resources_overlap(contact_key,p_contact) AND status='processing' AND claim_token IS DISTINCT FROM p_token;
 IF EXISTS(SELECT 1 FROM lv_integration_events WHERE project_id='b1b2c3d4-0001-4000-8000-000000000001' AND public.lv_app_resources_overlap(contact_key,p_contact) AND status='processing') THEN RETURN; END IF;
 SELECT e.* INTO chosen FROM lv_integration_events e WHERE e.project_id='b1b2c3d4-0001-4000-8000-000000000001' AND e.contact_key=p_contact
  AND e.status='pending' AND e.available_at<=now() AND e.kind IN ('inbound','advisor_outbound','delivery_retry')
  AND (e.kind='advisor_outbound' OR (NOT EXISTS(SELECT 1 FROM lv_integration_events u WHERE u.project_id=e.project_id AND public.lv_app_resources_overlap(u.contact_key,e.contact_key) AND u.status='uncertain')
   AND NOT EXISTS(SELECT 1 FROM lv_integration_events later WHERE later.project_id=e.project_id AND later.contact_key=e.contact_key AND later.status='pending'
    AND later.kind IN ('inbound','advisor_outbound') AND later.available_at>now())))
  ORDER BY CASE e.kind WHEN 'advisor_outbound' THEN 0 WHEN 'delivery_retry' THEN 1 ELSE 2 END,e.received_at,e.ingest_order LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM lv_integration_events WHERE project_id=chosen.project_id AND contact_key=p_contact AND status='pending'
   AND kind='inbound' AND jsonb_typeof(payload->'media')='object') THEN batch_limit:=2; END IF;
 RETURN QUERY WITH picked AS (
  SELECT e.id FROM lv_integration_events e WHERE e.id=chosen.id OR
   (chosen.kind='inbound' AND e.project_id=chosen.project_id AND e.contact_key=p_contact AND e.kind='inbound' AND e.status='pending' AND e.available_at<=now())
  ORDER BY e.received_at,e.ingest_order LIMIT batch_limit FOR UPDATE SKIP LOCKED
 ), claimed AS (
  UPDATE lv_integration_events e SET status='processing',claimed_at=now(),claim_token=p_token WHERE e.id IN (SELECT id FROM picked) RETURNING e.*
 ) SELECT * FROM claimed ORDER BY received_at,ingest_order;
END $$;

CREATE OR REPLACE FUNCTION public.lv_app_reconcile_delivery_v2(
 p_event uuid,p_actor uuid,p_outcome text,p_reviewed boolean,p_provider_message_id text,p_review_reference text,p_retry boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE e lv_integration_events; journal lv_integration_events; evidence kommo_message_evidence;
 ids uuid[]; retry_id uuid; retry_key text; retry_checkpoint text; counter integer; source_event lv_integration_events;
 at_time timestamptz:=clock_timestamp();
BEGIN
 IF p_reviewed IS DISTINCT FROM true OR coalesce(p_outcome,'') NOT IN ('sent','not_sent') OR p_actor IS NULL
  OR length(trim(coalesce(p_review_reference,''))) NOT BETWEEN 3 AND 300
  OR p_retry IS NULL OR p_retry AND p_outcome<>'not_sent'
  OR p_outcome='not_sent' AND nullif(trim(coalesce(p_provider_message_id,'')),'') IS NOT NULL THEN
  RAISE EXCEPTION 'DELIVERY_REVIEW_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM profiles WHERE id=p_actor AND role='admin' AND is_active=true) THEN RAISE EXCEPTION 'DELIVERY_REVIEW_FORBIDDEN'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('lavilet-conversation-workers'));
 SELECT * INTO e FROM lv_integration_events WHERE id=p_event AND tenant_id='a1b2c3d4-0001-4000-8000-000000000001'
  AND project_id='b1b2c3d4-0001-4000-8000-000000000001' AND kind IN ('inbound','advisor_outbound','delivery_retry') FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'INCIDENT_NOT_REVIEWABLE'; END IF;
 IF e.result->>'reconciliation_outcome'=p_outcome AND e.status IN ('completed','cancelled') THEN
  RETURN jsonb_build_object('reconciled',true,'already_reviewed',true,'contact_key',e.contact_key,'retry_event_id',e.result->>'retry_event_id'); END IF;
 IF e.status<>'uncertain' THEN RAISE EXCEPTION 'INCIDENT_NOT_REVIEWABLE'; END IF;
 IF EXISTS(SELECT 1 FROM lv_integration_events l WHERE l.project_id=e.project_id AND l.status='processing' AND public.lv_app_resources_overlap(l.contact_key,e.contact_key))
  OR EXISTS(SELECT 1 FROM lv_integration_events l WHERE l.project_id=e.project_id AND l.kind='lock' AND l.lease_until>now()
   AND (l.event_key='__worker__' OR starts_with(l.event_key,'__conversation__:')
    AND public.lv_app_resources_overlap(substr(l.event_key,length('__conversation__:')+1),e.contact_key))) THEN RAISE EXCEPTION 'WORKER_BUSY'; END IF;
 SELECT * INTO journal FROM lv_integration_events j WHERE j.tenant_id=e.tenant_id AND j.project_id=e.project_id
  AND j.kind='lock' AND j.payload->>'task'='reply_registration' AND j.contact_key=e.contact_key
  AND j.result->'event_ids' ? e.id::text ORDER BY j.received_at DESC LIMIT 1 FOR UPDATE;
 ids:=ARRAY[e.id];
 IF journal.id IS NOT NULL THEN
  SELECT array_agg(value::uuid) INTO ids FROM jsonb_array_elements_text(journal.result->'event_ids');
  IF coalesce(cardinality(ids),0)=0 OR cardinality(ids)>10 OR cardinality(ids)<>(
   SELECT count(*) FROM lv_integration_events i WHERE i.id=ANY(ids) AND i.project_id=e.project_id AND i.tenant_id=e.tenant_id
    AND i.contact_key=e.contact_key AND i.kind IN ('inbound','delivery_retry') AND i.status='uncertain'
  ) THEN RAISE EXCEPTION 'DELIVERY_BATCH_CONFLICT'; END IF;
  PERFORM 1 FROM lv_integration_events WHERE id=ANY(ids) ORDER BY id FOR UPDATE;
 END IF;
 IF p_outcome='sent' THEN
  SELECT * INTO evidence FROM kommo_message_evidence k WHERE k.tenant_id=e.tenant_id AND k.project_id=e.project_id
   AND k.contact_id=e.payload->>'contactId' AND k.external_message_id=p_provider_message_id AND k.direction='outgoing'
   AND k.delivery_status IN ('sent','delivered','read') AND k.kommo_lead_id=(e.payload->>'kommoId')::bigint
   AND k.sent_at>=coalesce(e.claimed_at,e.received_at)-interval '1 minute'
   AND k.sent_at<=coalesce(e.completed_at,at_time)+interval '1 minute'
   AND (journal.id IS NULL OR k.content=journal.result->'args'->>'p_content') ORDER BY k.observed_at DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'DELIVERY_EVIDENCE_REQUIRED'; END IF;
 ELSIF journal.id IS NOT NULL AND (journal.result->>'delivery_state'='accepted' OR journal.result->>'registration_state'='registered') THEN
  RAISE EXCEPTION 'DELIVERY_OUTCOME_CONFLICT';
 END IF;
 IF p_retry THEN
  IF journal.id IS NULL OR journal.result->>'delivery_state' NOT IN ('attempted','prepared')
   OR journal.result->>'registration_state'<>'pending' OR nullif(journal.result->'args'->>'p_content','') IS NULL THEN
   RAISE EXCEPTION 'DELIVERY_RETRY_CHECKPOINT_REQUIRED'; END IF;
  counter:=coalesce((journal.result->>'delivery_retry_count')::integer,0)+1;
  IF counter>2 THEN RAISE EXCEPTION 'DELIVERY_RETRY_LIMIT'; END IF;
  SELECT * INTO source_event FROM lv_integration_events WHERE id=ANY(ids)
   AND payload->>'externalId'=journal.result->'args'->'p_tool_calls'->>'source_message_id'
   ORDER BY received_at DESC,ingest_order DESC LIMIT 1;
  IF NOT FOUND THEN RAISE EXCEPTION 'DELIVERY_RETRY_CHECKPOINT_REQUIRED'; END IF;
  retry_id:=gen_random_uuid(); retry_key:='delivery_retry:'||journal.id::text;
  retry_checkpoint:=journal.event_key||':confirmed-retry:'||counter::text;
  INSERT INTO lv_integration_events(id,tenant_id,project_id,event_key,kind,contact_key,payload,available_at)
   VALUES(retry_id,e.tenant_id,e.project_id,retry_key,'delivery_retry',e.contact_key,
    source_event.payload||jsonb_build_object('checkpoint_key',retry_checkpoint,'retry_of',e.id,'task','delivery_retry'),at_time);
  INSERT INTO lv_integration_events(tenant_id,project_id,event_key,kind,status,contact_key,payload,result,completed_at)
   VALUES(e.tenant_id,e.project_id,retry_checkpoint,'lock','completed',e.contact_key,jsonb_build_object('task','reply_registration'),
    journal.result||jsonb_build_object('delivery_state','prepared','registration_state','pending','retry_safe',true,
     'recovery_complete',false,'memory_saved',false,'event_ids',jsonb_build_array(retry_id),
     'original_event_ids',to_jsonb(ids),'delivery_retry_count',counter,'reviewed_by',p_actor,'prepared_at',at_time),at_time);
 END IF;
 UPDATE lv_integration_events SET status=CASE WHEN p_outcome='sent' THEN 'completed' ELSE 'cancelled' END,completed_at=at_time,
  result=coalesce(result,'{}'::jsonb)||jsonb_build_object('requires_review',false,'delivery_uncertain',false,
   'reconciliation_outcome',p_outcome,'reviewed_by',p_actor,'reviewed_at',at_time,'review_reference',trim(p_review_reference),
   'provider_message_id',evidence.external_message_id,'delivery_status',CASE WHEN p_outcome='sent' THEN 'confirmed' ELSE 'not_sent' END,
   'recovery',CASE WHEN p_retry THEN 'confirmed_retry_queued' ELSE 'not_replayed' END,'retry_event_id',retry_id,
   'reply_registration_checkpoint',journal.event_key)
  WHERE id=ANY(ids);
 IF journal.id IS NOT NULL THEN
  UPDATE lv_integration_events SET result=result||jsonb_build_object('delivery_state',CASE WHEN p_outcome='sent' THEN 'accepted' ELSE 'not_sent' END,
   'recovery_complete',p_outcome='not_sent','reviewed_by',p_actor,'reviewed_at',at_time,'provider_message_id',evidence.external_message_id)
   WHERE id=journal.id;
 END IF;
 RETURN jsonb_build_object('reconciled',true,'already_reviewed',false,'contact_key',e.contact_key,'batch_size',cardinality(ids),'retry_event_id',retry_id);
END $$;

CREATE OR REPLACE FUNCTION public.lv_app_contact_wakeup(p_contact text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
 SELECT jsonb_build_object('event_id',e.id,'due_at',CASE WHEN e.kind IN ('advisor_outbound','delivery_retry') THEN e.available_at ELSE
  (SELECT max(p.available_at) FROM lv_integration_events p WHERE p.project_id=e.project_id AND p.contact_key=e.contact_key AND p.status='pending' AND p.kind='inbound') END)
 FROM lv_integration_events e WHERE e.project_id='b1b2c3d4-0001-4000-8000-000000000001' AND e.contact_key=p_contact
  AND e.kind IN ('inbound','advisor_outbound','delivery_retry') AND e.status='pending'
  AND (e.kind='advisor_outbound' OR NOT EXISTS(SELECT 1 FROM lv_integration_events u WHERE u.project_id=e.project_id AND public.lv_app_resources_overlap(u.contact_key,e.contact_key) AND u.status='uncertain'))
 ORDER BY CASE e.kind WHEN 'advisor_outbound' THEN 0 WHEN 'delivery_retry' THEN 1 ELSE 2 END,e.received_at DESC,e.ingest_order DESC LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.lv_app_reconcile_delivery_v2(uuid,uuid,text,boolean,text,text,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_app_reconcile_delivery_v2(uuid,uuid,text,boolean,text,text,boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.lv_app_claim(p_token uuid)
RETURNS SETOF public.lv_integration_events LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE chosen lv_integration_events; batch_limit integer:=10;
BEGIN
 IF NOT public.lv_app_worker_lock(p_token,'renew') THEN RAISE EXCEPTION 'WORKER_LEASE_LOST'; END IF;
 UPDATE lv_integration_events e SET status='uncertain',result=jsonb_build_object('reason','WORKER_INTERRUPTED','requires_review',true)
  WHERE e.project_id='b1b2c3d4-0001-4000-8000-000000000001' AND e.status='processing' AND e.claim_token IS DISTINCT FROM p_token
   AND NOT EXISTS(SELECT 1 FROM lv_integration_events l WHERE l.kind='lock' AND l.claim_token=e.claim_token AND l.lease_until>now());
 SELECT e.* INTO chosen FROM lv_integration_events e WHERE e.project_id='b1b2c3d4-0001-4000-8000-000000000001'
  AND e.status='pending' AND e.available_at<=now() AND e.kind<>'lock'
  AND NOT (e.kind='decay' OR e.kind='maintenance' AND coalesce(e.payload->>'task','')='')
  AND (e.kind<>'inbound' OR NOT EXISTS(SELECT 1 FROM lv_integration_events later WHERE later.project_id=e.project_id AND later.contact_key=e.contact_key AND later.status='pending' AND later.available_at>now()))
  AND (e.kind='advisor_outbound' OR e.contact_key IS NULL OR NOT EXISTS(SELECT 1 FROM lv_integration_events unresolved WHERE unresolved.project_id=e.project_id AND public.lv_app_resources_overlap(unresolved.contact_key,e.contact_key) AND unresolved.status='uncertain'))
  ORDER BY CASE e.kind WHEN 'advisor_outbound' THEN 0 WHEN 'delivery_retry' THEN 1 WHEN 'inbound' THEN 2 ELSE 3 END,e.available_at,e.ingest_order LIMIT 1 FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN; END IF;
 IF EXISTS(SELECT 1 FROM lv_integration_events e WHERE e.project_id=chosen.project_id AND e.contact_key=chosen.contact_key AND e.status='pending' AND jsonb_typeof(e.payload->'media')='object') THEN batch_limit:=2; END IF;
 RETURN QUERY WITH picked AS (
  SELECT e.id FROM lv_integration_events e WHERE e.id=chosen.id OR
   (chosen.kind='inbound' AND e.project_id=chosen.project_id AND e.contact_key=chosen.contact_key AND e.kind='inbound' AND e.status='pending' AND e.available_at<=now())
  ORDER BY e.received_at,e.ingest_order LIMIT batch_limit FOR UPDATE SKIP LOCKED
 ), claimed AS (
  UPDATE lv_integration_events e SET status='processing',claimed_at=now(),claim_token=p_token WHERE e.id IN (SELECT id FROM picked) RETURNING e.*
 ) SELECT * FROM claimed ORDER BY received_at,ingest_order;
END $$;


-- This retry restores only the exact snapshot prepared for its checked draft.
-- Pass the comparison through the RPC body, never a large URL filter.
CREATE OR REPLACE FUNCTION public.lv_app_save_retry_memory(p_checkpoint uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE journal lv_integration_events; changed uuid;
BEGIN
 SELECT * INTO journal FROM lv_integration_events WHERE id=p_checkpoint
  AND tenant_id='a1b2c3d4-0001-4000-8000-000000000001' AND project_id='b1b2c3d4-0001-4000-8000-000000000001'
  AND kind='lock' AND payload->>'task'='reply_registration' AND result->>'delivery_state'='accepted'
  AND result->>'registration_state'='registered' AND result ? 'delivery_retry_count' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'DELIVERY_RETRY_ACCEPTANCE_REQUIRED'; END IF;
 UPDATE conversations SET summary=journal.result->>'summary_after'
  WHERE id=(journal.result->'args'->>'p_conversation_id')::uuid AND project_id=journal.project_id AND tenant_id=journal.tenant_id
   AND summary IS NOT DISTINCT FROM journal.result->>'summary_before' RETURNING id INTO changed;
 RETURN changed IS NOT NULL OR EXISTS(SELECT 1 FROM conversations
  WHERE id=(journal.result->'args'->>'p_conversation_id')::uuid AND project_id=journal.project_id AND tenant_id=journal.tenant_id
   AND summary=journal.result->>'summary_after');
END $$;
REVOKE ALL ON FUNCTION public.lv_app_save_retry_memory(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_app_save_retry_memory(uuid) TO service_role;
COMMIT;
