-- Coordinación de visitas: candidatos, asignación, holds y confirmación atómica.
-- NO recrea appointment_reschedule_requests ni lv_appointment_bot_*.
-- NO aplica la exclusión gist de solapes (ver 20260907220000).
-- No aplicar en producción desde el agente.
-- Reversión: 20260907210000_agenda_coordination_down.sql
--
-- Autorización: is_admin() = profiles.role = 'admin', sin tenant ni proyecto.
-- En La Vilet hay un solo tenant; el administrador es global. No existe tabla de
-- pertenencia de admin a proyecto: no se inventa.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS meeting_place text;

ALTER TABLE public.project_salespeople
  ADD COLUMN IF NOT EXISTS receives_bot_appointments boolean;

UPDATE public.project_salespeople
SET receives_bot_appointments = receives_leads
WHERE receives_bot_appointments IS NULL;

ALTER TABLE public.project_salespeople
  ALTER COLUMN receives_bot_appointments SET DEFAULT false,
  ALTER COLUMN receives_bot_appointments SET NOT NULL;

ALTER TABLE public.project_automation_config
  ADD COLUMN IF NOT EXISTS visit_location_url text,
  ADD COLUMN IF NOT EXISTS review_sla_minutes integer,
  ADD COLUMN IF NOT EXISTS proposal_hold_minutes integer,
  ADD COLUMN IF NOT EXISTS max_auto_reassignments integer;

-- Columna nueva: no toca sla_response_minutes (SLA de handoff).
UPDATE public.project_automation_config
SET
  review_sla_minutes = COALESCE(review_sla_minutes, 90),
  proposal_hold_minutes = COALESCE(proposal_hold_minutes, 120),
  max_auto_reassignments = COALESCE(max_auto_reassignments, 3)
WHERE true;

ALTER TABLE public.project_automation_config
  ALTER COLUMN review_sla_minutes SET DEFAULT 90,
  ALTER COLUMN proposal_hold_minutes SET DEFAULT 120,
  ALTER COLUMN max_auto_reassignments SET DEFAULT 3;

COMMENT ON COLUMN public.project_automation_config.review_sla_minutes IS
  'SLA de revisión de propuestas de cita (minutos de espera de acción del asesor). Distinto de sla_response_minutes (handoff).';
COMMENT ON COLUMN public.project_automation_config.sla_response_minutes IS
  'SLA de handoff / primera respuesta comercial. No usarlo para citas.';
COMMENT ON COLUMN public.project_automation_config.business_hours IS
  'Jornada del proyecto. También la consume is_project_open (handoff). Cambiarla afecta visitas y traspaso.';

-- Solo EDIFICIO LA VILET. No reescribe sla_response_minutes ni copia el mapa a otros proyectos.
UPDATE public.project_automation_config
SET
  timezone = 'America/Guayaquil',
  business_hours = '{
    "1":{"open":"08:30","close":"18:30"},
    "2":{"open":"08:30","close":"18:30"},
    "3":{"open":"08:30","close":"18:30"},
    "4":{"open":"08:30","close":"18:30"},
    "5":{"open":"08:30","close":"18:30"},
    "6":{"open":"09:30","close":"13:30"}
  }'::jsonb,
  review_sla_minutes = 90,
  visit_location_url = COALESCE(visit_location_url, 'https://maps.app.goo.gl/cjkNv7c4siehTqAN9')
WHERE tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001'
  AND project_id = 'b1b2c3d4-0001-4000-8000-000000000001';

CREATE TABLE IF NOT EXISTS public.project_salesperson_time_off (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  salesperson_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS public.appointment_time_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  request_id uuid REFERENCES public.appointment_reschedule_requests(id) ON DELETE CASCADE,
  advisor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);

DROP INDEX IF EXISTS public.appointment_time_holds_advisor_idx;
CREATE INDEX IF NOT EXISTS appointment_time_holds_advisor_window_idx
  ON public.appointment_time_holds (advisor_id, start_time, end_time);
CREATE INDEX IF NOT EXISTS appointment_time_holds_expires_idx
  ON public.appointment_time_holds (expires_at);

CREATE TABLE IF NOT EXISTS public.lv_appointment_assignment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  request_id uuid REFERENCES public.appointment_reschedule_requests(id) ON DELETE SET NULL,
  from_advisor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  to_advisor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  reason text,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.appointment_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE OR REPLACE FUNCTION public.lv_appointment_overlap_blockers()
RETURNS TABLE (
  appointment_id_a uuid,
  appointment_id_b uuid,
  responsible_id uuid,
  start_a timestamptz,
  end_a timestamptz,
  start_b timestamptz,
  end_b timestamptz,
  status_a text,
  status_b text
)
LANGUAGE sql
STABLE
SET search_path TO public
AS $function$
  SELECT a.id, b.id, a.responsible_id,
         a.start_time, a.end_time, b.start_time, b.end_time, a.status, b.status
  FROM public.appointments a
  JOIN public.appointments b
    ON a.responsible_id = b.responsible_id
   AND a.id < b.id
   AND a.responsible_id IS NOT NULL
   AND a.start_time IS NOT NULL AND a.end_time IS NOT NULL
   AND b.start_time IS NOT NULL AND b.end_time IS NOT NULL
   AND a.status IN ('pendiente', 'aceptado', 'reprogramado')
   AND b.status IN ('pendiente', 'aceptado', 'reprogramado')
   AND tstzrange(a.start_time, a.end_time, '[)') && tstzrange(b.start_time, b.end_time, '[)');
$function$;

CREATE OR REPLACE FUNCTION public.lv_lock_project(p_tenant_id uuid, p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Falta tenant para el bloqueo';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || coalesce(p_project_id::text, ''), 0)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_shares_project(p_project_id uuid, p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_salespeople ps
    WHERE ps.salesperson_id = auth.uid()
      AND ps.project_id = p_project_id
      AND ps.tenant_id = p_tenant_id
  );
$function$;

CREATE OR REPLACE FUNCTION public.lv_can_coordinate()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
  SELECT public.is_admin();
$function$;

CREATE OR REPLACE FUNCTION public.lv_interval_within_business_hours(
  p_project_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  c public.project_automation_config;
  local_start timestamp;
  local_end timestamp;
  slot jsonb;
BEGIN
  IF p_start IS NULL OR p_end IS NULL OR p_end <= p_start THEN
    RETURN false;
  END IF;
  SELECT * INTO c FROM public.project_automation_config WHERE project_id = p_project_id;
  IF NOT FOUND OR NOT c.is_active THEN
    RETURN false;
  END IF;
  local_start := p_start AT TIME ZONE c.timezone;
  local_end := p_end AT TIME ZONE c.timezone;
  IF local_start::date IS DISTINCT FROM local_end::date THEN
    RETURN false;
  END IF;
  slot := c.business_hours -> extract(isodow FROM local_start)::int::text;
  IF slot IS NULL THEN
    RETURN false;
  END IF;
  RETURN local_start::time >= (slot->>'open')::time
     AND local_end::time <= (slot->>'close')::time;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_assert_visit_slot(
  p_project_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
BEGIN
  IF p_start IS NULL OR p_end IS NULL THEN
    RAISE EXCEPTION 'Indica inicio y fin de la visita';
  END IF;
  IF p_end IS DISTINCT FROM (p_start + interval '60 minutes') THEN
    RAISE EXCEPTION 'La visita dura exactamente 60 minutos';
  END IF;
  IF p_start <= now() THEN
    RAISE EXCEPTION 'El inicio debe ser futuro';
  END IF;
  IF NOT public.lv_interval_within_business_hours(p_project_id, p_start, p_end) THEN
    RAISE EXCEPTION 'El horario está fuera de la jornada';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_advisor_has_conflict(
  p_advisor_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_exclude_appointment uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
  SELECT
    p_start IS NOT NULL
    AND p_end IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.appointments a
        WHERE a.responsible_id = p_advisor_id
          AND a.id IS DISTINCT FROM p_exclude_appointment
          AND a.status IN ('pendiente', 'aceptado', 'reprogramado')
          AND a.start_time IS NOT NULL
          AND a.end_time IS NOT NULL
          AND a.start_time < p_end
          AND a.end_time > p_start
      )
      OR EXISTS (
        SELECT 1
        FROM public.appointment_time_holds h
        WHERE h.advisor_id = p_advisor_id
          AND h.appointment_id IS DISTINCT FROM p_exclude_appointment
          AND h.expires_at > now()
          AND h.start_time < p_end
          AND h.end_time > p_start
      )
      OR EXISTS (
        SELECT 1
        FROM public.project_salesperson_time_off t
        WHERE t.salesperson_id = p_advisor_id
          AND t.starts_at < p_end
          AND t.ends_at > p_start
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.lv_advisor_eligible_on_project(
  p_advisor_id uuid,
  p_tenant_id uuid,
  p_project_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_salespeople ps
    JOIN public.profiles p ON p.id = ps.salesperson_id
    WHERE ps.salesperson_id = p_advisor_id
      AND ps.tenant_id = p_tenant_id
      AND ps.project_id = p_project_id
      AND coalesce(p.is_active, true)
      AND p.role IN ('asesor', 'admin')
  );
$function$;

CREATE OR REPLACE FUNCTION public.lv_list_eligible_bot_advisors(
  p_tenant_id uuid,
  p_project_id uuid,
  p_start timestamptz DEFAULT NULL,
  p_end timestamptz DEFAULT NULL,
  p_exclude_appointment uuid DEFAULT NULL
)
RETURNS uuid[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_ids uuid[];
BEGIN
  SELECT coalesce(array_agg(ps.salesperson_id ORDER BY ps.salesperson_id), ARRAY[]::uuid[])
  INTO v_ids
  FROM public.project_salespeople ps
  JOIN public.profiles p ON p.id = ps.salesperson_id
  WHERE ps.tenant_id = p_tenant_id
    AND ps.project_id = p_project_id
    AND ps.receives_bot_appointments
    AND coalesce(p.is_active, true)
    AND p.role IN ('asesor', 'admin')
    AND (
      p_start IS NULL
      OR (
        public.lv_interval_within_business_hours(p_project_id, p_start, p_end)
        AND NOT public.lv_advisor_has_conflict(ps.salesperson_id, p_start, p_end, p_exclude_appointment)
      )
    );
  RETURN coalesce(v_ids, ARRAY[]::uuid[]);
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_pick_fair_advisor(
  p_tenant_id uuid,
  p_project_id uuid,
  p_candidates uuid[]
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
  SELECT candidates.advisor_id
  FROM (SELECT DISTINCT x AS advisor_id FROM unnest(p_candidates) AS x) candidates
  LEFT JOIN public.lv_appointment_bot_assignment_history h
    ON h.tenant_id = p_tenant_id
   AND h.project_id = p_project_id
   AND h.advisor_id = candidates.advisor_id
  GROUP BY candidates.advisor_id
  ORDER BY count(DISTINCT h.appointment_id) ASC,
           max(h.assigned_at) ASC NULLS FIRST,
           candidates.advisor_id ASC
  LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.lv_upsert_hold(
  p_request public.appointment_reschedule_requests
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_hold_min integer;
BEGIN
  DELETE FROM public.appointment_time_holds WHERE request_id = p_request.id;
  IF p_request.proposed_start_time IS NULL OR p_request.assigned_advisor_id IS NULL THEN
    RETURN;
  END IF;
  SELECT coalesce(proposal_hold_minutes, 120) INTO v_hold_min
  FROM public.project_automation_config
  WHERE project_id = p_request.project_id;
  INSERT INTO public.appointment_time_holds (
    tenant_id, project_id, appointment_id, request_id, advisor_id,
    start_time, end_time, expires_at
  ) VALUES (
    p_request.tenant_id,
    p_request.project_id,
    p_request.appointment_id,
    p_request.id,
    p_request.assigned_advisor_id,
    p_request.proposed_start_time,
    p_request.proposed_end_time,
    coalesce(p_request.expires_at, now() + make_interval(mins => coalesce(v_hold_min, 120)))
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_assign_appointment_fairly(
  p_request_id uuid,
  p_candidate_advisor_ids uuid[]
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO pg_catalog, public
AS $function$
DECLARE
  v_request public.appointment_reschedule_requests%ROWTYPE;
  v_assignment public.lv_appointment_bot_assignments%ROWTYPE;
  v_appointment public.appointments%ROWTYPE;
  v_advisor_id uuid;
  v_sla integer;
  v_tenant uuid;
  v_project uuid;
BEGIN
  SELECT tenant_id, project_id INTO v_tenant, v_project
  FROM public.appointment_reschedule_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'La solicitud no existe';
  END IF;
  PERFORM public.lv_lock_project(v_tenant, v_project);

  SELECT * INTO v_request FROM public.appointment_reschedule_requests WHERE id = p_request_id FOR UPDATE;
  SELECT * INTO v_appointment FROM public.appointments WHERE id = v_request.appointment_id FOR UPDATE;

  IF v_request.status NOT IN ('awaiting_advisor', 'awaiting_client') THEN
    RAISE EXCEPTION 'La propuesta ya no está abierta';
  END IF;

  SELECT * INTO v_assignment
  FROM public.lv_appointment_bot_assignments
  WHERE appointment_id = v_request.appointment_id
  FOR UPDATE;

  IF FOUND THEN
    IF v_assignment.tenant_id <> v_request.tenant_id OR v_assignment.project_id <> v_request.project_id THEN
      RAISE EXCEPTION 'La asignación tiene un contexto incorrecto';
    END IF;
    UPDATE public.appointment_reschedule_requests
    SET assigned_advisor_id = v_assignment.advisor_id,
        assigned_at = coalesce(v_request.assigned_at, v_assignment.assigned_at)
    WHERE id = p_request_id;
    UPDATE public.appointments
    SET responsible_id = v_assignment.advisor_id, updated_at = now()
    WHERE id = v_appointment.id AND responsible_id IS DISTINCT FROM v_assignment.advisor_id;
    RETURN v_assignment.advisor_id;
  END IF;

  SELECT coalesce(review_sla_minutes, 90) INTO v_sla
  FROM public.project_automation_config WHERE project_id = v_request.project_id;

  IF v_request.request_type = 'reschedule' THEN
    IF v_appointment.responsible_id IS NULL THEN
      RAISE EXCEPTION 'La cita existente requiere registrar su responsable antes de repartir';
    END IF;
    v_advisor_id := v_appointment.responsible_id;
    INSERT INTO public.lv_appointment_bot_assignments (appointment_id, tenant_id, project_id, advisor_id)
    VALUES (v_request.appointment_id, v_request.tenant_id, v_request.project_id, v_advisor_id);
    -- Reprogramar no incrementa el contador de oportunidades del bot.
    INSERT INTO public.lv_appointment_assignment_events (
      tenant_id, project_id, appointment_id, request_id, to_advisor_id, action, reason
    ) VALUES (
      v_request.tenant_id, v_request.project_id, v_request.appointment_id, p_request_id, v_advisor_id, 'adopted', 'reschedule_existing_responsible'
    );
    UPDATE public.appointment_reschedule_requests
    SET assigned_advisor_id = v_advisor_id,
        assigned_at = now(),
        escalation_due_at = now() + make_interval(mins => coalesce(v_sla, 90))
    WHERE id = p_request_id;
    PERFORM public.lv_upsert_hold((SELECT r FROM public.appointment_reschedule_requests r WHERE r.id = p_request_id));
    RETURN v_advisor_id;
  END IF;

  IF v_request.assigned_advisor_id IS NOT NULL OR v_request.advisor_accepted_at IS NOT NULL THEN
    RAISE EXCEPTION 'La solicitud ya tiene responsable o aceptación; revisar su asignación';
  END IF;

  -- p_candidate_advisor_ids se ignora: el servidor calcula elegibles.
  v_advisor_id := public.lv_pick_fair_advisor(
    v_request.tenant_id,
    v_request.project_id,
    public.lv_list_eligible_bot_advisors(
      v_request.tenant_id,
      v_request.project_id,
      v_request.proposed_start_time,
      v_request.proposed_end_time,
      v_request.appointment_id
    )
  );

  IF v_advisor_id IS NULL THEN
    INSERT INTO public.lv_appointment_assignment_events (
      tenant_id, project_id, appointment_id, request_id, action, reason
    ) VALUES (
      v_request.tenant_id, v_request.project_id, v_request.appointment_id, p_request_id,
      'unassigned_pending_coordination', 'no_eligible_advisors'
    );
    UPDATE public.appointment_reschedule_requests
    SET escalation_due_at = coalesce(
          v_request.escalation_due_at,
          now() + make_interval(mins => coalesce(v_sla, 90))
        )
    WHERE id = p_request_id;
    RETURN NULL;
  END IF;

  INSERT INTO public.lv_appointment_bot_assignments (appointment_id, tenant_id, project_id, advisor_id)
  VALUES (v_request.appointment_id, v_request.tenant_id, v_request.project_id, v_advisor_id);

  INSERT INTO public.lv_appointment_bot_assignment_history (
    tenant_id, project_id, appointment_id, request_id, advisor_id, reason
  ) VALUES (
    v_request.tenant_id, v_request.project_id, v_request.appointment_id, p_request_id, v_advisor_id, 'initial_assignment'
  );

  INSERT INTO public.lv_appointment_assignment_events (
    tenant_id, project_id, appointment_id, request_id, to_advisor_id, action, reason
  ) VALUES (
    v_request.tenant_id, v_request.project_id, v_request.appointment_id, p_request_id, v_advisor_id, 'assigned', 'fair'
  );

  UPDATE public.appointment_reschedule_requests
  SET assigned_advisor_id = v_advisor_id,
      assigned_at = now(),
      escalation_due_at = now() + make_interval(mins => coalesce(v_sla, 90))
  WHERE id = p_request_id;

  UPDATE public.appointments
  SET responsible_id = v_advisor_id, updated_at = now()
  WHERE id = v_appointment.id;

  PERFORM public.lv_upsert_hold((SELECT r FROM public.appointment_reschedule_requests r WHERE r.id = p_request_id));
  RETURN v_advisor_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_cancel_pending_visit_outbox(p_appointment_id uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_count integer := 0;
BEGIN
  UPDATE public.lv_outbox
  SET
    status = 'cancelled',
    detail = coalesce(p_reason, 'cancelado desde agenda'),
    dedupe_key = dedupe_key || ':cancelled:' || id::text
  WHERE appointment_id = p_appointment_id
    AND status = 'pending'
    AND kind IN ('visit_2h', 'visit_confirm', 'visit_propose', 'visit_reschedule_confirm');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.appointment_reminders_paused(p_appointment_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.appointment_reschedule_requests r
    WHERE r.appointment_id = p_appointment_id
      AND r.status IN ('awaiting_advisor', 'awaiting_client')
  );
$function$;

CREATE OR REPLACE FUNCTION public.lv_format_visit_clock(p_at timestamptz)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  h integer;
  m integer;
  suffix text;
  hour12 integer;
  article text;
  minutes text;
BEGIN
  h := extract(hour FROM (p_at AT TIME ZONE 'America/Guayaquil'));
  m := extract(minute FROM (p_at AT TIME ZONE 'America/Guayaquil'));
  suffix := CASE WHEN h >= 12 THEN 'p. m.' ELSE 'a. m.' END;
  hour12 := CASE WHEN h % 12 = 0 THEN 12 ELSE h % 12 END;
  article := CASE WHEN hour12 = 1 THEN 'a la' ELSE 'a las' END;
  minutes := CASE WHEN m = 0 THEN '' ELSE ':' || lpad(m::text, 2, '0') END;
  RETURN article || ' ' || hour12::text || minutes || ' ' || suffix;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_format_visit_date(p_at timestamptz)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  local_ts timestamp;
  dow integer;
  day_n integer;
  month_n integer;
  day_name text;
  month_name text;
BEGIN
  local_ts := p_at AT TIME ZONE 'America/Guayaquil';
  dow := extract(isodow FROM local_ts)::int;
  day_n := extract(day FROM local_ts)::int;
  month_n := extract(month FROM local_ts)::int;
  day_name := (ARRAY['lunes','martes','miércoles','jueves','viernes','sábado','domingo'])[dow];
  month_name := (ARRAY['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[month_n];
  RETURN 'el ' || day_name || ' ' || day_n::text || ' de ' || month_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_format_visit_when(p_at timestamptz)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT public.lv_format_visit_date(p_at) || ' ' || public.lv_format_visit_clock(p_at);
$function$;

CREATE OR REPLACE FUNCTION public.lv_build_visit_confirm_message(
  p_lead_name text,
  p_advisor_name text,
  p_start timestamptz,
  p_location_url text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $function$
DECLARE
  v_first text;
  v_url text;
BEGIN
  v_first := coalesce(nullif(trim(split_part(coalesce(p_lead_name, ''), ' ', 1)), ''), 'cliente');
  v_url := nullif(trim(p_location_url), '');
  RETURN 'Perfecto, ' || v_first || '. Le esperamos ' || public.lv_format_visit_when(p_start) ||
    ' con ' || coalesce(nullif(trim(p_advisor_name), ''), 'nuestro equipo') ||
    ', de nuestro equipo. Será un gusto recibirle y mostrarle el proyecto.' ||
    CASE
      WHEN v_url IS NULL THEN ''
      ELSE E' Aquí puede ver nuestra ubicación:\n' || v_url
    END ||
    E'\nSi necesita alguna indicación, puede escribirnos por aquí. ¡Muchas gracias!';
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_enqueue_visit_outbox(
  p_appointment public.appointments,
  p_request public.appointment_reschedule_requests,
  p_kind text,
  p_detail text,
  p_location text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_id uuid;
  v_rev text;
  v_key text;
BEGIN
  IF p_appointment.lead_id IS NULL OR p_appointment.project_id IS NULL THEN
    RETURN NULL;
  END IF;
  v_rev := md5(p_request.id::text || ':' || coalesce(p_request.proposed_start_time::text, '') || ':' || p_kind);
  v_key := p_appointment.id::text || ':' || v_rev || ':' || p_kind;
  INSERT INTO public.lv_outbox (
    project_id, tenant_id, lead_id, kind, dedupe_key, appointment_id, revision,
    scheduled_at, expires_at, priority, payload, status, next_attempt_at
  ) VALUES (
    p_appointment.project_id,
    p_appointment.tenant_id,
    p_appointment.lead_id,
    p_kind,
    v_key,
    p_appointment.id,
    v_rev,
    now(),
    coalesce(p_request.proposed_start_time, now()) + interval '2 hours',
    CASE WHEN p_kind = 'visit_2h' THEN 15 ELSE 10 END,
    jsonb_build_object(
      'detail', p_detail,
      'text', p_detail,
      'location', p_location,
      'request_id', p_request.id,
      'appointment_id', p_appointment.id,
      'kind', p_kind,
      'start_time', coalesce(p_request.proposed_start_time, p_appointment.start_time),
      'end_time', coalesce(p_request.proposed_end_time, p_appointment.end_time),
      'advisor_id', coalesce(p_request.assigned_advisor_id, p_appointment.responsible_id),
      'lead_id', p_appointment.lead_id
    ),
    'pending',
    now()
  )
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_assert_client_inbound_message(
  p_request public.appointment_reschedule_requests,
  p_message_id text
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
BEGIN
  IF nullif(trim(p_message_id), '') IS NULL THEN
    RAISE EXCEPTION 'La aceptación del cliente requiere un mensaje real';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.messages m
    JOIN public.conversations c ON c.id = m.conversation_id
    WHERE m.role = 'cliente'
      AND (m.id::text = p_message_id OR m.external_message_id = p_message_id)
      AND c.lead_id = p_request.lead_id
      AND c.tenant_id = p_request.tenant_id
      AND c.project_id IS NOT DISTINCT FROM p_request.project_id
      AND (p_request.source_channel IS NULL OR c.channel = p_request.source_channel)
  ) THEN
    RAISE EXCEPTION 'El mensaje no corresponde a un inbound de este cliente, canal y proyecto';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_intake_visit_request(
  p_lead_id uuid,
  p_project_id uuid,
  p_preferred_time_text text DEFAULT NULL,
  p_start_time timestamptz DEFAULT NULL,
  p_end_time timestamptz DEFAULT NULL,
  p_source_message_id text DEFAULT NULL,
  p_source_message_text text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_id uuid;
  v_tenant uuid;
  v_lead_project uuid;
  v_request_id uuid;
  v_end timestamptz;
  v_hold integer;
  v_existing uuid;
BEGIN
  SELECT tenant_id, project_id INTO v_tenant, v_lead_project FROM public.leads WHERE id = p_lead_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'Lead no encontrado';
  END IF;
  IF v_lead_project IS DISTINCT FROM p_project_id THEN
    RAISE EXCEPTION 'El lead no pertenece a este proyecto';
  END IF;

  PERFORM public.lv_lock_project(v_tenant, p_project_id);

  IF p_source_message_id IS NOT NULL THEN
    SELECT appointment_id INTO v_existing
    FROM public.appointment_reschedule_requests
    WHERE tenant_id = v_tenant
      AND project_id = p_project_id
      AND source_channel = 'whatsapp'
      AND source_message_id = p_source_message_id
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;

  v_end := p_end_time;
  IF p_start_time IS NOT NULL THEN
    v_end := coalesce(v_end, p_start_time + interval '1 hour');
    PERFORM public.lv_assert_visit_slot(p_project_id, p_start_time, v_end);
  END IF;

  SELECT coalesce(proposal_hold_minutes, 120) INTO v_hold
  FROM public.project_automation_config WHERE project_id = p_project_id;

  INSERT INTO public.appointments (
    tenant_id, lead_id, responsible_id, title, start_time, end_time, status, location_type,
    project_id, notes, scheduled_at, scheduled_by, channel, confirmed_by_client, preferred_time_text
  ) VALUES (
    v_tenant, p_lead_id, NULL, 'Visita solicitada a La Vilet', NULL, NULL, 'solicitada', 'proyecto',
    p_project_id, 'Pendiente de confirmación por una asesora', NULL, 'bot', 'whatsapp', false, p_preferred_time_text
  )
  RETURNING id INTO v_id;

  INSERT INTO public.appointment_reschedule_requests (
    tenant_id, project_id, appointment_id, lead_id, request_type, proposed_by, status,
    proposed_start_time, proposed_end_time, preferred_time_text,
    source_message_text, source_channel, source_message_id,
    client_accepted_at, expires_at
  ) VALUES (
    v_tenant, p_project_id, v_id, p_lead_id, 'visit', 'client', 'awaiting_advisor',
    p_start_time, v_end, p_preferred_time_text,
    p_source_message_text, 'whatsapp', p_source_message_id,
    CASE WHEN p_start_time IS NOT NULL THEN now() ELSE NULL END,
    CASE WHEN p_start_time IS NOT NULL THEN now() + make_interval(mins => coalesce(v_hold, 120)) ELSE NULL END
  )
  RETURNING id INTO v_request_id;

  PERFORM public.lv_assign_appointment_fairly(v_request_id, ARRAY[]::uuid[]);
  RETURN v_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_visit(
  p_lead_id uuid,
  p_project_id uuid,
  p_preferred_time_text text DEFAULT NULL,
  p_start_time timestamptz DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
BEGIN
  RETURN public.lv_intake_visit_request(
    p_lead_id, p_project_id, p_preferred_time_text, p_start_time, NULL, NULL, NULL
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_assert_can_act_on_request(
  p_request public.appointment_reschedule_requests
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF public.lv_can_coordinate() THEN
    RETURN;
  END IF;
  IF p_request.assigned_advisor_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'No puedes gestionar la solicitud de otro asesor';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_mark_request_reviewed(p_request_id uuid)
RETURNS public.appointment_reschedule_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  r public.appointment_reschedule_requests;
  v_tenant uuid;
  v_project uuid;
BEGIN
  SELECT tenant_id, project_id INTO v_tenant, v_project
  FROM public.appointment_reschedule_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;
  PERFORM public.lv_lock_project(v_tenant, v_project);
  SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id = p_request_id FOR UPDATE;
  PERFORM public.lv_assert_can_act_on_request(r);
  IF r.reviewed_at IS NULL THEN
    UPDATE public.appointment_reschedule_requests
    SET reviewed_at = now(), updated_at = now()
    WHERE id = r.id
    RETURNING * INTO r;
  END IF;
  RETURN r;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_advisor_accept_request(p_request_id uuid)
RETURNS public.appointment_reschedule_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  r public.appointment_reschedule_requests;
  a public.appointments;
  v_tenant uuid;
  v_project uuid;
BEGIN
  SELECT tenant_id, project_id INTO v_tenant, v_project
  FROM public.appointment_reschedule_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;
  PERFORM public.lv_lock_project(v_tenant, v_project);
  SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id = p_request_id FOR UPDATE;
  PERFORM public.lv_assert_can_act_on_request(r);
  IF r.status = 'confirmed' THEN
    RETURN r;
  END IF;
  IF r.status <> 'awaiting_advisor' THEN
    RAISE EXCEPTION 'Esta propuesta no espera revisión del asesor';
  END IF;
  IF r.proposed_start_time IS NULL OR r.proposed_end_time IS NULL THEN
    RAISE EXCEPTION 'No hay un horario concreto que aceptar. Propón un intervalo.';
  END IF;
  SELECT * INTO a FROM public.appointments WHERE id = r.appointment_id FOR UPDATE;
  PERFORM public.lv_assert_visit_slot(r.project_id, r.proposed_start_time, r.proposed_end_time);
  IF NOT public.lv_advisor_eligible_on_project(r.assigned_advisor_id, r.tenant_id, r.project_id) THEN
    RAISE EXCEPTION 'El asesor no está activo en este proyecto';
  END IF;
  IF public.lv_advisor_has_conflict(r.assigned_advisor_id, r.proposed_start_time, r.proposed_end_time, a.id) THEN
    RAISE EXCEPTION 'El horario ya no está disponible';
  END IF;
  UPDATE public.appointment_reschedule_requests
  SET advisor_accepted_at = coalesce(advisor_accepted_at, now()),
      escalation_due_at = NULL,
      updated_at = now()
  WHERE id = r.id
  RETURNING * INTO r;
  IF r.client_accepted_at IS NOT NULL THEN
    RETURN public.lv_confirm_visit_from_request(r.id);
  END IF;
  UPDATE public.appointment_reschedule_requests
  SET status = 'awaiting_client', updated_at = now()
  WHERE id = r.id
  RETURNING * INTO r;
  PERFORM public.lv_upsert_hold(r);
  PERFORM public.lv_enqueue_visit_outbox(
    a, r, 'visit_propose',
    'Podemos recibirle ' || public.lv_format_visit_when(r.proposed_start_time) ||
      '. Será un gusto mostrarle el proyecto. ¿Le viene bien ese horario?',
    (SELECT visit_location_url FROM public.project_automation_config WHERE project_id = r.project_id)
  );
  RETURN r;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_advisor_propose_request(
  p_request_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_notes text DEFAULT NULL
)
RETURNS public.appointment_reschedule_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  r public.appointment_reschedule_requests;
  nxt public.appointment_reschedule_requests;
  a public.appointments;
  v_hold integer;
  v_tenant uuid;
  v_project uuid;
BEGIN
  SELECT tenant_id, project_id INTO v_tenant, v_project
  FROM public.appointment_reschedule_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;
  PERFORM public.lv_lock_project(v_tenant, v_project);
  SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id = p_request_id FOR UPDATE;
  PERFORM public.lv_assert_can_act_on_request(r);
  IF r.status NOT IN ('awaiting_advisor', 'awaiting_client') THEN
    RAISE EXCEPTION 'Esta propuesta ya no está abierta';
  END IF;
  SELECT * INTO a FROM public.appointments WHERE id = r.appointment_id FOR UPDATE;
  PERFORM public.lv_assert_visit_slot(r.project_id, p_start, p_end);
  IF NOT public.lv_advisor_eligible_on_project(r.assigned_advisor_id, r.tenant_id, r.project_id) THEN
    RAISE EXCEPTION 'El asesor no está activo en este proyecto';
  END IF;
  IF public.lv_advisor_has_conflict(r.assigned_advisor_id, p_start, p_end, a.id) THEN
    RAISE EXCEPTION 'El horario ya no está disponible';
  END IF;
  SELECT coalesce(proposal_hold_minutes, 120) INTO v_hold
  FROM public.project_automation_config WHERE project_id = r.project_id;

  UPDATE public.appointment_reschedule_requests
  SET status = 'superseded', resolved_at = now(), resolved_by = auth.uid(),
      resolution_notes = coalesce(p_notes, resolution_notes), updated_at = now()
  WHERE id = r.id;
  DELETE FROM public.appointment_time_holds WHERE request_id = r.id;
  PERFORM public.lv_cancel_pending_visit_outbox(a.id, 'propuesta sustituida');

  INSERT INTO public.appointment_reschedule_requests (
    tenant_id, project_id, appointment_id, lead_id, request_type, proposed_by, previous_request_id,
    status, previous_start_time, previous_end_time, proposed_start_time, proposed_end_time,
    preferred_time_text, assigned_advisor_id, assigned_at, advisor_accepted_at,
    expires_at, escalation_due_at
  ) VALUES (
    r.tenant_id, r.project_id, r.appointment_id, r.lead_id, r.request_type, 'advisor', r.id,
    'awaiting_client', a.start_time, a.end_time, p_start, p_end,
    r.preferred_time_text, r.assigned_advisor_id, r.assigned_at, now(),
    now() + make_interval(mins => coalesce(v_hold, 120)), NULL
  )
  RETURNING * INTO nxt;

  PERFORM public.lv_upsert_hold(nxt);
  PERFORM public.lv_enqueue_visit_outbox(
    a, nxt, 'visit_propose',
    'Podemos recibirle ' || public.lv_format_visit_when(p_start) ||
      '. Será un gusto mostrarle el proyecto. ¿Le viene bien ese horario?',
    (SELECT visit_location_url FROM public.project_automation_config WHERE project_id = r.project_id)
  );
  RETURN nxt;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_confirm_visit_from_request(p_request_id uuid)
RETURNS public.appointment_reschedule_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  r public.appointment_reschedule_requests;
  a public.appointments;
  l public.leads;
  v_loc text;
  v_name text;
  v_advisor text;
  v_kind text;
  v_msg text;
  v_tenant uuid;
  v_project uuid;
BEGIN
  SELECT tenant_id, project_id INTO v_tenant, v_project
  FROM public.appointment_reschedule_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;
  PERFORM public.lv_lock_project(v_tenant, v_project);
  SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id = p_request_id FOR UPDATE;
  IF auth.uid() IS NOT NULL THEN
    PERFORM public.lv_assert_can_act_on_request(r);
  END IF;
  SELECT * INTO a FROM public.appointments WHERE id = r.appointment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cita no encontrada';
  END IF;

  IF r.status = 'confirmed' THEN
    IF a.status IN ('aceptado', 'reprogramado')
       AND a.start_time IS NOT DISTINCT FROM r.proposed_start_time
       AND a.end_time IS NOT DISTINCT FROM r.proposed_end_time
       AND a.responsible_id IS NOT DISTINCT FROM r.assigned_advisor_id THEN
      RETURN r;
    END IF;
    RAISE EXCEPTION 'La propuesta está confirmada pero la cita no coincide';
  END IF;
  IF r.status NOT IN ('awaiting_advisor', 'awaiting_client') THEN
    RAISE EXCEPTION 'La propuesta ya no está vigente';
  END IF;
  IF a.status IN ('cancelado', 'atendido') THEN
    RAISE EXCEPTION 'La cita está cancelada o resuelta';
  END IF;
  IF a.status NOT IN ('solicitada', 'pendiente', 'aceptado', 'reprogramado') THEN
    RAISE EXCEPTION 'El estado de la cita no admite confirmación';
  END IF;
  IF a.tenant_id IS DISTINCT FROM r.tenant_id
     OR a.project_id IS DISTINCT FROM r.project_id
     OR a.lead_id IS DISTINCT FROM r.lead_id THEN
    RAISE EXCEPTION 'La cita no coincide con el tenant, proyecto o lead de la propuesta';
  END IF;
  SELECT * INTO l FROM public.leads WHERE id = r.lead_id FOR SHARE;
  IF NOT FOUND OR l.tenant_id IS DISTINCT FROM r.tenant_id OR l.project_id IS DISTINCT FROM r.project_id THEN
    RAISE EXCEPTION 'El lead no coincide con el contexto de la propuesta';
  END IF;
  IF r.client_accepted_at IS NULL OR r.advisor_accepted_at IS NULL THEN
    RAISE EXCEPTION 'Faltan aceptaciones de ambas partes sobre esta propuesta';
  END IF;
  IF r.expires_at IS NOT NULL AND r.expires_at <= now() THEN
    RAISE EXCEPTION 'La propuesta está vencida';
  END IF;
  IF r.proposed_start_time IS NULL OR r.proposed_end_time IS NULL OR r.assigned_advisor_id IS NULL THEN
    RAISE EXCEPTION 'Faltan horario o responsable';
  END IF;
  PERFORM public.lv_assert_visit_slot(r.project_id, r.proposed_start_time, r.proposed_end_time);
  IF NOT public.lv_advisor_eligible_on_project(r.assigned_advisor_id, r.tenant_id, r.project_id) THEN
    RAISE EXCEPTION 'El asesor no está activo, habilitado o asignado al proyecto';
  END IF;
  IF public.lv_advisor_has_conflict(r.assigned_advisor_id, r.proposed_start_time, r.proposed_end_time, a.id) THEN
    RAISE EXCEPTION 'El horario ya no está disponible';
  END IF;

  v_msg := coalesce(
    r.client_acceptance_message_id,
    CASE WHEN r.proposed_by = 'client' THEN r.source_message_id END
  );
  PERFORM public.lv_assert_client_inbound_message(r, v_msg);

  SELECT visit_location_url INTO v_loc FROM public.project_automation_config WHERE project_id = r.project_id;
  UPDATE public.appointments SET
    status = CASE WHEN r.request_type = 'reschedule' THEN 'reprogramado' ELSE 'aceptado' END,
    start_time = r.proposed_start_time,
    end_time = r.proposed_end_time,
    scheduled_at = r.proposed_start_time,
    responsible_id = r.assigned_advisor_id,
    confirmed_by = coalesce(auth.uid(), r.assigned_advisor_id),
    confirmed_at = now(),
    confirmed_by_client = true,
    updated_at = now()
  WHERE id = a.id
  RETURNING * INTO a;

  DELETE FROM public.appointment_time_holds WHERE request_id = r.id;
  UPDATE public.appointment_reschedule_requests
  SET status = 'confirmed', resolved_at = now(), resolved_by = auth.uid(), updated_at = now()
  WHERE id = r.id
  RETURNING * INTO r;

  INSERT INTO public.appointment_change_log (appointment_id, actor_id, action, detail)
  VALUES (a.id, auth.uid(), 'confirmada', jsonb_build_object('request_id', r.id));

  PERFORM public.lv_cancel_pending_visit_outbox(a.id, 'horario sustituido o confirmado');
  SELECT coalesce(name, 'cliente') INTO v_name FROM public.leads WHERE id = a.lead_id;
  SELECT coalesce(full_name, 'nuestro equipo') INTO v_advisor FROM public.profiles WHERE id = a.responsible_id;
  v_kind := CASE WHEN r.request_type = 'reschedule' THEN 'visit_reschedule_confirm' ELSE 'visit_confirm' END;
  PERFORM public.lv_enqueue_visit_outbox(
    a, r, v_kind,
    public.lv_build_visit_confirm_message(v_name, v_advisor, a.start_time, v_loc),
    v_loc
  );
  RETURN r;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_client_accept_request(
  p_request_id uuid,
  p_message_id text
)
RETURNS public.appointment_reschedule_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  r public.appointment_reschedule_requests;
  v_tenant uuid;
  v_project uuid;
BEGIN
  SELECT tenant_id, project_id INTO v_tenant, v_project
  FROM public.appointment_reschedule_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;
  PERFORM public.lv_lock_project(v_tenant, v_project);
  SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id = p_request_id FOR UPDATE;
  IF r.status = 'confirmed' THEN
    RETURN r;
  END IF;
  IF r.status <> 'awaiting_client' THEN
    RAISE EXCEPTION 'Esta propuesta no está esperando al cliente';
  END IF;
  IF r.proposed_start_time IS NULL THEN
    RAISE EXCEPTION 'No hay un intervalo vigente que aceptar';
  END IF;
  IF r.expires_at IS NOT NULL AND r.expires_at <= now() THEN
    RAISE EXCEPTION 'La propuesta está vencida';
  END IF;
  PERFORM public.lv_assert_client_inbound_message(r, p_message_id);
  IF r.client_accepted_at IS NOT NULL
     AND r.client_acceptance_message_id IS NOT DISTINCT FROM p_message_id THEN
    IF r.advisor_accepted_at IS NOT NULL THEN
      RETURN public.lv_confirm_visit_from_request(r.id);
    END IF;
    RETURN r;
  END IF;
  UPDATE public.appointment_reschedule_requests
  SET client_accepted_at = coalesce(client_accepted_at, now()),
      client_acceptance_message_id = coalesce(client_acceptance_message_id, p_message_id),
      updated_at = now()
  WHERE id = r.id
  RETURNING * INTO r;
  IF r.advisor_accepted_at IS NOT NULL THEN
    RETURN public.lv_confirm_visit_from_request(r.id);
  END IF;
  RETURN r;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_reassign_bot_appointment(
  p_request_id uuid,
  p_reason text,
  p_candidate_advisor_ids uuid[] DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  r public.appointment_reschedule_requests;
  v_from uuid;
  v_to uuid;
  v_max integer;
  v_count integer;
  v_candidates uuid[];
  v_sla integer;
  v_tenant uuid;
  v_project uuid;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.lv_can_coordinate() THEN
    RAISE EXCEPTION 'Solo coordinación puede reasignar';
  END IF;
  SELECT tenant_id, project_id INTO v_tenant, v_project
  FROM public.appointment_reschedule_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;
  PERFORM public.lv_lock_project(v_tenant, v_project);
  SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id = p_request_id FOR UPDATE;
  IF r.status NOT IN ('awaiting_advisor', 'awaiting_client') THEN
    RAISE EXCEPTION 'La propuesta ya no está abierta';
  END IF;
  SELECT coalesce(max_auto_reassignments, 3), coalesce(review_sla_minutes, 90)
    INTO v_max, v_sla
  FROM public.project_automation_config WHERE project_id = r.project_id;
  SELECT count(*) INTO v_count
  FROM public.lv_appointment_assignment_events e
  WHERE e.appointment_id = r.appointment_id AND e.action = 'reassigned';
  IF v_count >= coalesce(v_max, 3) THEN
    INSERT INTO public.lv_appointment_assignment_events (
      tenant_id, project_id, appointment_id, request_id, from_advisor_id, action, reason, actor_id
    ) VALUES (
      r.tenant_id, r.project_id, r.appointment_id, r.id, r.assigned_advisor_id,
      'reassignment_capped', p_reason, auth.uid()
    );
    RETURN r.assigned_advisor_id;
  END IF;

  v_from := r.assigned_advisor_id;
  v_candidates := public.lv_list_eligible_bot_advisors(
    r.tenant_id, r.project_id, r.proposed_start_time, r.proposed_end_time, r.appointment_id
  );
  v_candidates := ARRAY(
    SELECT x FROM unnest(v_candidates) AS x WHERE x IS DISTINCT FROM v_from
  );
  v_to := public.lv_pick_fair_advisor(r.tenant_id, r.project_id, v_candidates);

  IF v_to IS NULL THEN
    INSERT INTO public.lv_appointment_assignment_events (
      tenant_id, project_id, appointment_id, request_id, from_advisor_id, action, reason, actor_id
    ) VALUES (
      r.tenant_id, r.project_id, r.appointment_id, r.id, v_from,
      'reassignment_no_candidate', coalesce(p_reason, 'sin elegibles'), auth.uid()
    );
    RETURN v_from;
  END IF;

  DELETE FROM public.lv_appointment_bot_assignments WHERE appointment_id = r.appointment_id;
  UPDATE public.appointment_reschedule_requests
  SET assigned_advisor_id = v_to,
      assigned_at = now(),
      advisor_accepted_at = NULL,
      reviewed_at = NULL,
      escalation_due_at = now() + make_interval(mins => coalesce(v_sla, 90)),
      updated_at = now()
  WHERE id = r.id;
  UPDATE public.appointments
  SET responsible_id = v_to, updated_at = now()
  WHERE id = r.appointment_id;

  INSERT INTO public.lv_appointment_bot_assignments (appointment_id, tenant_id, project_id, advisor_id)
  VALUES (r.appointment_id, r.tenant_id, r.project_id, v_to);
  INSERT INTO public.lv_appointment_bot_assignment_history (
    tenant_id, project_id, appointment_id, request_id, advisor_id, reason
  ) VALUES (
    r.tenant_id, r.project_id, r.appointment_id, r.id, v_to, 'reassignment'
  )
  ON CONFLICT (appointment_id, advisor_id) DO NOTHING;
  PERFORM public.lv_upsert_hold((SELECT x FROM public.appointment_reschedule_requests x WHERE x.id = r.id));
  INSERT INTO public.lv_appointment_assignment_events (
    tenant_id, project_id, appointment_id, request_id, from_advisor_id, to_advisor_id, action, reason, actor_id
  ) VALUES (
    r.tenant_id, r.project_id, r.appointment_id, r.id, v_from, v_to, 'reassigned', p_reason, auth.uid()
  );
  RETURN v_to;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_request_reassignment(p_request_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  r public.appointment_reschedule_requests;
  v_tenant uuid;
  v_project uuid;
BEGIN
  SELECT tenant_id, project_id INTO v_tenant, v_project
  FROM public.appointment_reschedule_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;
  PERFORM public.lv_lock_project(v_tenant, v_project);
  SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id = p_request_id FOR UPDATE;
  PERFORM public.lv_assert_can_act_on_request(r);
  IF coalesce(trim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'Indica el motivo de la reasignación';
  END IF;
  INSERT INTO public.lv_appointment_assignment_events (
    tenant_id, project_id, appointment_id, request_id, from_advisor_id, action, reason, actor_id
  ) VALUES (
    r.tenant_id, r.project_id, r.appointment_id, r.id, r.assigned_advisor_id, 'reassignment_requested', p_reason, auth.uid()
  );
  IF public.lv_can_coordinate() THEN
    PERFORM public.lv_reassign_bot_appointment(p_request_id, p_reason, NULL);
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_reject_request(p_request_id uuid, p_notes text DEFAULT NULL)
RETURNS public.appointment_reschedule_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  r public.appointment_reschedule_requests;
  a public.appointments;
  v_tenant uuid;
  v_project uuid;
BEGIN
  SELECT tenant_id, project_id INTO v_tenant, v_project
  FROM public.appointment_reschedule_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Solicitud no encontrada';
  END IF;
  PERFORM public.lv_lock_project(v_tenant, v_project);
  SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id = p_request_id FOR UPDATE;
  PERFORM public.lv_assert_can_act_on_request(r);
  SELECT * INTO a FROM public.appointments WHERE id = r.appointment_id FOR UPDATE;
  UPDATE public.appointment_reschedule_requests
  SET status = 'rejected', resolved_at = now(), resolved_by = auth.uid(),
      resolution_notes = coalesce(p_notes, resolution_notes), updated_at = now()
  WHERE id = r.id
  RETURNING * INTO r;
  DELETE FROM public.appointment_time_holds WHERE request_id = r.id;
  PERFORM public.lv_cancel_pending_visit_outbox(a.id, 'propuesta rechazada');
  RETURN r;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lavilet_due_reminders(p_tenant uuid, p_project uuid, p_test_phone text DEFAULT NULL)
RETURNS TABLE(appointment_id uuid, lead_id uuid, scheduled_start timestamptz, payload jsonb)
LANGUAGE sql
STABLE
SET search_path TO public
AS $function$
SELECT a.id, l.id, a.start_time,
  jsonb_build_object(
    'appointment_id', a.id, 'lead_id', l.id, 'start_time', a.start_time,
    'kommo_id', l.kommo_id, 'contact_id', l.contact_id,
    'name', l.name, 'phone', l.phone, 'title', a.title,
    'location_type', a.location_type
  )
FROM public.appointments a
JOIN public.leads l ON l.id = a.lead_id AND l.tenant_id = a.tenant_id
WHERE a.tenant_id = p_tenant AND a.project_id = p_project
  AND l.project_id = p_project
  AND a.status IN ('aceptado', 'reprogramado')
  AND a.start_time <= now() + interval '2 hours'
  AND a.start_time > now() + interval '110 minutes'
  AND l.kommo_id > 0 AND nullif(trim(l.contact_id), '') IS NOT NULL
  AND l.channel_origin = 'whatsapp'
  AND l.tracking_opt_out_at IS NULL
  AND (p_test_phone IS NULL OR regexp_replace(coalesce(l.phone, ''), '[^0-9]', '', 'g') =
       regexp_replace(p_test_phone, '[^0-9]', '', 'g'))
  AND NOT public.appointment_reminders_paused(a.id)
  AND NOT EXISTS (
    SELECT 1 FROM public.lavilet_appointment_reminders rem
    WHERE rem.appointment_id = a.id AND rem.scheduled_start = a.start_time
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.lavilet_appointment_reminders rem
    WHERE rem.lead_id = l.id AND rem.state IN ('claimed', 'uncertain')
  )
ORDER BY a.start_time, a.id;
$function$;

CREATE OR REPLACE FUNCTION public.lavilet_check_reminder(p_id uuid)
RETURNS TABLE(reminder_id uuid, valid boolean, payload jsonb)
LANGUAGE sql
STABLE
SET search_path TO public
AS $function$
SELECT r.id,
 r.state = 'claimed'
 AND a.start_time = r.scheduled_start
 AND a.status IN ('aceptado', 'reprogramado')
 AND a.start_time > now()
 AND NOT public.appointment_reminders_paused(a.id)
 AND a.lead_id = r.lead_id AND a.tenant_id = r.tenant_id AND a.project_id = r.project_id
 AND l.tenant_id = r.tenant_id AND l.project_id = r.project_id
 AND l.tracking_opt_out_at IS NULL
 AND l.kommo_id = (r.payload->>'kommo_id')::integer
 AND l.contact_id = r.payload->>'contact_id'
 AND l.channel_origin = 'whatsapp', r.payload
FROM public.lavilet_appointment_reminders r
JOIN public.appointments a ON a.id = r.appointment_id
JOIN public.leads l ON l.id = r.lead_id
WHERE r.id = p_id;
$function$;

CREATE OR REPLACE FUNCTION public.lv_intake_reschedule_request(
  p_appointment_id uuid,
  p_preferred_time_text text DEFAULT NULL,
  p_start_time timestamptz DEFAULT NULL,
  p_end_time timestamptz DEFAULT NULL,
  p_source_message_id text DEFAULT NULL,
  p_source_message_text text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  a public.appointments;
  v_request_id uuid;
  v_end timestamptz;
  v_hold integer;
  v_existing uuid;
BEGIN
  SELECT tenant_id, project_id INTO a.tenant_id, a.project_id
  FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cita no encontrada';
  END IF;
  PERFORM public.lv_lock_project(a.tenant_id, a.project_id);
  SELECT * INTO a FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF p_source_message_id IS NOT NULL THEN
    SELECT appointment_id INTO v_existing
    FROM public.appointment_reschedule_requests
    WHERE tenant_id = a.tenant_id AND project_id = a.project_id
      AND source_channel = 'whatsapp' AND source_message_id = p_source_message_id
    LIMIT 1;
    IF v_existing IS NOT NULL THEN
      RETURN v_existing;
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.appointment_reschedule_requests r
    WHERE r.appointment_id = a.id AND r.status IN ('awaiting_advisor', 'awaiting_client')
  ) THEN
    RAISE EXCEPTION 'Ya hay una propuesta abierta para esta cita';
  END IF;
  v_end := p_end_time;
  IF p_start_time IS NOT NULL THEN
    v_end := coalesce(v_end, p_start_time + interval '1 hour');
    PERFORM public.lv_assert_visit_slot(a.project_id, p_start_time, v_end);
  END IF;
  SELECT coalesce(proposal_hold_minutes, 120) INTO v_hold
  FROM public.project_automation_config WHERE project_id = a.project_id;
  INSERT INTO public.appointment_reschedule_requests (
    tenant_id, project_id, appointment_id, lead_id, request_type, proposed_by, status,
    previous_start_time, previous_end_time, proposed_start_time, proposed_end_time,
    preferred_time_text, source_message_text, source_channel, source_message_id,
    client_accepted_at, expires_at
  ) VALUES (
    a.tenant_id, a.project_id, a.id, a.lead_id, 'reschedule', 'client', 'awaiting_advisor',
    a.start_time, a.end_time, p_start_time, v_end,
    p_preferred_time_text, p_source_message_text, 'whatsapp', p_source_message_id,
    CASE WHEN p_start_time IS NOT NULL THEN now() ELSE NULL END,
    CASE WHEN p_start_time IS NOT NULL THEN now() + make_interval(mins => coalesce(v_hold, 120)) ELSE NULL END
  )
  RETURNING id INTO v_request_id;
  PERFORM public.lv_assign_appointment_fairly(v_request_id, ARRAY[]::uuid[]);
  RETURN a.id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_client_counterpropose(
  p_previous_request_id uuid,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_preferred_time_text text DEFAULT NULL,
  p_source_message_id text DEFAULT NULL,
  p_source_message_text text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  r public.appointment_reschedule_requests;
  nxt uuid;
  v_hold integer;
  v_sla integer;
  v_end timestamptz;
  v_tenant uuid;
  v_project uuid;
BEGIN
  SELECT tenant_id, project_id INTO v_tenant, v_project
  FROM public.appointment_reschedule_requests WHERE id = p_previous_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Propuesta anterior no encontrada';
  END IF;
  PERFORM public.lv_lock_project(v_tenant, v_project);
  SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id = p_previous_request_id FOR UPDATE;
  IF r.status NOT IN ('awaiting_advisor', 'awaiting_client') THEN
    RAISE EXCEPTION 'La propuesta anterior ya no está abierta';
  END IF;
  IF p_start_time IS NULL THEN
    RAISE EXCEPTION 'La contrapropuesta requiere un intervalo concreto';
  END IF;
  v_end := coalesce(p_end_time, p_start_time + interval '1 hour');
  PERFORM public.lv_assert_visit_slot(r.project_id, p_start_time, v_end);
  PERFORM public.lv_assert_client_inbound_message(r, p_source_message_id);
  SELECT coalesce(proposal_hold_minutes, 120), coalesce(review_sla_minutes, 90)
    INTO v_hold, v_sla
  FROM public.project_automation_config WHERE project_id = r.project_id;
  UPDATE public.appointment_reschedule_requests
  SET status = 'superseded', resolved_at = now(), updated_at = now()
  WHERE id = r.id;
  DELETE FROM public.appointment_time_holds WHERE request_id = r.id;
  PERFORM public.lv_cancel_pending_visit_outbox(r.appointment_id, 'contrapropuesta del cliente');
  INSERT INTO public.appointment_reschedule_requests (
    tenant_id, project_id, appointment_id, lead_id, request_type, proposed_by, previous_request_id,
    status, previous_start_time, previous_end_time, proposed_start_time, proposed_end_time,
    preferred_time_text, source_message_text, source_channel, source_message_id,
    assigned_advisor_id, assigned_at, client_accepted_at, advisor_accepted_at,
    expires_at, escalation_due_at, reviewed_at, escalated_at
  ) VALUES (
    r.tenant_id, r.project_id, r.appointment_id, r.lead_id, r.request_type, 'client', r.id,
    'awaiting_advisor', r.proposed_start_time, r.proposed_end_time, p_start_time, v_end,
    coalesce(p_preferred_time_text, r.preferred_time_text), p_source_message_text, 'whatsapp', p_source_message_id,
    r.assigned_advisor_id, r.assigned_at, now(), NULL,
    now() + make_interval(mins => coalesce(v_hold, 120)),
    now() + make_interval(mins => coalesce(v_sla, 90)),
    NULL, NULL
  )
  RETURNING id INTO nxt;
  PERFORM public.lv_upsert_hold((SELECT x FROM public.appointment_reschedule_requests x WHERE x.id = nxt));
  INSERT INTO public.lv_appointment_assignment_events (
    tenant_id, project_id, appointment_id, request_id, from_advisor_id, to_advisor_id, action, reason
  ) VALUES (
    r.tenant_id, r.project_id, r.appointment_id, nxt, r.assigned_advisor_id, r.assigned_advisor_id, 'counterproposed', 'client'
  );
  RETURN nxt;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_escalate_overdue_requests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  rec record;
  r public.appointment_reschedule_requests;
  v_count integer := 0;
BEGIN
  FOR rec IN
    SELECT id, tenant_id, project_id
    FROM public.appointment_reschedule_requests
    WHERE status = 'awaiting_advisor'
      AND escalation_due_at IS NOT NULL
      AND escalation_due_at <= now()
      AND escalated_at IS NULL
    ORDER BY id
  LOOP
    PERFORM public.lv_lock_project(rec.tenant_id, rec.project_id);
    SELECT * INTO r
    FROM public.appointment_reschedule_requests
    WHERE id = rec.id
    FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    IF r.status <> 'awaiting_advisor' OR r.escalated_at IS NOT NULL THEN
      CONTINUE;
    END IF;
    UPDATE public.appointment_reschedule_requests
    SET escalated_at = now(), updated_at = now()
    WHERE id = r.id;
    INSERT INTO public.lv_appointment_assignment_events (
      tenant_id, project_id, appointment_id, request_id, from_advisor_id, action, reason
    ) VALUES (
      r.tenant_id, r.project_id, r.appointment_id, r.id, r.assigned_advisor_id, 'escalated', 'review_sla'
    );
    IF r.assigned_advisor_id IS NULL THEN
      INSERT INTO public.lv_appointment_assignment_events (
        tenant_id, project_id, appointment_id, request_id, action, reason
      ) VALUES (
        r.tenant_id, r.project_id, r.appointment_id, r.id,
        'coordination_followup', 'sin responsable tras plazo de revisión'
      );
    ELSE
      PERFORM public.lv_reassign_bot_appointment(r.id, 'Plazo de revisión vencido', NULL);
    END IF;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_outbox_event_is_current(p_outbox_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  o public.lv_outbox;
  r public.appointment_reschedule_requests;
  a public.appointments;
  v_request_id uuid;
BEGIN
  SELECT * INTO o FROM public.lv_outbox WHERE id = p_outbox_id;
  IF NOT FOUND OR o.status NOT IN ('pending', 'claimed') THEN
    RETURN false;
  END IF;
  SELECT * INTO a FROM public.appointments WHERE id = o.appointment_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  v_request_id := nullif(o.payload->>'request_id', '')::uuid;
  IF v_request_id IS NOT NULL THEN
    SELECT * INTO r FROM public.appointment_reschedule_requests WHERE id = v_request_id;
  END IF;
  IF o.kind = 'visit_propose' THEN
    RETURN r.id IS NOT NULL
      AND r.status = 'awaiting_client'
      AND r.proposed_start_time IS NOT NULL
      AND (r.expires_at IS NULL OR r.expires_at > now())
      AND a.status NOT IN ('cancelado', 'atendido')
      AND r.assigned_advisor_id IS NOT NULL
      AND public.lv_advisor_eligible_on_project(r.assigned_advisor_id, r.tenant_id, r.project_id)
      AND public.lv_interval_within_business_hours(r.project_id, r.proposed_start_time, r.proposed_end_time)
      AND NOT public.lv_advisor_has_conflict(r.assigned_advisor_id, r.proposed_start_time, r.proposed_end_time, a.id)
      AND (o.payload->>'start_time' IS NULL
           OR (o.payload->>'start_time')::timestamptz IS NOT DISTINCT FROM r.proposed_start_time);
  END IF;
  IF o.kind IN ('visit_confirm', 'visit_reschedule_confirm') THEN
    RETURN r.id IS NOT NULL AND r.status = 'confirmed'
      AND a.status IN ('aceptado', 'reprogramado')
      AND a.start_time IS NOT DISTINCT FROM r.proposed_start_time
      AND a.end_time IS NOT DISTINCT FROM r.proposed_end_time
      AND a.responsible_id IS NOT DISTINCT FROM r.assigned_advisor_id
      AND public.lv_advisor_eligible_on_project(a.responsible_id, a.tenant_id, a.project_id)
      AND public.lv_interval_within_business_hours(a.project_id, a.start_time, a.end_time);
  END IF;
  IF o.kind = 'visit_2h' THEN
    RETURN a.status IN ('aceptado', 'reprogramado')
      AND NOT public.appointment_reminders_paused(a.id)
      AND a.start_time IS NOT NULL
      AND (o.payload->>'start_time' IS NULL OR (o.payload->>'start_time')::timestamptz IS NOT DISTINCT FROM a.start_time);
  END IF;
  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.lv_release_expired_holds()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_count integer;
BEGIN
  DELETE FROM public.appointment_time_holds WHERE expires_at <= now();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_appointment(
  p_appointment_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_responsible_id uuid,
  p_meeting_place text,
  p_location_type text,
  p_notes text,
  p_unit_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  a public.appointments;
  v_loc text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  SELECT tenant_id, project_id INTO a.tenant_id, a.project_id
  FROM public.appointments WHERE id = p_appointment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cita no encontrada';
  END IF;
  PERFORM public.lv_lock_project(a.tenant_id, a.project_id);
  SELECT * INTO a FROM public.appointments WHERE id = p_appointment_id FOR UPDATE;
  IF NOT public.agenda_can_manage_appointment(a) THEN
    RAISE EXCEPTION 'No puedes confirmar esta solicitud';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.appointment_reschedule_requests r
    WHERE r.appointment_id = a.id AND r.status IN ('awaiting_advisor', 'awaiting_client')
  ) THEN
    RAISE EXCEPTION 'Hay una propuesta abierta; resuélvela con aceptar o proponer, no confirmes a mano';
  END IF;
  IF a.status NOT IN ('solicitada', 'pendiente') THEN
    RAISE EXCEPTION 'La solicitud ya fue confirmada o no admite confirmación';
  END IF;
  IF nullif(trim(p_meeting_place), '') IS NULL THEN
    RAISE EXCEPTION 'Indica el lugar de encuentro';
  END IF;
  IF a.lead_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = a.lead_id AND l.tenant_id = a.tenant_id
  ) THEN
    RAISE EXCEPTION 'El cliente no pertenece a este tenant';
  END IF;
  PERFORM public.lv_assert_visit_slot(a.project_id, p_start, p_end);
  PERFORM public.agenda_assert_responsible(a.project_id, p_responsible_id);
  PERFORM public.agenda_assert_units(a.tenant_id, a.project_id, coalesce(p_unit_ids, '{}'::uuid[]));
  v_loc := coalesce(nullif(p_location_type, ''), a.location_type, 'proyecto');
  IF v_loc NOT IN ('oficina', 'proyecto', 'mixto') THEN
    v_loc := 'proyecto';
  END IF;
  PERFORM public.agenda_assert_no_conflict(p_responsible_id, p_start, p_end, a.id);
  PERFORM public.replace_appointment_units(a.id, coalesce(p_unit_ids, '{}'::uuid[]));
  UPDATE public.appointments SET
    status = 'aceptado',
    start_time = p_start,
    end_time = p_end,
    scheduled_at = p_start,
    responsible_id = p_responsible_id,
    meeting_place = nullif(trim(p_meeting_place), ''),
    location_type = v_loc,
    notes = coalesce(nullif(trim(p_notes), ''), notes),
    confirmed_by = auth.uid(),
    confirmed_at = now(),
    scheduled_by = 'asesor',
    confirmed_by_client = false,
    updated_at = now()
  WHERE id = a.id
  RETURNING * INTO a;
  INSERT INTO public.appointment_change_log (appointment_id, actor_id, action, detail)
  VALUES (a.id, auth.uid(), 'confirmada', jsonb_build_object('start_time', p_start, 'responsible_id', p_responsible_id));
  RETURN a;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_confirmed_appointment(
  p_tenant_id uuid,
  p_lead_id uuid,
  p_project_id uuid,
  p_title text,
  p_start timestamptz,
  p_end timestamptz,
  p_responsible_id uuid,
  p_meeting_place text,
  p_location_type text,
  p_notes text,
  p_unit_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  a public.appointments;
  v_loc text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'No autenticado';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.role IN ('asesor', 'admin')
  ) THEN
    RAISE EXCEPTION 'No puedes crear citas';
  END IF;
  IF p_lead_id IS NULL OR p_project_id IS NULL OR p_responsible_id IS NULL THEN
    RAISE EXCEPTION 'Cliente, proyecto y asesor son obligatorios';
  END IF;
  IF nullif(trim(p_meeting_place), '') IS NULL THEN
    RAISE EXCEPTION 'Indica el lugar de encuentro';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.leads l WHERE l.id = p_lead_id AND l.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'El cliente no pertenece a este tenant';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects pr WHERE pr.id = p_project_id AND pr.tenant_id = p_tenant_id) THEN
    RAISE EXCEPTION 'El proyecto no pertenece a este tenant';
  END IF;
  PERFORM public.lv_lock_project(p_tenant_id, p_project_id);
  PERFORM public.lv_assert_visit_slot(p_project_id, p_start, p_end);
  PERFORM public.agenda_assert_responsible(p_project_id, p_responsible_id);
  PERFORM public.agenda_assert_units(p_tenant_id, p_project_id, coalesce(p_unit_ids, '{}'::uuid[]));
  v_loc := coalesce(nullif(p_location_type, ''), 'proyecto');
  IF v_loc NOT IN ('oficina', 'proyecto', 'mixto') THEN
    v_loc := 'proyecto';
  END IF;
  PERFORM public.agenda_assert_no_conflict(p_responsible_id, p_start, p_end, NULL);
  INSERT INTO public.appointments (
    tenant_id, lead_id, project_id, title, start_time, end_time, scheduled_at,
    responsible_id, status, location_type, meeting_place, notes,
    scheduled_by, channel, confirmed_by_client, confirmed_by, confirmed_at, requested_at
  ) VALUES (
    p_tenant_id, p_lead_id, p_project_id,
    coalesce(nullif(trim(p_title), ''), 'Visita a La Vilet'),
    p_start, p_end, p_start, p_responsible_id, 'aceptado', v_loc,
    nullif(trim(p_meeting_place), ''), nullif(trim(p_notes), ''),
    'asesor', 'web', false, auth.uid(), now(), now()
  ) RETURNING * INTO a;
  PERFORM public.replace_appointment_units(a.id, coalesce(p_unit_ids, '{}'::uuid[]));
  INSERT INTO public.appointment_change_log (appointment_id, actor_id, action, detail)
  VALUES (a.id, auth.uid(), 'creada', jsonb_build_object('status', 'aceptado'));
  RETURN a;
END;
$function$;

ALTER TABLE public.appointment_reschedule_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lv_appointment_bot_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lv_appointment_bot_assignment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lv_appointment_assignment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_time_holds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_salesperson_time_off ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointment_change_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_salespeople ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read appointment_reschedule_requests" ON public.appointment_reschedule_requests;
DROP POLICY IF EXISTS appointment_requests_select ON public.appointment_reschedule_requests;
CREATE POLICY appointment_requests_select ON public.appointment_reschedule_requests
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR assigned_advisor_id = auth.uid()
  );

DROP POLICY IF EXISTS "Authenticated read appointment_change_log" ON public.appointment_change_log;
DROP POLICY IF EXISTS appointment_change_log_select ON public.appointment_change_log;
CREATE POLICY appointment_change_log_select ON public.appointment_change_log
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.appointments a
      WHERE a.id = appointment_change_log.appointment_id
        AND a.responsible_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.appointment_reschedule_requests r
      WHERE r.appointment_id = appointment_change_log.appointment_id
        AND r.assigned_advisor_id = auth.uid()
        AND r.status IN ('awaiting_advisor', 'awaiting_client')
    )
  );

DROP POLICY IF EXISTS appointment_holds_select ON public.appointment_time_holds;
CREATE POLICY appointment_holds_select ON public.appointment_time_holds
  FOR SELECT TO authenticated
  USING (public.is_admin() OR advisor_id = auth.uid());

DROP POLICY IF EXISTS appointment_time_off_select ON public.project_salesperson_time_off;
CREATE POLICY appointment_time_off_select ON public.project_salesperson_time_off
  FOR SELECT TO authenticated
  USING (public.is_admin() OR salesperson_id = auth.uid());

DROP POLICY IF EXISTS bot_assignments_select ON public.lv_appointment_bot_assignments;
CREATE POLICY bot_assignments_select ON public.lv_appointment_bot_assignments
  FOR SELECT TO authenticated
  USING (public.is_admin() OR advisor_id = auth.uid());

DROP POLICY IF EXISTS bot_history_select ON public.lv_appointment_bot_assignment_history;
CREATE POLICY bot_history_select ON public.lv_appointment_bot_assignment_history
  FOR SELECT TO authenticated
  USING (public.is_admin() OR advisor_id = auth.uid());

DROP POLICY IF EXISTS assignment_events_select ON public.lv_appointment_assignment_events;
CREATE POLICY assignment_events_select ON public.lv_appointment_assignment_events
  FOR SELECT TO authenticated
  USING (public.is_admin() OR from_advisor_id = auth.uid() OR to_advisor_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated all appointments" ON public.appointments;
DROP POLICY IF EXISTS "Authenticated read appointments" ON public.appointments;
DROP POLICY IF EXISTS appointments_select_scoped ON public.appointments;
DROP POLICY IF EXISTS appointments_insert_scoped ON public.appointments;
DROP POLICY IF EXISTS appointments_update_scoped ON public.appointments;
CREATE POLICY appointments_select_scoped ON public.appointments
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR responsible_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.appointment_reschedule_requests r
      WHERE r.appointment_id = appointments.id
        AND r.assigned_advisor_id = auth.uid()
        AND r.tenant_id = appointments.tenant_id
        AND r.project_id IS NOT DISTINCT FROM appointments.project_id
        AND r.status IN ('awaiting_advisor', 'awaiting_client')
    )
  );
CREATE POLICY appointments_insert_scoped ON public.appointments
  FOR INSERT TO authenticated
  WITH CHECK (public.is_admin() OR responsible_id = auth.uid());
CREATE POLICY appointments_update_scoped ON public.appointments
  FOR UPDATE TO authenticated
  USING (
    public.is_admin()
    OR responsible_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.appointment_reschedule_requests r
      WHERE r.appointment_id = appointments.id
        AND r.assigned_advisor_id = auth.uid()
        AND r.status IN ('awaiting_advisor', 'awaiting_client')
    )
  )
  WITH CHECK (public.is_admin() OR responsible_id = auth.uid());

DROP POLICY IF EXISTS "Authenticated all project_salespeople" ON public.project_salespeople;
DROP POLICY IF EXISTS "Authenticated read project_salespeople" ON public.project_salespeople;
DROP POLICY IF EXISTS project_salespeople_select_scoped ON public.project_salespeople;
DROP POLICY IF EXISTS project_salespeople_admin_write ON public.project_salespeople;
CREATE POLICY project_salespeople_select_scoped ON public.project_salespeople
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR salesperson_id = auth.uid()
    OR public.lv_shares_project(project_id, tenant_id)
  );
CREATE POLICY project_salespeople_admin_write ON public.project_salespeople
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

REVOKE ALL ON TABLE public.appointment_reschedule_requests FROM PUBLIC, anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.appointment_reschedule_requests FROM authenticated;
REVOKE ALL ON TABLE public.lv_appointment_bot_assignments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.lv_appointment_bot_assignment_history FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.appointment_time_holds FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.lv_appointment_assignment_events FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.appointment_change_log FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.appointment_reschedule_requests TO authenticated;
GRANT SELECT ON public.lv_appointment_bot_assignments TO authenticated;
GRANT SELECT ON public.lv_appointment_bot_assignment_history TO authenticated;
GRANT SELECT ON public.lv_appointment_assignment_events TO authenticated;
GRANT SELECT ON public.appointment_time_holds TO authenticated;
GRANT SELECT ON public.project_salesperson_time_off TO authenticated;
GRANT SELECT ON public.appointment_change_log TO authenticated;

REVOKE ALL ON FUNCTION public.lv_lock_project(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_upsert_hold(public.appointment_reschedule_requests) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_enqueue_visit_outbox(public.appointments, public.appointment_reschedule_requests, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_cancel_pending_visit_outbox(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_assert_visit_slot(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_assert_client_inbound_message(public.appointment_reschedule_requests, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_interval_within_business_hours(uuid, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_advisor_has_conflict(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_advisor_eligible_on_project(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_list_eligible_bot_advisors(uuid, uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_pick_fair_advisor(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_confirm_visit_from_request(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_assign_appointment_fairly(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_intake_visit_request(uuid, uuid, text, timestamptz, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_intake_reschedule_request(uuid, text, timestamptz, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_client_counterpropose(uuid, timestamptz, timestamptz, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_client_accept_request(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_escalate_overdue_requests() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_outbox_event_is_current(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_release_expired_holds() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.request_visit(uuid, uuid, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lv_assert_can_act_on_request(public.appointment_reschedule_requests) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.lv_lock_project(uuid, uuid) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.lv_assign_appointment_fairly(uuid, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.lv_intake_visit_request(uuid, uuid, text, timestamptz, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lv_intake_reschedule_request(uuid, text, timestamptz, timestamptz, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lv_client_counterpropose(uuid, timestamptz, timestamptz, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.lv_client_accept_request(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.request_visit(uuid, uuid, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.lv_confirm_visit_from_request(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lv_escalate_overdue_requests() TO service_role;
GRANT EXECUTE ON FUNCTION public.lv_outbox_event_is_current(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.lv_release_expired_holds() TO service_role;

REVOKE ALL ON FUNCTION public.lv_mark_request_reviewed(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lv_advisor_accept_request(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lv_advisor_propose_request(uuid, timestamptz, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lv_request_reassignment(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lv_reassign_bot_appointment(uuid, text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lv_reject_request(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lv_can_coordinate() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lv_shares_project(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.appointment_reminders_paused(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lv_appointment_overlap_blockers() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lv_format_visit_clock(timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lv_format_visit_date(timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lv_format_visit_when(timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.lv_build_visit_confirm_message(text, text, timestamptz, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.lv_mark_request_reviewed(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lv_advisor_accept_request(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lv_advisor_propose_request(uuid, timestamptz, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lv_request_reassignment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lv_reassign_bot_appointment(uuid, text, uuid[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lv_reject_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lv_can_coordinate() TO authenticated;
GRANT EXECUTE ON FUNCTION public.lv_shares_project(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.appointment_reminders_paused(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lv_appointment_overlap_blockers() TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_appointment(uuid, timestamptz, timestamptz, uuid, text, text, text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_confirmed_appointment(uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_appointment(uuid, timestamptz, timestamptz, uuid, text, text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_confirmed_appointment(uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text, uuid[]) TO authenticated;
