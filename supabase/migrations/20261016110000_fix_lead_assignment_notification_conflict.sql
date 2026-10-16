-- Fix generic assignment alerts after reservation alerts added kind to the unique constraint.
-- Only replace the trigger function: do not replay assignments or send past notifications.
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
  -- Specialized reservation alerts are tracked separately and must not be blocked by the generic alert.
  IF current_setting('lavilet.reservation_assignment',true)='true' THEN RETURN NEW; END IF;
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
  ON CONFLICT ON CONSTRAINT advisor_notifications_assignment_uq DO NOTHING;

  RETURN NEW;
END;
$function$;
