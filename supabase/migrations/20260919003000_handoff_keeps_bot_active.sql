-- Asignar o escalar una consulta no equivale a detener la IA.
-- El bot solo se detiene por una acción independiente o por opt-out.

CREATE OR REPLACE FUNCTION public.lv_keep_bot_active_on_automatic_handoff()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO public
AS $function$
BEGIN
  IF OLD.bot_enabled IS TRUE
     AND NEW.bot_enabled IS FALSE
     AND NEW.tracking_opt_out_at IS NULL
     AND (
       NEW.handoff_status IS DISTINCT FROM OLD.handoff_status
       OR NEW.handoff_reason IS DISTINCT FROM OLD.handoff_reason
       OR NEW.handoff_requested_at IS DISTINCT FROM OLD.handoff_requested_at
       OR NEW.handoff_assigned_at IS DISTINCT FROM OLD.handoff_assigned_at
     ) THEN
    NEW.bot_enabled := TRUE;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS keep_bot_active_on_automatic_handoff ON public.leads;
CREATE TRIGGER keep_bot_active_on_automatic_handoff
BEFORE UPDATE OF bot_enabled, handoff_status, handoff_reason, handoff_requested_at, handoff_assigned_at, tracking_opt_out_at
ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.lv_keep_bot_active_on_automatic_handoff();

COMMENT ON FUNCTION public.lv_keep_bot_active_on_automatic_handoff() IS
  'Impide que un traspaso automático use bot_enabled como sustituto de DETENER IA; respeta el opt-out y las detenciones independientes.';
