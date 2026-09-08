-- Reversión de 20260907180000_agenda_visits.sql
-- Restaura lavilet_due_reminders y lavilet_check_reminder al contrato anterior (sin pausa).

DROP FUNCTION IF EXISTS public.cancel_appointment(uuid, text);
DROP FUNCTION IF EXISTS public.mark_appointment_attendance(uuid, boolean, text, uuid[]);
DROP FUNCTION IF EXISTS public.resolve_reschedule_request(uuid, text, timestamptz, timestamptz, text);
DROP FUNCTION IF EXISTS public.create_confirmed_appointment(uuid, uuid, uuid, text, timestamptz, timestamptz, uuid, text, text, text, uuid[]);
DROP FUNCTION IF EXISTS public.confirm_appointment(uuid, timestamptz, timestamptz, uuid, text, text, text, uuid[]);
DROP FUNCTION IF EXISTS public.replace_appointment_units(uuid, uuid[]);
DROP FUNCTION IF EXISTS public.agenda_assert_responsible(uuid, uuid);
DROP FUNCTION IF EXISTS public.agenda_assert_units(uuid, uuid, uuid[]);
DROP FUNCTION IF EXISTS public.agenda_assert_no_conflict(uuid, timestamptz, timestamptz, uuid);
DROP FUNCTION IF EXISTS public.agenda_can_manage_appointment(public.appointments);
DROP FUNCTION IF EXISTS public.cancel_pending_visit_outbox(uuid, text);
DROP FUNCTION IF EXISTS public.appointment_reminders_paused(uuid);

DROP POLICY IF EXISTS "Authenticated read appointment_change_log" ON public.appointment_change_log;
DROP POLICY IF EXISTS "Authenticated read appointment_reschedule_requests" ON public.appointment_reschedule_requests;
DROP TABLE IF EXISTS public.appointment_change_log;
-- No borrar appointment_reschedule_requests: en La Vilet ya existía antes de esta migración.

ALTER TABLE public.appointments
  DROP COLUMN IF EXISTS meeting_place,
  DROP COLUMN IF EXISTS confirmed_at,
  DROP COLUMN IF EXISTS confirmed_by;

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
 and l.channel_origin='whatsapp', r.payload
from public.lavilet_appointment_reminders r
join public.appointments a on a.id=r.appointment_id
join public.leads l on l.id=r.lead_id
where r.id=p_id;
$function$;
