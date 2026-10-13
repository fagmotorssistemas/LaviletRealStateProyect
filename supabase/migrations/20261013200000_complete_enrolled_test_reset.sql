-- Full reset explicitly requested by an administrator for an enrolled test lead.
-- Installation changes functions/triggers only; it never resets a contact.
BEGIN;
CREATE OR REPLACE FUNCTION public.lv_restart_enrolled_test_contact(p_id uuid,p_version integer,p_actor uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE
 t public.lv_test_contacts; l public.leads; matched record; op record; attr record;
 lid uuid; backup_id uuid; at_time timestamptz:=clock_timestamp(); tokens uuid[];
 snapshot jsonb; records jsonb; deleted jsonb:='{}'::jsonb; affected bigint;
 predicates text; outside_scope text; has_outside_scope boolean; assignments text; join_keys text; remaining integer; progress integer;
 unit_ids uuid[]:=ARRAY[]::uuid[];
 preserved text[]:=ARRAY['lv_manual_test_reset_backups','lv_test_backups','lv_automation_execution_steps','kommo_message_evidence','lv_integration_events'];
BEGIN
 -- Keep identity, enrollment and project checks; no conversation state is a veto.
 PERFORM pg_advisory_xact_lock(hashtext('lavilet-conversation-workers'));
 PERFORM public.lv_lock_project('a1b2c3d4-0001-4000-8000-000000000001','b1b2c3d4-0001-4000-8000-000000000001');
 SELECT * INTO t FROM public.lv_test_contacts WHERE id=p_id AND version=p_version
  AND tenant_id='a1b2c3d4-0001-4000-8000-000000000001' AND project_id='b1b2c3d4-0001-4000-8000-000000000001' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TEST_CONTACT_CHANGED'; END IF;
 SELECT * INTO matched FROM public.lv_test_contacts_state WHERE id=t.id;
 IF matched.matches>1 THEN RAISE EXCEPTION 'TEST_CONTACT_AMBIGUOUS'; END IF;
 IF matched.lead_id IS NULL THEN RAISE EXCEPTION 'TEST_CONTACT_NOT_LINKED'; END IF;
 lid:=matched.lead_id;
 SELECT * INTO l FROM public.leads WHERE id=lid FOR UPDATE;
 IF NOT FOUND OR l.tenant_id IS DISTINCT FROM t.tenant_id OR l.project_id IS DISTINCT FROM t.project_id
  OR public.lv_test_phone(l.phone) IS DISTINCT FROM t.phone THEN RAISE EXCEPTION 'TEST_CONTACT_NOT_LINKED'; END IF;

 CREATE TEMP TABLE IF NOT EXISTS lv_full_reset_roots(table_name text,filter_sql text) ON COMMIT DROP;
 CREATE TEMP TABLE IF NOT EXISTS lv_full_reset_targets(table_name text PRIMARY KEY,depth integer,rows_json jsonb,done boolean DEFAULT false) ON COMMIT DROP;
 TRUNCATE pg_temp.lv_full_reset_roots,pg_temp.lv_full_reset_targets;
 -- Legacy relations without foreign keys remain part of the reset.
 INSERT INTO pg_temp.lv_full_reset_roots VALUES
  ('messages','conversation_id IN (SELECT id FROM public.conversations WHERE lead_id=$1)'),
  ('units_shown','conversation_id IN (SELECT id FROM public.conversations WHERE lead_id=$1)'),
  ('bot_escalations','conversation_id IN (SELECT id FROM public.conversations WHERE lead_id=$1)'),
  ('unanswered_questions','conversation_id IN (SELECT id FROM public.conversations WHERE lead_id=$1)'),
  ('lv_appointment_bot_assignment_history','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id=$1)'),
  ('lv_appointment_bot_assignments','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id=$1)'),
  ('appointment_time_holds','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id=$1)'),
  ('lv_appointment_assignment_events','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id=$1)'),
  ('appointment_change_log','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id=$1)'),
  ('appointment_units','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id=$1)'),
  ('lv_visit_state','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id=$1)'),
  ('lv_visit_policy','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id=$1)'),
  ('lavilet_appointment_reminders','appointment_id IN (SELECT id FROM public.appointments WHERE lead_id=$1)');
 INSERT INTO pg_temp.lv_full_reset_roots
 SELECT c.relname,'lead_id=$1' FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND NOT c.relname=ANY(preserved)
  AND EXISTS(SELECT 1 FROM pg_catalog.pg_attribute a WHERE a.attrelid=c.oid AND a.attname='lead_id' AND NOT a.attisdropped);
 DELETE FROM pg_temp.lv_full_reset_roots WHERE pg_catalog.to_regclass('public.'||quote_ident(table_name)) IS NULL;

 -- Follow real foreign keys, including children of contracts, financing and visits.
 -- Snapshot typed rows before deletion, so cascades cannot destroy the backup.
 FOR op IN
 WITH RECURSIVE edges AS (
  SELECT parent.relname::text COLLATE "default" parent_name,child.relname::text COLLATE "default" child_name,
   ('('||string_agg(quote_ident(ca.attname),',' ORDER BY k.ordinality)||')') COLLATE "default" child_keys,
   string_agg(quote_ident(pa.attname),',' ORDER BY k.ordinality) COLLATE "default" parent_keys
  FROM pg_catalog.pg_constraint f
  JOIN pg_catalog.pg_class parent ON parent.oid=f.confrelid JOIN pg_catalog.pg_namespace pn ON pn.oid=parent.relnamespace
  JOIN pg_catalog.pg_class child ON child.oid=f.conrelid JOIN pg_catalog.pg_namespace cn ON cn.oid=child.relnamespace
  CROSS JOIN LATERAL unnest(f.conkey,f.confkey) WITH ORDINALITY k(child_key,parent_key,ordinality)
  JOIN pg_catalog.pg_attribute ca ON ca.attrelid=f.conrelid AND ca.attnum=k.child_key
  JOIN pg_catalog.pg_attribute pa ON pa.attrelid=f.confrelid AND pa.attnum=k.parent_key
  WHERE f.contype='f' AND pn.nspname='public' AND cn.nspname='public'
   AND child.relname<>'leads' AND NOT child.relname=ANY(preserved)
  GROUP BY f.oid,parent.relname,child.relname
 ), paths(table_name,filter_sql,trail) AS (
  SELECT table_name,filter_sql,ARRAY[table_name] FROM pg_temp.lv_full_reset_roots
  UNION ALL
  SELECT e.child_name,e.child_keys||' IN (SELECT '||e.parent_keys||' FROM public.'||quote_ident(e.parent_name)||' WHERE ('||p.filter_sql||'))',p.trail||e.child_name
  FROM paths p JOIN edges e ON e.parent_name=p.table_name WHERE NOT e.child_name=ANY(p.trail)
 ) SELECT table_name,max(cardinality(trail)) depth,string_agg('('||filter_sql||')',' OR ') filter_sql
 FROM paths GROUP BY table_name
 LOOP
  predicates:='('||op.filter_sql||')';
  outside_scope:='false';
  -- Never clear a row owned by another lead or project through a shared relation.
  FOR attr IN SELECT a.attname FROM pg_catalog.pg_attribute a
   WHERE a.attrelid=pg_catalog.to_regclass('public.'||quote_ident(op.table_name)) AND NOT a.attisdropped
    AND a.attname IN ('lead_id','tenant_id','project_id') LOOP
   predicates:=predicates||CASE attr.attname
    WHEN 'lead_id' THEN ' AND (lead_id IS NULL OR lead_id=$1)'
    WHEN 'tenant_id' THEN ' AND (tenant_id IS NULL OR tenant_id=$2)'
    ELSE ' AND (project_id IS NULL OR project_id=$3)' END;
   outside_scope:=outside_scope||CASE attr.attname
    WHEN 'lead_id' THEN ' OR lead_id<>$1'
    WHEN 'tenant_id' THEN ' OR tenant_id<>$2'
    ELSE ' OR project_id<>$3' END;
  END LOOP;
  EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I WHERE (%s) AND (%s))',op.table_name,op.filter_sql,outside_scope)
   INTO has_outside_scope USING lid,t.tenant_id,t.project_id;
  IF has_outside_scope THEN RAISE EXCEPTION 'TEST_RESET_SCOPE_MISMATCH'; END IF;
  EXECUTE format('SELECT coalesce(jsonb_agg(to_jsonb(r)),''[]''::jsonb) FROM public.%I r WHERE %s',op.table_name,predicates)
   INTO records USING lid,t.tenant_id,t.project_id;
  INSERT INTO pg_temp.lv_full_reset_targets(table_name,depth,rows_json) VALUES(op.table_name,op.depth,records);
 END LOOP;

 SELECT coalesce(array_agg(DISTINCT (r->>'unit_id')::uuid),ARRAY[]::uuid[]) INTO unit_ids
 FROM pg_temp.lv_full_reset_targets x CROSS JOIN LATERAL jsonb_array_elements(x.rows_json) r
 WHERE (x.table_name IN ('reservations','unit_sales_closings') OR x.table_name='lead_units' AND l.status::text IN ('reservado','vendido'))
  AND nullif(r->>'unit_id','') IS NOT NULL;
 IF pg_catalog.to_regclass('public.units') IS NOT NULL THEN
  EXECUTE 'SELECT id FROM public.units WHERE id=ANY($1) AND tenant_id=$2 AND project_id=$3 FOR UPDATE' USING unit_ids,t.tenant_id,t.project_id;
  EXECUTE 'SELECT coalesce(jsonb_agg(to_jsonb(u)),''[]''::jsonb) FROM public.units u WHERE u.id=ANY($1) AND u.tenant_id=$2 AND u.project_id=$3'
   INTO records USING unit_ids,t.tenant_id,t.project_id;
 ELSE records:='[]'::jsonb; END IF;
 SELECT jsonb_build_object('reason','Reinicio completo desde panel de pruebas','actor_id',p_actor,'lead',to_jsonb(l),'inventory_before',records)
  ||coalesce(jsonb_object_agg(table_name,rows_json),'{}'::jsonb) INTO snapshot FROM pg_temp.lv_full_reset_targets;
 snapshot:=snapshot||jsonb_build_object('integration_events',(
  SELECT coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) FROM public.lv_integration_events e
  WHERE e.tenant_id=t.tenant_id AND e.project_id=t.project_id AND (
   e.payload->>'kommoId'=l.kommo_id::text OR e.payload->>'leadId'=lid::text
   OR e.payload->>'contactId'=to_jsonb(l)->>'contact_id' AND coalesce(e.payload->>'kommoId','') IN ('','0')
   OR e.result->'args'->>'p_conversation_id' IN (SELECT id::text FROM public.conversations WHERE lead_id=lid)
   OR e.kind='lock' AND starts_with(e.event_key,'__conversation__:') AND (
    split_part(substr(e.event_key,length('__conversation__:')+1),':',1)=l.kommo_id::text
    OR split_part(substr(e.event_key,length('__conversation__:')+1),':',2)=to_jsonb(l)->>'contact_id'))));
 INSERT INTO public.lv_manual_test_reset_backups(lead_id,snapshot) VALUES(lid,snapshot) RETURNING id INTO backup_id;

 SELECT coalesce(array_agg(DISTINCT claim_token) FILTER(WHERE claim_token IS NOT NULL),ARRAY[]::uuid[]) INTO tokens
 FROM public.lv_integration_events WHERE tenant_id=t.tenant_id AND project_id=t.project_id
  AND status='processing'
  AND (payload->>'kommoId'=l.kommo_id::text OR payload->>'leadId'=lid::text
   OR payload->>'contactId'=to_jsonb(l)->>'contact_id' AND coalesce(payload->>'kommoId','') IN ('','0'));
 -- Revoke only workers processing this contact; other contacts keep their leases.
 UPDATE public.lv_integration_events SET claim_token=NULL,lease_until=NULL,
  result=coalesce(result,'{}'::jsonb)||jsonb_build_object('test_reset_at',at_time,'test_reset_backup_id',backup_id)
 WHERE tenant_id=t.tenant_id AND project_id=t.project_id AND kind='lock'
  AND (claim_token=ANY(tokens) OR starts_with(event_key,'__conversation__:') AND (
   split_part(substr(event_key,length('__conversation__:')+1),':',1)=l.kommo_id::text
   OR split_part(substr(event_key,length('__conversation__:')+1),':',2)=to_jsonb(l)->>'contact_id'));
 -- Keep deduplication IDs and historical delivery evidence, retire every old job.
 UPDATE public.lv_integration_events SET status='cancelled',claim_token=NULL,completed_at=at_time,
  result=coalesce(result,'{}'::jsonb)||jsonb_build_object('test_reset_backup_id',backup_id,'test_reset_at',at_time,
   'requires_review',false,'recovery_complete',true,'reset_cancelled',true)
   ||CASE WHEN payload->>'task'='reply_registration' THEN jsonb_build_object('delivery_state','reset','registration_state','cancelled') ELSE '{}'::jsonb END
 WHERE tenant_id=t.tenant_id AND project_id=t.project_id AND (
  kind<>'lock' AND (payload->>'kommoId'=l.kommo_id::text OR payload->>'leadId'=lid::text
   OR payload->>'contactId'=to_jsonb(l)->>'contact_id' AND coalesce(payload->>'kommoId','') IN ('','0'))
  OR kind='lock' AND payload->>'task'='reply_registration'
   AND result->'args'->>'p_conversation_id' IN (SELECT id::text FROM public.conversations WHERE lead_id=lid));
 GET DIAGNOSTICS affected=ROW_COUNT;
 deleted:=deleted||jsonb_build_object('events_cancelled_and_scrubbed',affected);

 -- Try children before parents; FK rejections defer a table, never discard backup.
 LOOP
  SELECT count(*) INTO remaining FROM pg_temp.lv_full_reset_targets WHERE NOT done;
  EXIT WHEN remaining=0;
  progress:=0;
  FOR op IN SELECT * FROM pg_temp.lv_full_reset_targets WHERE NOT done ORDER BY depth DESC,table_name LOOP
   SELECT string_agg(format('r.%1$I IS NOT DISTINCT FROM saved.%1$I',a.attname),' AND ' ORDER BY k.ordinality) INTO join_keys
   FROM pg_catalog.pg_constraint c CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum,ordinality)
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=k.attnum
   WHERE c.contype='p' AND c.conrelid=pg_catalog.to_regclass('public.'||quote_ident(op.table_name));
   join_keys:=coalesce(join_keys,'to_jsonb(r)=to_jsonb(saved)');
   BEGIN
    EXECUTE format('DELETE FROM public.%1$I r USING jsonb_populate_recordset(NULL::public.%1$I,$1) saved WHERE %2$s',op.table_name,join_keys) USING op.rows_json;
    GET DIAGNOSTICS affected=ROW_COUNT;
    deleted:=deleted||jsonb_build_object(op.table_name,affected);
    UPDATE pg_temp.lv_full_reset_targets SET done=true WHERE table_name=op.table_name;
    progress:=progress+1;
   EXCEPTION WHEN foreign_key_violation THEN NULL;
   END;
  END LOOP;
  IF progress=0 THEN RAISE EXCEPTION 'TEST_RESET_DEPENDENCY_FAILED'; END IF;
 END LOOP;

 IF cardinality(unit_ids)>0 AND pg_catalog.to_regclass('public.units') IS NOT NULL THEN
  EXECUTE 'UPDATE public.units u SET status=''disponible'' WHERE u.id=ANY($1) AND u.tenant_id=$2 AND u.project_id=$3
   AND u.status::text IN (''reservado'',''en_proceso'',''bajo_contrato'',''vendido'')
   AND NOT EXISTS(SELECT 1 FROM public.reservations r WHERE r.unit_id=u.id AND coalesce(r.status::text,'''') NOT IN (''cancelado'',''cancelada'',''expired'',''expirada''))
   AND NOT EXISTS(SELECT 1 FROM public.unit_sales_closings s WHERE s.unit_id=u.id)
   AND NOT EXISTS(SELECT 1 FROM public.lead_units lu JOIN public.leads other ON other.id=lu.lead_id
    WHERE lu.unit_id=u.id AND other.id<>$4 AND other.status::text IN (''reservado'',''vendido''))'
   USING unit_ids,t.tenant_id,t.project_id,lid;
  GET DIAGNOSTICS affected=ROW_COUNT;
  deleted:=deleted||jsonb_build_object('inventory_released',affected);
 END IF;

 -- Reset all current profile/state columns, including ones added after this migration.
 -- Preserve only the contact identity needed for the next inbound message.
 SELECT string_agg(format('%I=%s',a.attname,CASE
  WHEN a.attname IN ('updated_at','stage_updated_at','bot_resumed_at') THEN 'clock_timestamp()'
  WHEN a.attname='bot_resumed_by' THEN '$4'
  WHEN a.attname='bot_enabled' THEN 'true'
  WHEN a.attname='status' THEN '''nuevo'''
  WHEN a.attname='stage' THEN '''lanzamiento'''
  WHEN a.attname='temperature' THEN '''frio'''
  WHEN a.attname='temperature_score' THEN '0'
  WHEN a.attname='handoff_status' THEN '''none'''
  WHEN a.attname='behavior_signals' THEN '''{}''::jsonb'
  WHEN a.attname='mensajes_enviados' THEN 'ARRAY[]::text[]'
  WHEN a.atttypid='boolean'::regtype THEN 'false'
  WHEN NOT a.attnotnull THEN 'NULL'
  WHEN d.adbin IS NOT NULL THEN pg_catalog.pg_get_expr(d.adbin,d.adrelid)
  WHEN a.atttypid IN ('text'::regtype,'varchar'::regtype) THEN quote_literal('')
  ELSE 'DEFAULT' END),',') INTO assignments
 FROM pg_catalog.pg_attribute a LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
 WHERE a.attrelid='public.leads'::regclass AND a.attnum>0 AND NOT a.attisdropped AND a.attgenerated=''
  AND NOT a.attname=ANY(ARRAY['id','tenant_id','project_id','phone','phone_normalized','kommo_id','whatsapp_id','contact_id','channel_origin','created_at']);
 EXECUTE 'UPDATE public.leads SET '||assignments||' WHERE id=$1 AND tenant_id=$2 AND project_id=$3' USING lid,t.tenant_id,t.project_id,p_actor;
 UPDATE public.lv_test_contacts SET version=version+1,last_reset_at=at_time,updated_at=at_time,updated_by=p_actor WHERE id=t.id;
 RETURN jsonb_build_object('status','reset','lead_id',lid,'phone',l.phone,'backup_id',backup_id,'deleted',deleted,'bot_enabled',true);
END $fn$;
REVOKE ALL ON FUNCTION public.lv_restart_enrolled_test_contact(uuid,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_restart_enrolled_test_contact(uuid,integer,uuid) TO service_role;

-- A late worker must not revive an event/journal cancelled by an explicit reset.
CREATE OR REPLACE FUNCTION public.lv_preserve_test_reset_cancellation()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE reset_at timestamptz; source_at timestamptz;
BEGIN
 IF TG_OP='UPDATE' AND OLD.result ? 'test_reset_at' AND OLD.result->>'reset_cancelled'='true' THEN
  NEW.status:=OLD.status; NEW.claim_token:=NULL; NEW.completed_at:=OLD.completed_at;
  NEW.result:=OLD.result;
 ELSIF TG_OP='INSERT' AND NEW.kind IN ('inbound','advisor_outbound') AND nullif(NEW.payload->>'sentAt','') IS NOT NULL THEN
  SELECT max(c.last_reset_at) INTO reset_at FROM public.lv_test_contacts_state c
  WHERE c.tenant_id=NEW.tenant_id AND c.project_id=NEW.project_id AND c.matches=1
   AND (c.kommo_id::text=NEW.payload->>'kommoId' OR c.lead_id::text=NEW.payload->>'leadId');
  BEGIN source_at:=(NEW.payload->>'sentAt')::timestamptz;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN source_at:=NULL; END;
  -- Provider timestamps have second precision; don't discard a new message
  -- sent immediately after the reset in that same second.
  IF source_at<date_trunc('second',reset_at) THEN
   NEW.status:='cancelled'; NEW.claim_token:=NULL; NEW.completed_at:=clock_timestamp();
   NEW.result:=coalesce(NEW.result,'{}'::jsonb)||jsonb_build_object('test_reset_at',reset_at,
    'reset_cancelled',true,'requires_review',false,'recovery_complete',true,'reason','MESSAGE_BEFORE_TEST_RESET');
  END IF;
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS lv_preserve_test_reset_cancellation ON public.lv_integration_events;
CREATE TRIGGER lv_preserve_test_reset_cancellation BEFORE INSERT OR UPDATE ON public.lv_integration_events
 FOR EACH ROW EXECUTE FUNCTION public.lv_preserve_test_reset_cancellation();

-- Preserve late inference usage/audit after the old conversation is deleted.
-- This never resurrects a conversation or any commercial state.
CREATE OR REPLACE FUNCTION public.lv_detach_reset_execution_trace()
RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.conversation_id IS NOT NULL
  AND NOT EXISTS(SELECT 1 FROM public.conversations WHERE id=NEW.conversation_id)
  AND EXISTS(SELECT 1 FROM public.lv_integration_events e WHERE e.id=NEW.event_id
   AND e.tenant_id=NEW.tenant_id AND e.project_id=NEW.project_id AND e.result->>'reset_cancelled'='true') THEN
  NEW.conversation_id:=NULL;
 END IF;
 RETURN NEW;
END $$;
DO $$ BEGIN
 IF pg_catalog.to_regclass('public.lv_automation_execution_steps') IS NOT NULL THEN
  DROP TRIGGER IF EXISTS lv_detach_reset_execution_trace ON public.lv_automation_execution_steps;
  CREATE TRIGGER lv_detach_reset_execution_trace BEFORE INSERT OR UPDATE ON public.lv_automation_execution_steps
   FOR EACH ROW EXECUTE FUNCTION public.lv_detach_reset_execution_trace();
 END IF;
END $$;
COMMIT;
