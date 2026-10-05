-- Installing this migration only registers the existing test contact. It never resets a lead.
BEGIN;
CREATE OR REPLACE FUNCTION public.lv_test_phone(p_phone text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT CASE WHEN d ~ '^09[0-9]{8}$' THEN '593'||substr(d,2) ELSE d END
 FROM (SELECT regexp_replace(p_phone,'[^0-9]','','g') d) s;
$$;
CREATE TABLE IF NOT EXISTS public.lv_test_contacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES public.tenants(id),
 project_id uuid NOT NULL REFERENCES public.projects(id),
 phone text NOT NULL CHECK(phone ~ '^[1-9][0-9]{7,14}$'),
 label text NOT NULL DEFAULT '' CHECK(length(label)<=80),
 fast_response boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 updated_by uuid,
 last_reset_at timestamptz,
 UNIQUE(tenant_id,project_id,phone)
);
ALTER TABLE public.lv_test_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lv_test_contacts FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.lv_test_contacts TO service_role;

CREATE OR REPLACE VIEW public.lv_test_contacts_state WITH (security_invoker=true) AS
 SELECT t.*,m.matches,
 CASE WHEN m.matches=1 THEN m.lead_id END lead_id,
 CASE WHEN m.matches=1 THEN m.kommo_id END kommo_id,
 m.matches=1 AND m.bot_enabled bot_enabled,
 m.matches<>1 OR m.blocked blocked
 FROM public.lv_test_contacts t CROSS JOIN LATERAL (
  SELECT count(*)::integer matches, min(l.id::text)::uuid lead_id, min(l.kommo_id) kommo_id,
   bool_and(l.bot_enabled) bot_enabled,
   bool_or(l.tracking_opt_out_at IS NOT NULL OR coalesce(l.handoff_status,'none')<>'none') blocked
  FROM public.leads l WHERE l.tenant_id=t.tenant_id AND l.project_id=t.project_id
    AND public.lv_test_phone(l.phone)=t.phone
 ) m;
REVOKE ALL ON public.lv_test_contacts_state FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.lv_test_contacts_state TO service_role;

INSERT INTO public.lv_test_contacts(tenant_id,project_id,phone,label,fast_response)
 SELECT c.tenant_id,c.project_id,public.lv_test_phone(l.phone),'Contacto de prueba actual',
   coalesce((p.content::jsonb->>'enabled')::boolean,false)
 FROM public.lv_auto_config c JOIN public.leads l ON l.id=c.test_lead_id AND l.project_id=c.project_id AND l.tenant_id=c.tenant_id
 LEFT JOIN public.agent_prompts p ON p.tenant_id=c.tenant_id AND p.project_id=c.project_id AND p.name='automation_test_response_mode'
 WHERE c.project_id='b1b2c3d4-0001-4000-8000-000000000001' AND public.lv_test_phone(l.phone) ~ '^[1-9][0-9]{7,14}$'
 ON CONFLICT(tenant_id,project_id,phone) DO NOTHING;

CREATE OR REPLACE FUNCTION public.lv_manage_test_contact(p_action text,p_id uuid DEFAULT NULL,p_version integer DEFAULT NULL,
 p_phone text DEFAULT NULL,p_label text DEFAULT '',p_actor uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.lv_test_contacts; s record;
BEGIN
 IF p_action='add' THEN
  IF p_phone IS NULL OR p_phone !~ '^[1-9][0-9]{7,14}$' OR length(p_label)>80 THEN RAISE EXCEPTION 'INVALID_TEST_CONTACT'; END IF;
  BEGIN
   INSERT INTO public.lv_test_contacts(tenant_id,project_id,phone,label,updated_by)
    VALUES('a1b2c3d4-0001-4000-8000-000000000001','b1b2c3d4-0001-4000-8000-000000000001',p_phone,p_label,p_actor);
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'TEST_CONTACT_DUPLICATE'; END;
  RETURN;
 END IF;
 SELECT * INTO t FROM public.lv_test_contacts WHERE id=p_id AND version=p_version
  AND tenant_id='a1b2c3d4-0001-4000-8000-000000000001' AND project_id='b1b2c3d4-0001-4000-8000-000000000001' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TEST_CONTACT_CHANGED'; END IF;
 SELECT * INTO s FROM public.lv_test_contacts_state WHERE id=t.id;
 IF p_action IN ('fast_off','remove') THEN
  UPDATE public.lv_integration_events e SET available_at=(e.result->>'test_original_available_at')::timestamptz,
    result=e.result-'test_original_available_at'-'test_mode_version'
   WHERE e.tenant_id=t.tenant_id AND e.project_id=t.project_id AND e.kind='inbound' AND e.status='pending'
    AND e.payload->>'kommoId'=s.kommo_id::text AND e.result ? 'test_original_available_at';
 END IF;
 IF p_action='remove' THEN DELETE FROM public.lv_test_contacts WHERE id=t.id; RETURN;
 ELSIF p_action IN ('fast_on','fast_off') THEN
  UPDATE public.lv_test_contacts SET fast_response=p_action='fast_on',version=version+1,updated_at=now(),updated_by=p_actor WHERE id=t.id;
 ELSIF p_action='resume' THEN
  IF s.matches<>1 OR s.kommo_id IS NULL THEN RAISE EXCEPTION 'TEST_CONTACT_NOT_LINKED'; END IF;
  IF s.blocked THEN RAISE EXCEPTION 'TEST_CONTACT_OPT_OUT'; END IF;
  UPDATE public.leads SET bot_enabled=true WHERE id=s.lead_id AND tenant_id=t.tenant_id AND project_id=t.project_id;
  UPDATE public.lv_test_contacts SET version=version+1,updated_at=now(),updated_by=p_actor WHERE id=t.id;
 ELSE RAISE EXCEPTION 'INVALID_TEST_ACTION'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.lv_manage_test_contact(text,uuid,integer,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_manage_test_contact(text,uuid,integer,text,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.lv_accelerate_test_messages(p_event_keys text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t record; s record; e record; contacts jsonb:='[]';
BEGIN
 IF cardinality(p_event_keys)>100 THEN RAISE EXCEPTION 'TOO_MANY_EVENTS'; END IF;
 FOR t IN SELECT * FROM public.lv_test_contacts WHERE fast_response
  AND tenant_id='a1b2c3d4-0001-4000-8000-000000000001' AND project_id='b1b2c3d4-0001-4000-8000-000000000001' FOR UPDATE LOOP
  SELECT * INTO s FROM public.lv_test_contacts_state WHERE id=t.id;
  IF s.matches<>1 OR s.kommo_id IS NULL THEN CONTINUE; END IF;
  FOR e IN UPDATE public.lv_integration_events SET available_at=now(),
    result=result||jsonb_build_object('test_original_available_at',available_at,'test_mode_version',t.version)
   WHERE tenant_id=t.tenant_id AND project_id=t.project_id AND kind='inbound' AND status='pending'
    AND event_key=ANY(p_event_keys) AND payload->>'kommoId'=s.kommo_id::text
    AND received_at>now()-interval '60 seconds' AND NOT result ? 'test_original_available_at'
   RETURNING contact_key LOOP
    IF NOT contacts @> jsonb_build_array(e.contact_key) THEN contacts:=contacts||jsonb_build_array(e.contact_key); END IF;
  END LOOP;
 END LOOP;
 RETURN contacts;
END $$;
REVOKE ALL ON FUNCTION public.lv_accelerate_test_messages(text[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_accelerate_test_messages(text[]) TO service_role;

-- Scheduled visits use the same enrolled contacts as inbound responses.
DO $patch$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.lv_app_visit_candidates()'::regprocedure) INTO definition;
 IF position('l.id=c.test_lead_id' in definition)>0 THEN
  definition:=replace(definition,'l.id=c.test_lead_id',
   'EXISTS (SELECT 1 FROM public.lv_test_contacts_state tc WHERE tc.tenant_id=l.tenant_id AND tc.project_id=l.project_id AND tc.matches=1 AND tc.lead_id=l.id)');
  EXECUTE definition;
 ELSIF position('lv_test_contacts_state' in definition)=0 THEN RAISE EXCEPTION 'TEST_VISIT_GATE_CHANGED'; END IF;
END $patch$;
COMMIT;
