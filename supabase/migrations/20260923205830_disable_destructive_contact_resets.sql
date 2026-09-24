-- PREPARED ONLY. Retire production reset entry points; never touch saved rows.
-- Test resets remain in isolated PGlite fixtures, not behind a production flag.
begin;
do $guard$
declare f record;
begin
  for f in
    select p.oid, p.proname, pg_get_function_arguments(p.oid) args,
           pg_get_function_identity_arguments(p.oid) identity_args,
           pg_get_function_result(p.oid) result_type
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in (
      'lv_reset_lavilet_test_contact','lv_reset_lavilet_test_lead',
      'lv_reset_lavilet_nataly_lead','lv_reset_lavilet_pablo_lead','lv_test_reset')
  loop
    execute format('create or replace function public.%I(%s) returns %s language plpgsql security invoker set search_path='''' as $blocked$ begin raise exception using errcode=''42501'', message=''DESTRUCTIVE_TEST_RESET_DISABLED'', hint=''Use isolated test fixtures; production history must be preserved.''; end $blocked$',f.proname,f.args,f.result_type);
    execute format('revoke all on function public.%I(%s) from public,anon,authenticated,service_role',f.proname,f.identity_args);
  end loop;
end $guard$;

-- Preserve all existing snapshots, including empty or older versions.
create function public.lv_preserve_reset_backups() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  raise exception using errcode='42501',message='RESET_BACKUP_IMMUTABLE';
end $$;
revoke all on function public.lv_preserve_reset_backups() from public,anon,authenticated,service_role;
do $backups$
declare t text;
begin
  foreach t in array array['lv_manual_test_reset_backups','lv_test_backups'] loop
    if to_regclass('public.'||t) is not null then
      execute format('revoke update,delete,truncate on public.%I from public,anon,authenticated,service_role',t);
      execute format('create trigger preserve_reset_backup before update or delete or truncate on public.%I for each statement execute function public.lv_preserve_reset_backups()',t);
    end if;
  end loop;
end $backups$;
commit;
