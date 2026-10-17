-- Diagnóstico ADMINISTRATIVO de solo lectura (SQL Editor / rol postgres).
-- No activa cron, no llama tick/run/collect_results, no aplica migraciones y no envía mensajes.
-- No seleccionar command, decrypted_secret ni cuerpos HTTP: contienen credenciales o información privada.
begin transaction read only;

select now() as checked_at, current_database() as database_name;

select name, to_regclass(name) is not null as available
from (values ('public.lead_commercial_profiles'), ('public.lead_commercial_stage_observations'),
  ('public.lv_integration_events'), ('cron.job'), ('lv_automation_private.scheduler_runs')) as checks(name);

select version
from supabase_migrations.schema_migrations
where version in ('20260910041000', '20261015210000', '20261016110000')
order by version;

select jobid, jobname, schedule, active
from cron.job where jobname = 'lavilet-automation-minute';

select jobid, status, start_time, end_time
from cron.job_run_details
where jobid in (select jobid from cron.job where jobname = 'lavilet-automation-minute')
order by start_time desc limit 10;

select exists(select 1 from vault.secrets where name = 'lavilet_automation_cron_secret') as scheduler_secret_exists;

select requested_at, completed_at, status, http_status, worker_mode, processed, uncertain_count, reason
from lv_automation_private.scheduler_runs order by requested_at desc limit 10;

select status, received_at, completed_at, result->>'reason' as reason
from public.lv_integration_events
where tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001'
  and project_id = 'b1b2c3d4-0001-4000-8000-000000000001'
  and kind = 'maintenance' and payload->>'task' is null
order by received_at desc limit 10;

rollback;
