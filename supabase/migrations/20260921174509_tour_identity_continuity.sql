-- Continuidad showroom: identidad phone-first, lead_identificado idempotente,
-- solicitudes con dedupe, sin fusión silenciosa teléfono/correo ni reasignación de visitante.
-- Aditiva y revisable. No fusiona leads históricos ambiguos.

-- ── Solicitudes del showroom (motivo / mensaje / unidad) ─────────────────────
CREATE TABLE IF NOT EXISTS public.tour_info_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  visitor_id uuid REFERENCES public.tour_visitors(id) ON DELETE SET NULL,
  tour_session_id uuid REFERENCES public.tour_sessions(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES public.units(id) ON DELETE SET NULL,
  unit_type_id uuid,
  typology_code text,
  motivo text NOT NULL,
  mensaje text,
  client_request_id text NOT NULL,
  request_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tour_info_requests_client_id_uq UNIQUE (tenant_id, client_request_id)
);

CREATE INDEX IF NOT EXISTS tour_info_requests_lead_created_idx
  ON public.tour_info_requests (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tour_info_requests_fingerprint_idx
  ON public.tour_info_requests (tenant_id, lead_id, request_fingerprint, created_at DESC);

COMMENT ON TABLE public.tour_info_requests IS
  'Solicitudes del showroom 360 vinculadas a un lead; client_request_id garantiza idempotencia.';

ALTER TABLE public.tour_info_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tour_info_requests_service ON public.tour_info_requests;
CREATE POLICY tour_info_requests_service ON public.tour_info_requests
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS tour_info_requests_select_auth ON public.tour_info_requests;
CREATE POLICY tour_info_requests_select_auth ON public.tour_info_requests
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leads l
      WHERE l.id = tour_info_requests.lead_id
    )
  );

REVOKE ALL ON TABLE public.tour_info_requests FROM PUBLIC;
REVOKE ALL ON TABLE public.tour_info_requests FROM anon;
REVOKE ALL ON TABLE public.tour_info_requests FROM authenticated;
GRANT SELECT ON TABLE public.tour_info_requests TO authenticated;
GRANT ALL ON TABLE public.tour_info_requests TO service_role;

-- ── Identidad: phone-first, conflictos explícitos, un solo lead_identificado ──
CREATE OR REPLACE FUNCTION public.identify_tour_lead(
  p_tenant_id uuid,
  p_visitor_key text,
  p_name text,
  p_email text,
  p_phone text,
  p_project_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_visitor uuid;
  v_lead uuid;
  v_phone text := public.normalize_phone(p_phone);
  v_email_raw text := nullif(lower(trim(coalesce(p_email, ''))), '');
  v_email text;
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_artificial_email boolean;
  v_artificial_name boolean;
  v_existing_visitor_lead uuid;
  v_phone_lead uuid;
  v_email_lead uuid;
  v_first record;
  v_was_anonymous boolean;
  v_linked_phone text;
BEGIN
  IF p_tenant_id IS NULL OR nullif(trim(coalesce(p_visitor_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'IDENTIFY_TOUR_LEAD_INVALID_ARGS';
  END IF;
  IF v_phone IS NULL THEN
    RAISE EXCEPTION 'IDENTIFY_TOUR_LEAD_PHONE_REQUIRED';
  END IF;

  v_artificial_email :=
    v_email_raw IS NULL
    OR v_email_raw ~* '@showroom\.lavilet$'
    OR v_email_raw ~* '^wa\.[0-9]+@';
  v_email := CASE WHEN v_artificial_email THEN NULL ELSE v_email_raw END;

  v_artificial_name :=
    v_name IS NULL
    OR v_name ~* '^whatsapp';

  INSERT INTO public.tour_visitors (tenant_id, visitor_key)
  VALUES (p_tenant_id, trim(p_visitor_key))
  ON CONFLICT (tenant_id, visitor_key) DO UPDATE
    SET last_seen_at = now()
  RETURNING id, lead_id INTO v_visitor, v_existing_visitor_lead;

  -- Releer lead_id por si ON CONFLICT no devolvió la fila completa en algún entorno.
  SELECT tv.lead_id INTO v_existing_visitor_lead
  FROM public.tour_visitors tv
  WHERE tv.id = v_visitor;

  SELECT s.*
  INTO v_first
  FROM public.tour_sessions s
  WHERE s.visitor_id = v_visitor
  ORDER BY s.started_at ASC
  LIMIT 1;

  SELECT l.id INTO v_phone_lead
  FROM public.leads l
  WHERE l.tenant_id = p_tenant_id
    AND l.phone_normalized = v_phone
  ORDER BY l.created_at ASC
  LIMIT 1;

  IF v_email IS NOT NULL THEN
    SELECT l.id INTO v_email_lead
    FROM public.leads l
    WHERE l.tenant_id = p_tenant_id
      AND lower(l.email) = v_email
      AND coalesce(l.email, '') !~* '@showroom\.lavilet$'
      AND coalesce(l.email, '') !~* '^wa\.[0-9]+@'
    ORDER BY l.created_at ASC
    LIMIT 1;
  END IF;

  IF v_phone_lead IS NOT NULL
     AND v_email_lead IS NOT NULL
     AND v_phone_lead <> v_email_lead THEN
    RAISE EXCEPTION 'IDENTITY_CONFLICT_PHONE_EMAIL';
  END IF;

  v_lead := coalesce(v_phone_lead, v_email_lead);

  IF v_existing_visitor_lead IS NOT NULL THEN
    IF v_lead IS NOT NULL AND v_existing_visitor_lead <> v_lead THEN
      RAISE EXCEPTION 'VISITOR_ALREADY_LINKED';
    END IF;

    -- Datos nuevos que crearían otro lead (u otro teléfono) no reasignan el historial.
    IF v_lead IS NULL THEN
      SELECT l.phone_normalized INTO v_linked_phone
      FROM public.leads l
      WHERE l.id = v_existing_visitor_lead;

      IF v_phone IS DISTINCT FROM v_linked_phone THEN
        RAISE EXCEPTION 'VISITOR_ALREADY_LINKED';
      END IF;
    END IF;

    v_lead := v_existing_visitor_lead;
  END IF;

  v_was_anonymous := (v_existing_visitor_lead IS NULL);

  IF v_lead IS NULL THEN
    INSERT INTO public.leads (
      tenant_id, project_id, name, email, phone, phone_normalized,
      source, channel_origin,
      first_utm_source, first_utm_medium, first_utm_campaign,
      first_salesperson_ref, first_landing_path, first_touch_at, city, country
    ) VALUES (
      p_tenant_id,
      p_project_id,
      coalesce(v_name, 'Visitante showroom'),
      coalesce(v_email_raw, ''),
      p_phone,
      v_phone,
      'showroom_360',
      'web',
      v_first.utm_source,
      v_first.utm_medium,
      v_first.utm_campaign,
      v_first.salesperson_ref,
      v_first.landing_path,
      v_first.started_at,
      v_first.city,
      v_first.country
    )
    RETURNING id INTO v_lead;
  ELSE
    UPDATE public.leads SET
      name = CASE
        WHEN NOT v_artificial_name AND (name IS NULL OR name ~* '^whatsapp') THEN v_name
        ELSE name
      END,
      email = CASE
        WHEN v_email IS NOT NULL
             AND (email IS NULL OR email = '' OR email ~* '@showroom\.lavilet$' OR email ~* '^wa\.[0-9]+@')
          THEN v_email
        ELSE email
      END,
      phone = coalesce(nullif(phone, ''), p_phone),
      phone_normalized = coalesce(phone_normalized, v_phone),
      updated_at = now()
    WHERE id = v_lead;
  END IF;

  UPDATE public.tour_visitors
  SET lead_id = v_lead, last_seen_at = now()
  WHERE id = v_visitor;

  -- Solo actividad de ESTE visitante; no copia eventos ni reasigna otros dispositivos.
  UPDATE public.tour_events
  SET lead_id = v_lead
  WHERE visitor_id = v_visitor
    AND (lead_id IS NULL OR lead_id = v_lead);

  UPDATE public.tour_sessions
  SET lead_id = v_lead
  WHERE visitor_id = v_visitor
    AND (lead_id IS NULL OR lead_id = v_lead);

  IF v_was_anonymous AND v_first.id IS NOT NULL THEN
    INSERT INTO public.tour_events (tour_session_id, visitor_id, lead_id, event_type, metadata)
    SELECT v_first.id, v_visitor, v_lead, 'lead_identificado', jsonb_build_object('source', 'identify_tour_lead')
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.tour_events e
      WHERE e.visitor_id = v_visitor
        AND e.event_type = 'lead_identificado'
    );
  END IF;

  UPDATE public.leads
  SET last_interaction_at = now()
  WHERE id = v_lead;

  RETURN v_lead;
END;
$function$;

COMMENT ON FUNCTION public.identify_tour_lead(uuid, text, text, text, text, uuid) IS
  'Resuelve lead por teléfono (prioridad) y correo real; conflicto explícito; un lead_identificado por visitante.';

-- ── Registrar solicitud (idempotente) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.register_tour_info_request(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_visitor_key text DEFAULT NULL,
  p_session_id uuid DEFAULT NULL,
  p_unit_id uuid DEFAULT NULL,
  p_unit_type_id uuid DEFAULT NULL,
  p_typology_code text DEFAULT NULL,
  p_motivo text DEFAULT NULL,
  p_mensaje text DEFAULT NULL,
  p_client_request_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_visitor uuid;
  v_session uuid;
  v_unit uuid;
  v_motivo text;
  v_mensaje text;
  v_client_id text;
  v_fingerprint text;
  v_existing public.tour_info_requests%ROWTYPE;
  v_row public.tour_info_requests%ROWTYPE;
  v_created boolean := false;
BEGIN
  IF p_tenant_id IS NULL OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'TOUR_INFO_REQUEST_INVALID_ARGS';
  END IF;

  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = p_lead_id
    AND tenant_id = p_tenant_id;

  IF v_lead.id IS NULL THEN
    RAISE EXCEPTION 'TOUR_INFO_REQUEST_LEAD_TENANT_MISMATCH';
  END IF;

  v_motivo := nullif(trim(coalesce(p_motivo, '')), '');
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'TOUR_INFO_REQUEST_MOTIVO_REQUIRED';
  END IF;
  v_mensaje := nullif(trim(coalesce(p_mensaje, '')), '');

  v_client_id := nullif(trim(coalesce(p_client_request_id, '')), '');
  -- Idempotencia solo por client_request_id (reintento/doble clic).
  -- Contenido idéntico con otro client_request_id = nueva solicitud intencional.
  IF v_client_id IS NULL THEN
    v_client_id := gen_random_uuid()::text;
  END IF;

  v_fingerprint := md5(
    coalesce(p_lead_id::text, '') || '|' ||
    coalesce(p_unit_id::text, '') || '|' ||
    v_motivo || '|' ||
    coalesce(v_mensaje, '')
  );

  SELECT * INTO v_existing
  FROM public.tour_info_requests r
  WHERE r.tenant_id = p_tenant_id
    AND r.client_request_id = v_client_id
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', v_existing.id,
      'lead_id', v_existing.lead_id,
      'created', false,
      'duplicate', true
    );
  END IF;

  IF nullif(trim(coalesce(p_visitor_key, '')), '') IS NOT NULL THEN
    SELECT tv.id INTO v_visitor
    FROM public.tour_visitors tv
    WHERE tv.tenant_id = p_tenant_id
      AND tv.visitor_key = trim(p_visitor_key)
    LIMIT 1;

    IF v_visitor IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.tour_visitors tv
      WHERE tv.id = v_visitor
        AND tv.lead_id IS NOT NULL
        AND tv.lead_id <> p_lead_id
    ) THEN
      RAISE EXCEPTION 'TOUR_INFO_REQUEST_VISITOR_OTHER_LEAD';
    END IF;
  END IF;

  IF p_session_id IS NOT NULL THEN
    SELECT s.id INTO v_session
    FROM public.tour_sessions s
    WHERE s.id = p_session_id
      AND s.tenant_id = p_tenant_id
      AND (v_visitor IS NULL OR s.visitor_id = v_visitor)
      AND (s.lead_id IS NULL OR s.lead_id = p_lead_id)
    LIMIT 1;

    IF v_session IS NULL THEN
      RAISE EXCEPTION 'TOUR_INFO_REQUEST_SESSION_INVALID';
    END IF;
  END IF;

  IF p_unit_id IS NOT NULL THEN
    SELECT u.id INTO v_unit
    FROM public.units u
    WHERE u.id = p_unit_id
      AND u.tenant_id = p_tenant_id
    LIMIT 1;

    IF v_unit IS NULL THEN
      RAISE EXCEPTION 'TOUR_INFO_REQUEST_UNIT_INVALID';
    END IF;
  END IF;

  INSERT INTO public.tour_info_requests (
    tenant_id, lead_id, visitor_id, tour_session_id,
    unit_id, unit_type_id, typology_code,
    motivo, mensaje, client_request_id, request_fingerprint
  ) VALUES (
    p_tenant_id, p_lead_id, v_visitor, v_session,
    v_unit, p_unit_type_id, nullif(trim(coalesce(p_typology_code, '')), ''),
    v_motivo, v_mensaje, v_client_id, v_fingerprint
  )
  ON CONFLICT (tenant_id, client_request_id) DO NOTHING
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    SELECT * INTO v_row
    FROM public.tour_info_requests r
    WHERE r.tenant_id = p_tenant_id
      AND r.client_request_id = v_client_id
    LIMIT 1;

    RETURN jsonb_build_object(
      'id', v_row.id,
      'lead_id', v_row.lead_id,
      'created', false,
      'duplicate', true
    );
  END IF;

  v_created := true;

  IF v_unit IS NOT NULL THEN
    INSERT INTO public.lead_units (lead_id, unit_id, priority, source, interest_level, updated_at)
    VALUES (p_lead_id, v_unit, 0, 'web', 'consulto', now())
    ON CONFLICT (lead_id, unit_id) DO UPDATE
      SET interest_level = EXCLUDED.interest_level,
          updated_at = now();
  END IF;

  INSERT INTO public.lead_interactions (tenant_id, lead_id, type, content, channel, result)
  VALUES (
    p_tenant_id,
    p_lead_id,
    'showroom_solicitud',
    trim(
      both E'\n' FROM
      concat_ws(
        E'\n',
        'Solicitud showroom: ' || v_motivo,
        CASE WHEN v_mensaje IS NOT NULL THEN 'Mensaje: ' || v_mensaje END,
        CASE WHEN v_unit IS NOT NULL THEN 'Unidad: ' || v_unit::text END,
        CASE WHEN nullif(trim(coalesce(p_typology_code, '')), '') IS NOT NULL
          THEN 'Tipología: ' || trim(p_typology_code) END
      )
    ),
    'web',
    'registrada'
  );

  UPDATE public.leads
  SET last_interaction_at = now()
  WHERE id = p_lead_id;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'lead_id', v_row.lead_id,
    'created', v_created,
    'duplicate', false
  );
END;
$function$;

COMMENT ON FUNCTION public.register_tour_info_request(
  uuid, uuid, text, uuid, uuid, uuid, text, text, text, text
) IS
  'Registra solicitud showroom; idempotencia solo por client_request_id (contenido idéntico con otro id = nueva).';

REVOKE ALL ON FUNCTION public.register_tour_info_request(
  uuid, uuid, text, uuid, uuid, uuid, text, text, text, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_tour_info_request(
  uuid, uuid, text, uuid, uuid, uuid, text, text, text, text
) FROM anon;
REVOKE ALL ON FUNCTION public.register_tour_info_request(
  uuid, uuid, text, uuid, uuid, uuid, text, text, text, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.register_tour_info_request(
  uuid, uuid, text, uuid, uuid, uuid, text, text, text, text
) TO service_role;
