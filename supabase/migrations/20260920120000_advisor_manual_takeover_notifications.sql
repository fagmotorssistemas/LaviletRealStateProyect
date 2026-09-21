-- Registra respuestas manuales de Kommo como toma de control humana y crea
-- una bandeja privada de notificaciones para las asignaciones de leads.
BEGIN;

ALTER TABLE public.lv_integration_events
  DROP CONSTRAINT IF EXISTS lv_integration_events_kind_check;
ALTER TABLE public.lv_integration_events
  ADD CONSTRAINT lv_integration_events_kind_check
  CHECK (kind IN ('inbound', 'advisor_outbound', 'maintenance', 'decay', 'lock'));

CREATE OR REPLACE FUNCTION public.lv_app_receive_advisor_outbound(p_events jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  event jsonb;
  count_inserted integer := 0;
  added integer;
  contact_key text;
  resolved_kommo_id bigint;
BEGIN
  IF jsonb_typeof(p_events) <> 'array' OR jsonb_array_length(p_events) > 100 THEN
    RAISE EXCEPTION 'invalid events';
  END IF;

  FOR event IN SELECT value FROM jsonb_array_elements(p_events) LOOP
    IF coalesce(event->>'externalId', '') = ''
       OR coalesce(event->>'contactId', '') = ''
       OR coalesce(event->>'userId', '') = '' THEN
      RAISE EXCEPTION 'invalid advisor outbound event';
    END IF;

    resolved_kommo_id := nullif(event->>'kommoId', '')::bigint;
    IF coalesce(resolved_kommo_id, 0) <= 0 THEN
      SELECT l.kommo_id
      INTO resolved_kommo_id
      FROM public.leads l
      WHERE l.tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001'
        AND l.project_id = 'b1b2c3d4-0001-4000-8000-000000000001'
        AND l.contact_id::text = event->>'contactId'
      ORDER BY l.updated_at DESC
      LIMIT 1;
    END IF;
    IF coalesce(resolved_kommo_id, 0) > 0 THEN
      event := jsonb_set(event, '{kommoId}', to_jsonb(resolved_kommo_id), true);
    END IF;
    contact_key := coalesce(nullif(resolved_kommo_id, 0)::text, 'contact') || ':' || (event->>'contactId');
    INSERT INTO public.lv_integration_events(
      tenant_id, project_id, event_key, kind, contact_key, payload, available_at
    ) VALUES (
      'a1b2c3d4-0001-4000-8000-000000000001',
      'b1b2c3d4-0001-4000-8000-000000000001',
      'advisor_outbound:' || (event->>'externalId'),
      'advisor_outbound',
      contact_key,
      event,
      now() + interval '30 seconds'
    )
    ON CONFLICT(project_id, event_key) DO NOTHING;
    GET DIAGNOSTICS added = ROW_COUNT;
    count_inserted := count_inserted + added;
  END LOOP;

  RETURN count_inserted;
END;
$function$;

-- Las salidas humanas vencidas se atienden antes que un inbound pendiente del
-- mismo chat. Así una respuesta simultánea del asesor pausa al bot antes de
-- que este alcance a generar otra contestación.
CREATE OR REPLACE FUNCTION public.lv_app_claim(p_token uuid)
RETURNS SETOF public.lv_integration_events
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  chosen public.lv_integration_events;
  batch_limit integer := 10;
BEGIN
  IF NOT public.lv_app_worker_lock(p_token, 'renew') THEN
    RAISE EXCEPTION 'worker lease lost';
  END IF;

  UPDATE public.lv_integration_events
  SET status = 'uncertain', result = jsonb_build_object('reason', 'worker_interrupted')
  WHERE project_id = 'b1b2c3d4-0001-4000-8000-000000000001'
    AND status = 'processing'
    AND claim_token IS DISTINCT FROM p_token;

  SELECT e.* INTO chosen
  FROM public.lv_integration_events e
  WHERE e.project_id = 'b1b2c3d4-0001-4000-8000-000000000001'
    AND e.status = 'pending'
    AND e.available_at <= now()
    AND e.kind <> 'lock'
    AND (
      e.kind <> 'inbound'
      OR NOT EXISTS (
        SELECT 1
        FROM public.lv_integration_events later
        WHERE later.project_id = e.project_id
          AND later.contact_key = e.contact_key
          AND later.status = 'pending'
          AND later.available_at > now()
      )
    )
    AND (
      e.contact_key IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM public.lv_integration_events unresolved
        WHERE unresolved.project_id = e.project_id
          AND unresolved.contact_key = e.contact_key
          AND unresolved.status = 'uncertain'
      )
    )
  ORDER BY
    CASE e.kind WHEN 'advisor_outbound' THEN 0 WHEN 'inbound' THEN 1 ELSE 2 END,
    e.available_at,
    e.id
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN RETURN; END IF;

  IF EXISTS (
    SELECT 1
    FROM public.lv_integration_events e
    WHERE e.project_id = chosen.project_id
      AND e.contact_key = chosen.contact_key
      AND e.status = 'pending'
      AND jsonb_typeof(e.payload->'media') = 'object'
  ) THEN
    batch_limit := 2;
  END IF;

  RETURN QUERY
  UPDATE public.lv_integration_events
  SET status = 'processing', claimed_at = now(), claim_token = p_token
  WHERE id IN (
    SELECT e.id
    FROM public.lv_integration_events e
    WHERE e.id = chosen.id
       OR (
         chosen.kind = 'inbound'
         AND e.project_id = chosen.project_id
         AND e.contact_key = chosen.contact_key
         AND e.status = 'pending'
         AND e.available_at <= now()
       )
    ORDER BY e.received_at, e.id
    LIMIT batch_limit
  )
  RETURNING *;
END;
$function$;

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

  -- Es una actualización independiente del traspaso; el trigger que conserva
  -- la IA en asignaciones automáticas no revierte esta pausa manual.
  UPDATE public.leads
  SET bot_enabled = false,
      seller_first_response_at = coalesce(seller_first_response_at, p_sent_at),
      updated_at = now()
  WHERE id = v_lead.id;

  RETURN jsonb_build_object(
    'handled', true,
    'lead_id', v_lead.id,
    'kommo_id', v_lead.kommo_id,
    'conversation_id', v_conversation.id,
    'advisor_id', v_advisor,
    'message_inserted', v_inserted = 1,
    'author_name', p_author_name
  );
END;
$function$;

CREATE TABLE public.advisor_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'lead_assigned' CHECK (kind IN ('lead_assigned')),
  title text NOT NULL,
  body text NOT NULL,
  assignment_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT advisor_notifications_assignment_uq UNIQUE(lead_id, recipient_id, assignment_at)
);

CREATE INDEX advisor_notifications_recipient_created_idx
  ON public.advisor_notifications(recipient_id, created_at DESC);
CREATE INDEX advisor_notifications_recipient_unread_idx
  ON public.advisor_notifications(recipient_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE public.advisor_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.advisor_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.advisor_notifications TO authenticated;
GRANT UPDATE(read_at) ON public.advisor_notifications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.advisor_notifications TO service_role;

CREATE POLICY advisor_notifications_select_own
ON public.advisor_notifications
FOR SELECT
TO authenticated
USING (recipient_id = auth.uid());

CREATE POLICY advisor_notifications_update_own
ON public.advisor_notifications
FOR UPDATE
TO authenticated
USING (recipient_id = auth.uid())
WITH CHECK (recipient_id = auth.uid());

CREATE OR REPLACE FUNCTION public.lv_notify_lead_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_assignment_at timestamptz;
  v_changed boolean := false;
  v_reason text;
BEGIN
  IF NEW.assigned_to IS NULL OR NEW.tenant_id IS NULL OR NEW.project_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_changed := true;
  ELSE
    v_changed := OLD.assigned_to IS DISTINCT FROM NEW.assigned_to
      OR OLD.handoff_assigned_at IS DISTINCT FROM NEW.handoff_assigned_at;
  END IF;

  IF NOT v_changed THEN RETURN NEW; END IF;

  v_assignment_at := coalesce(NEW.handoff_assigned_at, NEW.updated_at, now());
  v_reason := nullif(trim(coalesce(NEW.handoff_reason, '')), '');

  INSERT INTO public.advisor_notifications(
    tenant_id, project_id, recipient_id, lead_id, kind, title, body,
    assignment_at, metadata
  ) VALUES (
    NEW.tenant_id,
    NEW.project_id,
    NEW.assigned_to,
    NEW.id,
    'lead_assigned',
    'Lead asignado',
    coalesce(nullif(trim(NEW.name), ''), 'Un nuevo lead') ||
      CASE WHEN v_reason IS NULL THEN ' fue asignado a ti.' ELSE ' fue asignado a ti. Motivo: ' || v_reason || '.' END,
    v_assignment_at,
    jsonb_build_object(
      'kommo_id', NEW.kommo_id,
      'handoff_reason', NEW.handoff_reason,
      'lead_status', NEW.status
    )
  )
  ON CONFLICT(lead_id, recipient_id, assignment_at) DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS notify_lead_assignment ON public.leads;
CREATE TRIGGER notify_lead_assignment
AFTER INSERT OR UPDATE OF assigned_to, handoff_assigned_at
ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.lv_notify_lead_assignment();

DO $publication$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (
       SELECT 1
       FROM pg_publication_tables
       WHERE pubname = 'supabase_realtime'
         AND schemaname = 'public'
         AND tablename = 'advisor_notifications'
     ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.advisor_notifications;
  END IF;
END;
$publication$;

REVOKE ALL ON FUNCTION public.lv_app_receive_advisor_outbound(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_record_advisor_outbound(bigint, text, text, text, text, timestamptz, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_notify_lead_assignment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lv_app_receive_advisor_outbound(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.lv_record_advisor_outbound(bigint, text, text, text, text, timestamptz, text) TO service_role;

COMMENT ON TABLE public.advisor_notifications IS
  'Bandeja privada de eventos comerciales; cada fila solo puede verla el asesor recipient_id.';
COMMENT ON FUNCTION public.lv_record_advisor_outbound(bigint, text, text, text, text, timestamptz, text) IS
  'Registra una respuesta manual verificada de Kommo y desactiva el bot del lead.';

COMMIT;
