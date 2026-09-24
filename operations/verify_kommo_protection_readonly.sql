-- READ ONLY. Run after approved migrations, before deploying the receiver.
-- No calls to reset, classification, ingestion or recovery functions.
select p.oid::regprocedure::text as function,
       position('DESTRUCTIVE_TEST_RESET_DISABLED' in p.prosrc)>0 as blocked_in_body,
       has_function_privilege('anon',p.oid,'execute') as anon_execute,
       has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
       has_function_privilege('service_role',p.oid,'execute') as service_execute
from pg_proc p
where p.pronamespace='public'::regnamespace and p.proname in (
 'lv_reset_lavilet_test_contact','lv_reset_lavilet_test_lead',
 'lv_reset_lavilet_nataly_lead','lv_reset_lavilet_pablo_lead','lv_test_reset');

select c.relname,c.relrowsecurity, r.role, privileges.privilege,
       has_table_privilege(r.role,c.oid,privileges.privilege) as allowed
from pg_class c cross join (values('anon'),('authenticated'),('service_role')) r(role)
cross join (values('SELECT'),('INSERT'),('UPDATE'),('DELETE'),('TRUNCATE')) privileges(privilege)
where c.relnamespace='public'::regnamespace and c.relname in ('kommo_message_evidence','crm_contact_classifications');

select p.oid::regprocedure::text as function,p.prosecdef,
       has_function_privilege('anon',p.oid,'execute') as anon_execute,
       has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
       has_function_privilege('service_role',p.oid,'execute') as service_execute
from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in (
 'lv_record_message_evidence','lv_receive_kommo_observation','classify_crm_contact');

select c.relname,t.tgname,t.tgenabled from pg_trigger t join pg_class c on c.oid=t.tgrelid
where t.tgname='preserve_reset_backup' and not t.tgisinternal;

select count(*) as snapshots,max(captured_at) as latest_snapshot,
 md5(string_agg(id::text||':'||md5(snapshot::text),'|' order by id)) as fingerprint
from public.lv_manual_test_reset_backups;
