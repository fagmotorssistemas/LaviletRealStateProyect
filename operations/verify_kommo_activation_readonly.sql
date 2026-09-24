-- READ ONLY. Before activation, missing new objects are expected; afterwards every
-- `ok` must be true. Never invokes ingestion, reset, scoring, bots or CAPI.
-- Compare with the baseline in docs/kommo-activation-package-20260924.md.

select clock_timestamp() as queried_at, count(*) as snapshots,
       md5(string_agg(id::text||':'||md5(snapshot::text),'|' order by id)) as fingerprint,
       count(*)=116 and md5(string_agg(id::text||':'||md5(snapshot::text),'|' order by id))
         ='11903d4f433afecc120a4deaaa8fef23' as ok
from public.lv_manual_test_reset_backups;

-- Preserve the second backup table too; compare this fingerprint before/after.
select count(*) as snapshots,
       md5(string_agg(md5(to_jsonb(b)::text),'|' order by b.lead_id,b.captured_at)) as fingerprint
from public.lv_test_backups b;

select c.enabled,c.dry_run,c.test_only,c.test_lead_id,l.kommo_id,l.contact_id,
       c.test_only is true
       and c.test_lead_id='52fa6e93-4bd4-42ad-963a-666e9c7902a7'::uuid
       and l.tenant_id=c.tenant_id and l.project_id=c.project_id
       and l.kommo_id=4454162 and l.contact_id='9432278' as ok
from public.lv_auto_config c left join public.leads l on l.id=c.test_lead_id
where c.tenant_id='a1b2c3d4-0001-4000-8000-000000000001'
  and c.project_id='b1b2c3d4-0001-4000-8000-000000000001';

with expected(signature) as (values
 ('public.lv_app_receive(jsonb)'),('public.lv_app_receive_advisor_outbound(jsonb)'),
 ('public.apply_lead_events(uuid,jsonb,text)'),('public.set_lead_stage(uuid,text,text)'),
 ('public.lv_record_message_evidence(jsonb)'),
 ('public.lv_receive_kommo_observation(jsonb,jsonb,jsonb)'),
 ('public.classify_crm_contact(uuid,uuid,text,text,text)'),
 ('public.lv_evaluate_message_interest(uuid,jsonb,text)'))
select signature,to_regprocedure(signature) is not null as present,
       coalesce(has_function_privilege('service_role',to_regprocedure(signature),'execute'),false) as service_execute
from expected;

with expected(signature) as (values
 ('public.lv_record_message_evidence(jsonb)'),
 ('public.lv_receive_kommo_observation(jsonb,jsonb,jsonb)'),
 ('public.classify_crm_contact(uuid,uuid,text,text,text)'),
 ('public.lv_evaluate_message_interest(uuid,jsonb,text)'))
select signature,coalesce(to_regprocedure(signature) is not null
       and has_function_privilege('service_role',to_regprocedure(signature),'execute')
       and not has_function_privilege('anon',to_regprocedure(signature),'execute')
       and not has_function_privilege('authenticated',to_regprocedure(signature),'execute'),false) as ok
from expected;

with expected(name,service_privileges) as (values
 ('kommo_message_evidence',array['SELECT','INSERT']),
 ('crm_contact_classifications',array['SELECT']),
 ('lead_interest_evaluations',array['SELECT'])),
 roles(role_name) as (values('anon'),('authenticated'),('service_role')),
 privileges(privilege) as (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE'),('REFERENCES'),('TRIGGER'))
select e.name,r.role_name,p.privilege,c.relrowsecurity,
       coalesce(c.oid is not null and c.relrowsecurity
       and has_table_privilege(r.role_name,c.oid,p.privilege)
           = (r.role_name='service_role' and p.privilege=any(e.service_privileges)),false) as ok
from expected e cross join roles r cross join privileges p
left join pg_class c on c.relnamespace='public'::regnamespace and c.relname=e.name;

with expected(name) as (values('lv_reset_lavilet_test_contact'),('lv_reset_lavilet_test_lead'),
 ('lv_reset_lavilet_nataly_lead'),('lv_reset_lavilet_pablo_lead'),('lv_test_reset'))
select e.name,p.oid::regprocedure::text as signature,
       coalesce(position('DESTRUCTIVE_TEST_RESET_DISABLED' in p.prosrc)>0
       and not p.prosecdef
       and not has_function_privilege('anon',p.oid,'execute')
       and not has_function_privilege('authenticated',p.oid,'execute')
       and not has_function_privilege('service_role',p.oid,'execute'),false) as ok
from expected e left join pg_proc p on p.pronamespace='public'::regnamespace and p.proname=e.name;

select p.oid::regprocedure::text as signature,
       position('LEGACY_COOLING_DISABLED_USE_CANONICAL_DECAY' in p.prosrc)>0
       and not has_function_privilege('anon',p.oid,'execute')
       and not has_function_privilege('authenticated',p.oid,'execute')
       and not has_function_privilege('service_role',p.oid,'execute') as ok
from pg_proc p where p.oid=to_regprocedure('public.lv3_store_cooling(jsonb)');

select c.relname,coalesce(t.tgenabled in ('O','A'),false) as ok,
       pg_get_triggerdef(t.oid) as definition
from pg_class c left join pg_trigger t on t.tgrelid=c.oid and t.tgname='preserve_reset_backup'
where c.relnamespace='public'::regnamespace and c.relname in ('lv_manual_test_reset_backups','lv_test_backups');

-- Expect no user triggers on these three new tables (the observer must stay passive).
select c.relname,t.tgname,pg_get_triggerdef(t.oid) as definition
from pg_trigger t join pg_class c on c.oid=t.tgrelid
where c.relnamespace='public'::regnamespace and not t.tgisinternal
and c.relname in ('kommo_message_evidence','crm_contact_classifications','lead_interest_evaluations');

select tablename,indexname,indexdef from pg_indexes where schemaname='public'
and tablename in ('kommo_message_evidence','lead_interest_evaluations','lv_integration_events','messages');
-- Review UNIQUE(account_id,external_message_id,direction,source,delivery_status),
-- UNIQUE(lead_id,source_message_id) and inbox UNIQUE(project_id,event_key).
-- Multiple delivery states are observations of one message, not new acquisitions.
