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
        'Pidió información desde el showroom',
        'Motivo: ' || CASE lower(v_motivo)
          WHEN 'informacion' THEN 'Quiero más información'
          WHEN 'visita' THEN 'Agendar una visita'
          WHEN 'precio' THEN 'Consultar precio / disponibilidad'
          WHEN 'otro' THEN 'Otro'
          ELSE v_motivo
        END,
        CASE WHEN v_unit IS NOT NULL THEN (
          SELECT concat_ws(' · ',
            'Unidad: ' || CASE lower(u.category)
              WHEN 'suite' THEN 'Suite'
              WHEN 'departamento' THEN 'Departamento'
              WHEN 'penthouse' THEN 'Penthouse'
              WHEN 'local' THEN 'Local'
              ELSE 'Unidad'
            END || ' ' || u.unit_number,
            CASE WHEN lower(u.category) <> 'local' AND u.bedrooms IS NOT NULL
              THEN u.bedrooms::text || ' dormitorio' || CASE WHEN u.bedrooms = 1 THEN '' ELSE 's' END
            END,
            nullif(trim(u.floor), '')
          )
          FROM public.units u
          WHERE u.id = v_unit AND u.tenant_id = p_tenant_id
        ) END,
        CASE WHEN v_unit IS NULL THEN
          CASE upper(trim(coalesce(p_typology_code, '')))
            WHEN 'PISCINA' THEN 'Área: Piscina'
            WHEN 'DESCANSO' THEN 'Área: Zona de descanso'
            WHEN 'SPA' THEN 'Área: Spa'
            WHEN 'GYM' THEN 'Área: Gym'
            WHEN 'LOBBY' THEN 'Área: Lobby'
          END
        END,
        CASE WHEN v_mensaje IS NOT NULL THEN 'Mensaje: "' || v_mensaje || '"' END
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

-- Reescribir únicamente las tres solicitudes históricas confirmadas.
WITH legacy AS (
  SELECT i.id, i.tenant_id,
    nullif(trim(split_part(split_part(i.content, E'\n', 1), 'Solicitud showroom: ', 2)), '') AS motivo,
    nullif(trim(substring(i.content FROM E'Mensaje: ([^\n]*)')), '') AS mensaje,
    substring(i.content FROM 'Unidad: ([0-9a-fA-F-]{36})')::uuid AS unit_id,
    upper(trim(substring(i.content FROM E'Tipología: ([^\n]*)'))) AS area_code
  FROM public.lead_interactions i
  WHERE i.type = 'showroom_solicitud'
    AND i.content LIKE 'Solicitud showroom:%'
    AND i.id IN (
      'ccba41bf-e9ca-46ae-902a-349462e76e8b'::uuid,
      '81f4b95b-889a-470e-b3d2-13c9ba1b3d6b'::uuid,
      'e404a75d-abdc-4d98-a1b2-5eec9022a9eb'::uuid
    )
), formatted AS (
  SELECT legacy.id,
    concat_ws(E'\n',
      'Pidió información desde el showroom',
      CASE WHEN legacy.motivo IS NOT NULL THEN 'Motivo: ' || CASE lower(legacy.motivo)
        WHEN 'informacion' THEN 'Quiero más información'
        WHEN 'visita' THEN 'Agendar una visita'
        WHEN 'precio' THEN 'Consultar precio / disponibilidad'
        WHEN 'otro' THEN 'Otro'
        ELSE legacy.motivo
      END END,
      CASE WHEN u.id IS NOT NULL THEN concat_ws(' · ',
        'Unidad: ' || CASE lower(u.category)
          WHEN 'suite' THEN 'Suite'
          WHEN 'departamento' THEN 'Departamento'
          WHEN 'penthouse' THEN 'Penthouse'
          WHEN 'local' THEN 'Local'
          ELSE 'Unidad'
        END || ' ' || u.unit_number,
        CASE WHEN lower(u.category) <> 'local' AND u.bedrooms IS NOT NULL
          THEN u.bedrooms::text || ' dormitorio' || CASE WHEN u.bedrooms = 1 THEN '' ELSE 's' END
        END,
        nullif(trim(u.floor), '')
      ) END,
      CASE WHEN legacy.unit_id IS NULL THEN
        CASE legacy.area_code
          WHEN 'PISCINA' THEN 'Área: Piscina'
          WHEN 'DESCANSO' THEN 'Área: Zona de descanso'
          WHEN 'SPA' THEN 'Área: Spa'
          WHEN 'GYM' THEN 'Área: Gym'
          WHEN 'LOBBY' THEN 'Área: Lobby'
        END
      END,
      CASE WHEN legacy.mensaje IS NOT NULL THEN 'Mensaje: "' || legacy.mensaje || '"' END
    ) AS content
  FROM legacy
  LEFT JOIN public.units u
    ON u.id = legacy.unit_id AND u.tenant_id = legacy.tenant_id
)
UPDATE public.lead_interactions i
SET content = formatted.content
FROM formatted
WHERE i.id = formatted.id AND i.type = 'showroom_solicitud';
