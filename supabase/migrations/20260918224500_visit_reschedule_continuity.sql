-- Keep the bot available while the client and advisor exchange visit options.
-- Two rejected advisor rounds require direct attention, but do not pause other
-- automated answers for the lead.
ALTER TABLE public.appointment_reschedule_requests
  ADD COLUMN IF NOT EXISTS proposal_rejection_count integer NOT NULL DEFAULT 0
    CHECK (proposal_rejection_count >= 0);

CREATE OR REPLACE FUNCTION public.lv_track_visit_proposal_rejections()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE parent public.appointment_reschedule_requests;
BEGIN
  IF NEW.previous_request_id IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO parent
  FROM public.appointment_reschedule_requests
  WHERE id = NEW.previous_request_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  NEW.proposal_rejection_count := coalesce(parent.proposal_rejection_count, 0);
  IF NEW.proposed_by = 'client'
    AND parent.proposed_by = 'advisor'
    AND parent.advisor_accepted_at IS NOT NULL
    AND parent.status = 'superseded' THEN
    NEW.proposal_rejection_count := NEW.proposal_rejection_count + 1;
  END IF;

  IF NEW.proposed_by = 'client'
    AND NEW.status = 'awaiting_advisor'
    AND NEW.proposal_rejection_count >= 2 THEN
    NEW.coordination_urgent_at := coalesce(NEW.coordination_urgent_at, now());
    NEW.coordination_summary := coalesce(nullif(NEW.coordination_summary, ''),
      'El cliente rechazó dos rondas de horarios. Contactar para acordar una nueva fecha. El bot permanece activo y puede seguir atendiendo otras consultas.');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS lv_track_visit_proposal_rejections ON public.appointment_reschedule_requests;
CREATE TRIGGER lv_track_visit_proposal_rejections
BEFORE INSERT ON public.appointment_reschedule_requests
FOR EACH ROW EXECUTE FUNCTION public.lv_track_visit_proposal_rejections();

NOTIFY pgrst, 'reload schema';
