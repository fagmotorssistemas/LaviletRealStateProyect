-- Una cita web pre-intent para stress de recover concurrente.
\set ON_ERROR_STOP on

DO $$
DECLARE
  tid uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  pid uuid := 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  lid uuid := 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
  aid uuid := 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
BEGIN
  INSERT INTO public.tenants(id) VALUES (tid) ON CONFLICT DO NOTHING;
  INSERT INTO public.projects(id, tenant_id) VALUES (pid, tid) ON CONFLICT DO NOTHING;
  INSERT INTO public.leads(id, tenant_id, project_id, phone, name, email, meta_ads_consent)
  VALUES (lid, tid, pid, '593990000099', 'Conc Client', 'c@x.com', true)
  ON CONFLICT (id) DO UPDATE SET meta_ads_consent = true;
  DELETE FROM public.meta_capi_outbox WHERE idempotency_key = 'schedule:' || aid::text;
  DELETE FROM public.appointments WHERE id = aid;
  INSERT INTO public.appointments(
    id, tenant_id, project_id, lead_id, status, channel,
    confirmed_by_client, confirmed_at
  ) VALUES (
    aid, tid, pid, lid, 'aceptado', 'web', true, now() - interval '30 minutes'
  );
END $$;
