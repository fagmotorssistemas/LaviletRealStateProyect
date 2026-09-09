-- Solo después de desactivar AUTOMATION_MODE, desconectar webhook y detener el cron.
-- Exportar lv_integration_events antes de eliminarla: contiene auditoría de mensajes.
BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM public.lv_integration_events WHERE status IN ('pending','processing','uncertain')) THEN
    RAISE EXCEPTION 'Hay eventos pendientes o inciertos; reconciliar y exportar antes de revertir';
  END IF;
  IF EXISTS(SELECT 1 FROM public.lv_integration_events WHERE kind='lock' AND lease_until>now()) THEN
    RAISE EXCEPTION 'Hay un worker activo';
  END IF;
END $$;
DROP FUNCTION public.lv_app_finish(uuid,uuid[],text,jsonb);
DROP FUNCTION public.lv_app_claim(uuid);
DROP FUNCTION public.lv_app_receive(jsonb);
DROP FUNCTION public.lv_app_worker_lock(uuid,text);
DROP TABLE public.lv_integration_events;
COMMIT;
