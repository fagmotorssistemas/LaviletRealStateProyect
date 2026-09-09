BEGIN;
DROP FUNCTION public.lv_app_visit_context(uuid);
DROP FUNCTION public.lv_app_visit_candidates();
DROP FUNCTION public.lv_app_conversation_context(uuid,text);
COMMIT;
