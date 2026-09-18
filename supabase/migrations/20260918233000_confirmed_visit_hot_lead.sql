-- Una visita confirmada por el cliente convierte la intención en una señal
-- comercial fuerte y conserva en el lead al asesor responsable de la cita.

DO $migration$
BEGIN
  UPDATE public.lead_scoring_rules
  SET points = 20,
      reason = 'confirmó una cita con un asesor',
      repeatable = false,
      active = true
  WHERE event_type = 'appointment_confirmed';

  IF NOT FOUND THEN
    INSERT INTO public.lead_scoring_rules(event_type, points, reason, repeatable, active)
    VALUES ('appointment_confirmed', 20, 'confirmó una cita con un asesor', false, true);
  END IF;
END;
$migration$;

CREATE OR REPLACE FUNCTION public.lv_sync_confirmed_appointment_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
DECLARE
  v_hot_threshold integer := 60;
  v_other_score integer := 0;
  v_confirmation_points integer := 20;
  v_updated integer;
BEGIN
  IF NEW.lead_id IS NULL
     OR NEW.responsible_id IS NULL
     OR NEW.confirmed_by_client IS DISTINCT FROM true
     OR NEW.status NOT IN ('aceptado', 'reprogramado', 'atendido') THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(c.temperature_hot_min, 60)
  INTO v_hot_threshold
  FROM public.project_automation_config c
  WHERE c.project_id = NEW.project_id;

  IF NOT FOUND THEN
    v_hot_threshold := 60;
  END IF;

  SELECT coalesce(sum(e.points), 0)::integer
  INTO v_other_score
  FROM public.lead_score_events e
  WHERE e.lead_id = NEW.lead_id
    AND e.event_type <> 'appointment_confirmed';

  -- La confirmación vale al menos 20 puntos. Si el historial previo no basta,
  -- el evento recibe únicamente los puntos adicionales necesarios para llegar
  -- al umbral Caliente configurado para el proyecto.
  v_confirmation_points := greatest(20, v_hot_threshold - v_other_score);

  INSERT INTO public.lead_score_events AS existing(
    lead_id,
    event_type,
    points,
    reason,
    source_message_id,
    idempotency_key
  ) VALUES (
    NEW.lead_id,
    'appointment_confirmed',
    v_confirmation_points,
    'confirmó una cita con un asesor',
    'appointment:' || NEW.id::text,
    'milestone:appointment_confirmed'
  )
  ON CONFLICT (lead_id, idempotency_key) DO UPDATE
  SET points = greatest(existing.points, excluded.points),
      reason = excluded.reason,
      source_message_id = excluded.source_message_id;

  -- Recalcula temperatura e historial usando el mismo motor de puntaje.
  -- El evento ya existe y su clave no repetible evita cualquier duplicado.
  PERFORM public.apply_lead_events(
    NEW.lead_id,
    jsonb_build_array('appointment_confirmed'),
    'appointment:' || NEW.id::text
  );

  -- La cita ya tiene un asesor aceptado. Reutilizarlo evita que el traspaso
  -- general por rotación asigne a otra persona y pierda el contexto.
  UPDATE public.leads l
  SET assigned_to = NEW.responsible_id,
      status = CASE
        WHEN l.status IN ('vendido', 'reservado', 'cerrado', 'perdido', 'no_interesado') THEN l.status
        ELSE 'agendado'
      END,
      handoff_status = CASE
        WHEN l.assigned_to = NEW.responsible_id AND l.handoff_status = 'acknowledged' THEN 'acknowledged'
        ELSE 'assigned'
      END,
      handoff_reason = 'Lead caliente — cita confirmada',
      handoff_requested_at = coalesce(l.handoff_requested_at, now()),
      handoff_assigned_at = CASE
        WHEN l.assigned_to IS DISTINCT FROM NEW.responsible_id OR l.handoff_assigned_at IS NULL THEN now()
        ELSE l.handoff_assigned_at
      END,
      updated_at = now()
  WHERE l.id = NEW.lead_id
    AND l.tenant_id = NEW.tenant_id
    AND l.project_id = NEW.project_id;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  IF v_updated <> 1 THEN
    RAISE EXCEPTION 'La cita confirmada no coincide con un lead del mismo tenant y proyecto';
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.lv_sync_confirmed_appointment_lead() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS sync_confirmed_appointment_lead ON public.appointments;
CREATE TRIGGER sync_confirmed_appointment_lead
AFTER INSERT OR UPDATE OF confirmed_by_client, status, responsible_id
ON public.appointments
FOR EACH ROW
EXECUTE FUNCTION public.lv_sync_confirmed_appointment_lead();

-- Aplica la regla también a citas futuras ya confirmadas, incluida la prueba
-- actual, sin duplicar el evento si la migración se vuelve a ejecutar.
WITH current_confirmed AS (
  SELECT DISTINCT ON (a.lead_id) a.id
  FROM public.appointments a
  WHERE a.lead_id IS NOT NULL
    AND a.responsible_id IS NOT NULL
    AND a.confirmed_by_client = true
    AND a.status IN ('aceptado', 'reprogramado')
    AND (a.start_time IS NULL OR a.start_time >= now())
  ORDER BY a.lead_id, a.start_time ASC NULLS LAST, a.confirmed_at DESC NULLS LAST, a.id
)
UPDATE public.appointments a
SET confirmed_by_client = a.confirmed_by_client
FROM current_confirmed c
WHERE a.id = c.id;

