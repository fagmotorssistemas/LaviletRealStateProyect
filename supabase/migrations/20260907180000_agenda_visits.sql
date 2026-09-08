-- Agenda: solicitudes, confirmación atómica y asistencia.
-- No aplicar en producción desde el agente. Reversión: 20260907180000_agenda_visits_down.sql
-- Orden: este archivo, luego 20260907210000, luego decisión humana, luego 20260907220000.
-- Cada migración es una transacción; un error no deja ese archivo a medias.
--
-- IMPORTANTE: en el proyecto La Vilet, appointment_reschedule_requests YA EXISTE
-- con status awaiting_advisor/awaiting_client (no review_status).
-- No recrear esa tabla. La coordinación de bot/reparto está en
-- 20260907210000_agenda_coordination.sql. Si este archivo se aplica sobre
-- una base vacía, no crea el esquema obsoleto de review_status.

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS confirmed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS meeting_place text;

COMMENT ON COLUMN public.appointments.confirmed_by IS
  'Asesor que confirmó la solicitud. No implica confirmed_by_client.';
COMMENT ON COLUMN public.appointments.confirmed_at IS
  'Momento en que el asesor confirmó horario y responsable.';
COMMENT ON COLUMN public.appointments.meeting_place IS
  'Lugar de encuentro en texto libre.';

-- La tabla viva de propuestas ya existe en La Vilet. No crear el esquema review_status.
DO $$
BEGIN
  IF to_regclass('public.appointment_reschedule_requests') IS NULL THEN
    RAISE NOTICE 'appointment_reschedule_requests no está en esta base. Créala con el esquema de coordinación (status awaiting_*), no con review_status.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.appointment_change_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES public.appointments(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  action text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS appointment_change_log_appt_idx
  ON public.appointment_change_log (appointment_id, created_at DESC);

-- RLS de este log: 20260907210000. No ENABLE aquí sin política: RLS sin policy niega todo.

GRANT SELECT ON public.appointment_change_log TO authenticated;

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

CREATE OR REPLACE FUNCTION public.cancel_pending_visit_outbox(p_appointment_id uuid, p_reason text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
declare
  v_count integer := 0;
begin
  -- Solo pendientes: un envío claimed ya va en curso.
  -- Reescribir dedupe_key para que el planificador pueda insertar el nuevo horario
  -- sin chocar con la unique de filas canceladas y sin reactivar esas filas.
  update public.lv_outbox
  set
    status = 'cancelled',
    detail = coalesce(p_reason, 'cancelado desde agenda'),
    dedupe_key = dedupe_key || ':cancelled:' || id::text
  where appointment_id = p_appointment_id
    and status = 'pending';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.agenda_can_manage_appointment(p_appointment public.appointments)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.is_admin()
      OR p_appointment.responsible_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.appointment_reschedule_requests r
        WHERE r.appointment_id = p_appointment.id
          AND r.assigned_advisor_id = auth.uid()
          AND r.status IN ('awaiting_advisor', 'awaiting_client')
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.agenda_assert_no_conflict(
  p_responsible_id uuid,
  p_start timestamptz,
  p_end timestamptz,
  p_exclude_id uuid
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
begin
  if p_responsible_id is null or p_start is null or p_end is null then
    raise exception 'Horario y asesor son obligatorios';
  end if;
  if p_end <= p_start then
    raise exception 'La hora de fin debe ser posterior al inicio';
  end if;
  IF EXISTS (
    SELECT 1
    FROM public.appointments a
    WHERE a.responsible_id = p_responsible_id
      AND a.id IS DISTINCT FROM p_exclude_id
      AND a.status IN ('pendiente', 'aceptado', 'reprogramado')
      AND a.start_time IS NOT NULL
      AND a.end_time IS NOT NULL
      AND a.start_time < p_end
      AND a.end_time > p_start
  ) THEN
    RAISE EXCEPTION 'El asesor ya tiene una cita en ese horario';
  END IF;
  IF to_regclass('public.appointment_time_holds') IS NOT NULL
     AND EXISTS (
    SELECT 1
    FROM public.appointment_time_holds h
    WHERE h.advisor_id = p_responsible_id
      AND h.appointment_id IS DISTINCT FROM p_exclude_id
      AND h.expires_at > now()
      AND h.start_time < p_end
      AND h.end_time > p_start
  ) THEN
    RAISE EXCEPTION 'El horario está reservado por otra propuesta';
  END IF;
end;
$function$;

CREATE OR REPLACE FUNCTION public.agenda_assert_units(
  p_tenant_id uuid,
  p_project_id uuid,
  p_unit_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
begin
  if p_unit_ids is null or cardinality(p_unit_ids) = 0 then
    return;
  end if;
  if exists (
    select 1
    from unnest(p_unit_ids) as x
    left join public.units u on u.id = x
    where u.id is null
      or u.tenant_id is distinct from p_tenant_id
      or (p_project_id is not null and u.project_id is distinct from p_project_id)
  ) then
    raise exception 'Una unidad no pertenece al proyecto o tenant de la cita';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.agenda_assert_responsible(p_project_id uuid, p_responsible_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
begin
  if p_responsible_id is null then
    raise exception 'Elige un asesor responsable';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_responsible_id and coalesce(p.is_active, true)
  ) then
    raise exception 'El asesor no está activo';
  end if;
  if p_project_id is not null
    and exists (select 1 from public.project_salespeople ps where ps.project_id = p_project_id)
    and not exists (
      select 1 from public.project_salespeople ps
      where ps.project_id = p_project_id and ps.salesperson_id = p_responsible_id
    )
    and not exists (
      select 1 from public.profiles p where p.id = p_responsible_id and p.role = 'admin'
    )
  then
    raise exception 'El asesor no está asignado a este proyecto';
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.replace_appointment_units(p_appointment_id uuid, p_unit_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
begin
  delete from public.appointment_units where appointment_id = p_appointment_id;
  if p_unit_ids is not null and cardinality(p_unit_ids) > 0 then
    insert into public.appointment_units (appointment_id, unit_id)
    select p_appointment_id, x
    from unnest(p_unit_ids) as x;
  end if;
end;
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
declare
  a public.appointments;
  v_loc text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;

  select tenant_id, project_id into a.tenant_id, a.project_id
  from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'Cita no encontrada';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(a.tenant_id::text || ':' || coalesce(a.project_id::text, ''), 0)
  );
  select * into a from public.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'Cita no encontrada';
  end if;
  if not public.agenda_can_manage_appointment(a) then
    raise exception 'No puedes confirmar esta solicitud';
  end if;
  if a.status not in ('solicitada', 'pendiente') then
    raise exception 'La solicitud ya fue confirmada o no admite confirmación';
  end if;
  if nullif(trim(p_meeting_place), '') is null then
    raise exception 'Indica el lugar de encuentro';
  end if;
  if a.lead_id is not null and not exists (
    select 1 from public.leads l where l.id = a.lead_id and l.tenant_id = a.tenant_id
  ) then
    raise exception 'El cliente no pertenece a este tenant';
  end if;
  perform public.agenda_assert_responsible(a.project_id, p_responsible_id);
  perform public.agenda_assert_units(a.tenant_id, a.project_id, coalesce(p_unit_ids, '{}'::uuid[]));

  v_loc := coalesce(nullif(p_location_type, ''), a.location_type, 'proyecto');
  if v_loc not in ('oficina', 'proyecto', 'mixto') then
    v_loc := 'proyecto';
  end if;

  perform public.agenda_assert_no_conflict(p_responsible_id, p_start, p_end, a.id);
  perform public.replace_appointment_units(a.id, coalesce(p_unit_ids, '{}'::uuid[]));

  update public.appointments set
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
  where id = a.id
  returning * into a;

  insert into public.appointment_change_log (appointment_id, actor_id, action, detail)
  values (
    a.id,
    auth.uid(),
    'confirmada',
    jsonb_build_object('start_time', p_start, 'end_time', p_end, 'responsible_id', p_responsible_id)
  );

  return a;
end;
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
declare
  a public.appointments;
  v_loc text;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  if not exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('asesor', 'admin')
  ) then
    raise exception 'No puedes crear citas';
  end if;
  if p_lead_id is null or p_project_id is null or p_responsible_id is null then
    raise exception 'Cliente, proyecto y asesor son obligatorios';
  end if;
  if nullif(trim(p_meeting_place), '') is null then
    raise exception 'Indica el lugar de encuentro';
  end if;
  if not exists (select 1 from public.leads l where l.id = p_lead_id and l.tenant_id = p_tenant_id) then
    raise exception 'El cliente no pertenece a este tenant';
  end if;
  if not exists (select 1 from public.projects pr where pr.id = p_project_id and pr.tenant_id = p_tenant_id) then
    raise exception 'El proyecto no pertenece a este tenant';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || p_project_id::text, 0)
  );
  perform public.agenda_assert_responsible(p_project_id, p_responsible_id);
  perform public.agenda_assert_units(p_tenant_id, p_project_id, coalesce(p_unit_ids, '{}'::uuid[]));

  v_loc := coalesce(nullif(p_location_type, ''), 'proyecto');
  if v_loc not in ('oficina', 'proyecto', 'mixto') then
    v_loc := 'proyecto';
  end if;

  perform public.agenda_assert_no_conflict(p_responsible_id, p_start, p_end, null);

  insert into public.appointments (
    tenant_id, lead_id, project_id, title, start_time, end_time, scheduled_at,
    responsible_id, status, location_type, meeting_place, notes,
    scheduled_by, channel, confirmed_by_client, confirmed_by, confirmed_at, requested_at
  ) values (
    p_tenant_id, p_lead_id, p_project_id,
    coalesce(nullif(trim(p_title), ''), 'Visita a La Vilet'),
    p_start, p_end, p_start, p_responsible_id, 'aceptado', v_loc,
    nullif(trim(p_meeting_place), ''), nullif(trim(p_notes), ''),
    'asesor', 'web', false, auth.uid(), now(), now()
  ) returning * into a;

  perform public.replace_appointment_units(a.id, coalesce(p_unit_ids, '{}'::uuid[]));

  insert into public.appointment_change_log (appointment_id, actor_id, action, detail)
  values (a.id, auth.uid(), 'creada', jsonb_build_object('status', 'aceptado'));

  return a;
end;
$function$;

-- resolve_reschedule_request usaba review_status, que no existe en La Vilet.
DROP FUNCTION IF EXISTS public.resolve_reschedule_request(uuid, text, timestamptz, timestamptz, text);

CREATE OR REPLACE FUNCTION public.mark_appointment_attendance(
  p_appointment_id uuid,
  p_attended boolean,
  p_notes text DEFAULT NULL,
  p_visited_unit_ids uuid[] DEFAULT '{}'::uuid[]
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
declare
  a public.appointments;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  select tenant_id, project_id into a.tenant_id, a.project_id
  from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'Cita no encontrada';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(a.tenant_id::text || ':' || coalesce(a.project_id::text, ''), 0)
  );
  select * into a from public.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'Cita no encontrada';
  end if;
  if not public.agenda_can_manage_appointment(a) then
    raise exception 'No puedes registrar la asistencia';
  end if;
  if a.status not in ('aceptado', 'reprogramado', 'atendido') then
    raise exception 'Solo se registra asistencia de citas confirmadas';
  end if;

  update public.appointments set
    status = 'atendido',
    no_show = not p_attended,
    result_notes = coalesce(nullif(trim(p_notes), ''), result_notes),
    updated_at = now()
  where id = a.id
  returning * into a;

  if p_visited_unit_ids is not null and cardinality(p_visited_unit_ids) > 0 then
    update public.appointment_units
    set visited = (unit_id = any (p_visited_unit_ids))
    where appointment_id = a.id;
  end if;

  insert into public.appointment_change_log (appointment_id, actor_id, action, detail)
  values (
    a.id,
    auth.uid(),
    case when p_attended then 'asistio' else 'no_asistio' end,
    jsonb_build_object('no_show', a.no_show)
  );

  return a;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cancel_appointment(
  p_appointment_id uuid,
  p_notes text DEFAULT NULL
)
RETURNS public.appointments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
declare
  a public.appointments;
begin
  if auth.uid() is null then
    raise exception 'No autenticado';
  end if;
  select tenant_id, project_id into a.tenant_id, a.project_id
  from public.appointments where id = p_appointment_id;
  if not found then
    raise exception 'Cita no encontrada';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(a.tenant_id::text || ':' || coalesce(a.project_id::text, ''), 0)
  );
  select * into a from public.appointments where id = p_appointment_id for update;
  if not found then
    raise exception 'Cita no encontrada';
  end if;
  if not public.agenda_can_manage_appointment(a) then
    raise exception 'No puedes cancelar esta cita';
  end if;
  if a.status in ('atendido', 'cancelado') then
    raise exception 'Esta cita ya está cerrada';
  end if;

  perform public.cancel_pending_visit_outbox(a.id, 'cita cancelada');

  update public.appointments set
    status = 'cancelado',
    notes = coalesce(nullif(trim(p_notes), ''), notes),
    updated_at = now()
  where id = a.id
  returning * into a;

  insert into public.appointment_change_log (appointment_id, actor_id, action, detail)
  values (a.id, auth.uid(), 'cancelada', '{}'::jsonb);

  return a;
end;
$function$;

REVOKE ALL ON FUNCTION public.appointment_reminders_paused(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.appointment_reminders_paused(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.cancel_pending_visit_outbox(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.replace_appointment_units(uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_assert_no_conflict(uuid, timestamptz, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_assert_units(uuid, uuid, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_assert_responsible(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_pending_visit_outbox(uuid, text) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.replace_appointment_units(uuid, uuid[]) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_assert_no_conflict(uuid, timestamptz, timestamptz, uuid) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_assert_units(uuid, uuid, uuid[]) TO postgres, service_role;
GRANT EXECUTE ON FUNCTION public.agenda_assert_responsible(uuid, uuid) TO postgres, service_role;

REVOKE ALL ON FUNCTION public.agenda_can_manage_appointment(public.appointments) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_appointment(uuid, timestamptz, timestamptz, uuid, text, text, text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_confirmed_appointment(uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mark_appointment_attendance(uuid, boolean, text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_appointment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.agenda_can_manage_appointment(public.appointments) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_appointment(uuid, timestamptz, timestamptz, uuid, text, text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_confirmed_appointment(uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_appointment_attendance(uuid, boolean, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_appointment(uuid, text) TO authenticated;

-- El recordatorio visit_2h vigente sale de lavilet_due_reminders / lavilet_check_reminder.
-- Pausar aquí evita enviar aunque n8n no haya cambiado el HTTP Request.
CREATE OR REPLACE FUNCTION public.lavilet_due_reminders(p_tenant uuid, p_project uuid, p_test_phone text DEFAULT NULL::text)
RETURNS TABLE(appointment_id uuid, lead_id uuid, scheduled_start timestamp with time zone, payload jsonb)
LANGUAGE sql
STABLE
SET search_path TO public
AS $function$
select a.id, l.id, a.start_time,
  jsonb_build_object(
    'appointment_id',a.id,'lead_id',l.id,'start_time',a.start_time,
    'kommo_id',l.kommo_id,'contact_id',l.contact_id,
    'name',l.name,'phone',l.phone,'title',a.title,
    'location_type',a.location_type,
    'units',coalesce((select string_agg(u.category || ' ' || u.unit_number, ', ' order by u.unit_number)
       from public.appointment_units au join public.units u on u.id=au.unit_id
       where au.appointment_id=a.id and u.tenant_id=a.tenant_id and u.project_id=a.project_id),'')
  )
from public.appointments a
join public.leads l on l.id=a.lead_id and l.tenant_id=a.tenant_id
where a.tenant_id=p_tenant and a.project_id=p_project
  and l.project_id=p_project
  and a.status in ('pendiente','aceptado','reprogramado')
  and a.start_time <= now()+interval '2 hours'
  and a.start_time > now()+interval '110 minutes'
  and l.kommo_id > 0 and nullif(trim(l.contact_id),'') is not null
  and l.channel_origin='whatsapp'
  and l.tracking_opt_out_at is null
  and (p_test_phone is null or regexp_replace(coalesce(l.phone,''),'[^0-9]','','g')=
       regexp_replace(p_test_phone,'[^0-9]','','g'))
  and not public.appointment_reminders_paused(a.id)
  and not exists(select 1 from public.lavilet_appointment_reminders r
    where r.appointment_id=a.id and r.scheduled_start=a.start_time)
  and not exists(select 1 from public.lavilet_appointment_reminders r
    where r.lead_id=l.id and r.state in ('claimed','uncertain'))
order by a.start_time,a.id;
$function$;

CREATE OR REPLACE FUNCTION public.lavilet_check_reminder(p_id uuid)
RETURNS TABLE(reminder_id uuid, valid boolean, payload jsonb)
LANGUAGE sql
STABLE
SET search_path TO public
AS $function$
select r.id,
 r.state='claimed'
 and a.start_time=r.scheduled_start
 and a.status in ('pendiente','aceptado','reprogramado')
 and a.start_time>now()
 and a.lead_id=r.lead_id and a.tenant_id=r.tenant_id and a.project_id=r.project_id
 and l.tenant_id=r.tenant_id and l.project_id=r.project_id
 and l.tracking_opt_out_at is null
 and l.kommo_id=(r.payload->>'kommo_id')::integer
 and l.contact_id=r.payload->>'contact_id'
 and l.channel_origin='whatsapp'
 and not public.appointment_reminders_paused(a.id), r.payload
from public.lavilet_appointment_reminders r
join public.appointments a on a.id=r.appointment_id
join public.leads l on l.id=r.lead_id
where r.id=p_id;
$function$;
