-- Reversión de 20260916220000_whatsapp_ctwa_attribution.sql
BEGIN;
DROP FUNCTION IF EXISTS public.lv_app_get_ctwa(uuid, text);
DROP FUNCTION IF EXISTS public.lv_app_preserve_ctwa(uuid, uuid, text, bigint, text, text, text, text, text, text);
DROP TABLE IF EXISTS public.lv_whatsapp_ctwa_attribution;
COMMIT;
