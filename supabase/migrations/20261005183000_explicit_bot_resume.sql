-- Explicit reactivation preserves the lead, conversation and manual message evidence.
BEGIN;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS bot_resumed_at timestamptz;
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS bot_resumed_by uuid;

-- Preserve legacy blocked for old clients; new clients distinguish opt-out from handoff.
CREATE OR REPLACE VIEW public.lv_test_contacts_state WITH (security_invoker=true) AS
 SELECT t.*,m.matches,
 CASE WHEN m.matches=1 THEN m.lead_id END lead_id,
 CASE WHEN m.matches=1 THEN m.kommo_id END kommo_id,
 m.matches=1 AND m.bot_enabled bot_enabled,
 m.matches<>1 OR m.blocked blocked,
 m.matches<>1 OR m.opt_out_blocked opt_out_blocked
 FROM public.lv_test_contacts t CROSS JOIN LATERAL (
  SELECT count(*)::integer matches, min(l.id::text)::uuid lead_id, min(l.kommo_id) kommo_id,
   bool_and(l.bot_enabled) bot_enabled,
   bool_or(l.tracking_opt_out_at IS NOT NULL OR coalesce(l.handoff_status,'none')<>'none') blocked,
   bool_or(l.tracking_opt_out_at IS NOT NULL) opt_out_blocked
  FROM public.leads l WHERE l.tenant_id=t.tenant_id AND l.project_id=t.project_id
    AND public.lv_test_phone(l.phone)=t.phone
 ) m;
REVOKE ALL ON public.lv_test_contacts_state FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.lv_test_contacts_state TO service_role;

CREATE OR REPLACE FUNCTION public.lv_resume_enrolled_test_contact(p_id uuid,p_version integer,p_actor uuid,p_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t public.lv_test_contacts; s record; l public.leads; resumed timestamptz;
BEGIN
 IF p_token IS NULL OR NOT public.lv_app_worker_lock(p_token,'renew') THEN RAISE EXCEPTION 'TEST_RESUME_BUSY'; END IF;
 SELECT * INTO t FROM public.lv_test_contacts WHERE id=p_id AND version=p_version
  AND tenant_id='a1b2c3d4-0001-4000-8000-000000000001'
  AND project_id='b1b2c3d4-0001-4000-8000-000000000001' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TEST_CONTACT_CHANGED'; END IF;
 SELECT * INTO s FROM public.lv_test_contacts_state WHERE id=t.id;
 IF s.matches>1 THEN RAISE EXCEPTION 'TEST_CONTACT_AMBIGUOUS'; END IF;
 IF s.matches<>1 OR s.kommo_id IS NULL OR s.kommo_id<=0 THEN RAISE EXCEPTION 'TEST_CONTACT_NOT_LINKED'; END IF;
 SELECT * INTO l FROM public.leads WHERE id=s.lead_id AND tenant_id=t.tenant_id AND project_id=t.project_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'TEST_CONTACT_NOT_LINKED'; END IF;
 IF l.tracking_opt_out_at IS NOT NULL THEN RAISE EXCEPTION 'TEST_CONTACT_OPT_OUT'; END IF;
 IF EXISTS(SELECT 1 FROM public.lv_integration_events e WHERE e.tenant_id=t.tenant_id AND e.project_id=t.project_id
   AND e.status IN ('processing','uncertain') AND (e.payload->>'kommoId'=l.kommo_id::text OR e.payload->>'leadId'=l.id::text))
 THEN RAISE EXCEPTION 'TEST_RESUME_BUSY'; END IF;
 resumed:=clock_timestamp();
 UPDATE public.leads SET bot_enabled=true,bot_resumed_at=resumed,bot_resumed_by=p_actor,
  handoff_status=CASE WHEN handoff_status IN ('queued','assigned','acknowledged') THEN 'resolved' ELSE handoff_status END,
  updated_at=resumed WHERE id=l.id;
 UPDATE public.lv_test_contacts SET version=version+1,updated_at=resumed,updated_by=p_actor WHERE id=t.id;
 RETURN jsonb_build_object('lead_id',l.id,'kommo_id',l.kommo_id,'resumed_at',resumed);
END $$;
REVOKE ALL ON FUNCTION public.lv_resume_enrolled_test_contact(uuid,integer,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_resume_enrolled_test_contact(uuid,integer,uuid,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.lv_record_advisor_outbound(
  p_kommo_lead_id bigint,
  p_contact_id text,
  p_kommo_user_id text,
  p_external_message_id text,
  p_content text,
  p_sent_at timestamptz,
  p_author_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_conversation public.conversations%ROWTYPE;
  v_advisor uuid;
  v_inserted integer := 0;
BEGIN
  IF coalesce(p_kommo_lead_id, 0) <= 0 AND nullif(trim(p_contact_id), '') IS NULL THEN
    RAISE EXCEPTION 'lead or contact required';
  END IF;
  IF nullif(trim(p_kommo_user_id), '') IS NULL
     OR nullif(trim(p_external_message_id), '') IS NULL
     OR p_sent_at IS NULL THEN
    RAISE EXCEPTION 'invalid advisor outbound';
  END IF;

  SELECT l.*
  INTO v_lead
  FROM public.leads l
  WHERE l.tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001'
    AND l.project_id = 'b1b2c3d4-0001-4000-8000-000000000001'
    AND (
      (coalesce(p_kommo_lead_id, 0) > 0 AND l.kommo_id = p_kommo_lead_id)
      OR (nullif(trim(p_contact_id), '') IS NOT NULL AND l.contact_id::text = trim(p_contact_id))
    )
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('handled', false, 'reason', 'LEAD_NOT_FOUND');
  END IF;

  -- Algunas cuentas de Kommo, incluida la actual de La Vilet, publican las
  -- salidas con un único usuario compartido. Primero se intenta la relación
  -- exacta y, si no existe, se conserva al asesor que ya posee el lead.
  SELECT p.id
  INTO v_advisor
  FROM public.profiles p
  WHERE p.kommo_user_id::text = p_kommo_user_id
    AND p.is_active = true
    AND (
      p.role = 'admin'
      OR EXISTS (
        SELECT 1
        FROM public.project_salespeople ps
        WHERE ps.project_id = v_lead.project_id
          AND ps.tenant_id = v_lead.tenant_id
          AND ps.salesperson_id = p.id
      )
    )
  LIMIT 1;

  IF v_advisor IS NULL AND v_lead.assigned_to IS NOT NULL THEN
    SELECT p.id
    INTO v_advisor
    FROM public.profiles p
    WHERE p.id = v_lead.assigned_to
      AND p.is_active = true
      AND (
        p.role = 'admin'
        OR EXISTS (
          SELECT 1
          FROM public.project_salespeople ps
          WHERE ps.project_id = v_lead.project_id
            AND ps.tenant_id = v_lead.tenant_id
            AND ps.salesperson_id = p.id
        )
      )
    LIMIT 1;
  END IF;

  SELECT c.*
  INTO v_conversation
  FROM public.conversations c
  WHERE c.tenant_id = v_lead.tenant_id
    AND c.project_id = v_lead.project_id
    AND c.lead_id = v_lead.id
  ORDER BY c.started_at DESC, c.id DESC
  LIMIT 1;

  -- El webhook de salida también puede ser emitido por Salesbot. La entrega
  -- queda ignorada si ya existe el mismo mensaje del bot en la conversación.
  IF v_conversation.id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.messages m
    WHERE m.conversation_id = v_conversation.id
      AND m.role = 'bot'
      AND (
        m.external_message_id = p_external_message_id
        OR (
          nullif(trim(p_content), '') IS NOT NULL
          AND m.content = trim(p_content)
          AND m.sent_at BETWEEN p_sent_at - interval '5 minutes' AND p_sent_at + interval '5 minutes'
        )
      )
  ) THEN
    RETURN jsonb_build_object('handled', false, 'reason', 'BOT_DELIVERY');
  END IF;

  IF v_conversation.id IS NOT NULL THEN
    INSERT INTO public.messages(
      conversation_id, role, content, external_message_id, sent_at
    ) VALUES (
      v_conversation.id,
      'asesor',
      coalesce(nullif(trim(p_content), ''), '[Mensaje manual sin texto]'),
      p_external_message_id,
      p_sent_at
    )
    ON CONFLICT DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;

    UPDATE public.conversations
    SET last_message_at = greatest(coalesce(last_message_at, p_sent_at), p_sent_at)
    WHERE id = v_conversation.id;
  END IF;

  -- A late manual webhook is still recorded, but cannot undo an explicit resume.
  IF v_lead.bot_resumed_at IS NOT NULL AND p_sent_at <= v_lead.bot_resumed_at THEN
    RETURN jsonb_build_object('handled',true,'lead_id',v_lead.id,'kommo_id',v_lead.kommo_id,
      'conversation_id',v_conversation.id,'advisor_id',v_advisor,'message_inserted',v_inserted=1,
      'bot_paused',false,'reason','MANUAL_MESSAGE_BEFORE_RESUME');
  END IF;

  -- Es una actualización independiente del traspaso; el trigger que conserva
  -- la IA en asignaciones automáticas no revierte esta pausa manual.
  UPDATE public.leads
  SET bot_enabled = false,
      seller_first_response_at = coalesce(seller_first_response_at, p_sent_at),
      updated_at = now()
  WHERE id = v_lead.id;

  RETURN jsonb_build_object(
    'handled', true,
    'bot_paused', true,
    'lead_id', v_lead.id,
    'kommo_id', v_lead.kommo_id,
    'conversation_id', v_conversation.id,
    'advisor_id', v_advisor,
    'message_inserted', v_inserted = 1,
    'author_name', p_author_name
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.lv_record_advisor_outbound(bigint,text,text,text,text,timestamptz,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.lv_record_advisor_outbound(bigint,text,text,text,text,timestamptz,text) TO service_role;
COMMIT;
