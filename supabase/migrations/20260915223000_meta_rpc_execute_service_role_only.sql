-- Meta CAPI: RPC de backend solo ejecutables por service_role (roles de aplicación).
-- No toca identify_tour_lead ni funciones ajenas a Meta.

REVOKE ALL ON FUNCTION public.identify_tour_lead_with_meta_outbox(
  uuid, text, text, text, text, uuid, boolean, uuid, bigint, text, jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.identify_tour_lead_with_meta_outbox(
  uuid, text, text, text, text, uuid, boolean, uuid, bigint, text, jsonb
) FROM anon;
REVOKE ALL ON FUNCTION public.identify_tour_lead_with_meta_outbox(
  uuid, text, text, text, text, uuid, boolean, uuid, bigint, text, jsonb
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.identify_tour_lead_with_meta_outbox(
  uuid, text, text, text, text, uuid, boolean, uuid, bigint, text, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.lv_recover_missing_meta_lead_outbox(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lv_recover_missing_meta_lead_outbox(integer) FROM anon;
REVOKE ALL ON FUNCTION public.lv_recover_missing_meta_lead_outbox(integer) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lv_recover_missing_meta_lead_outbox(integer) TO service_role;

REVOKE ALL ON FUNCTION public.lv_revoke_meta_ads_consent(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lv_revoke_meta_ads_consent(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.lv_revoke_meta_ads_consent(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lv_revoke_meta_ads_consent(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.lv_resolve_lead_id_for_visitor(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lv_resolve_lead_id_for_visitor(uuid, text) FROM anon;
REVOKE ALL ON FUNCTION public.lv_resolve_lead_id_for_visitor(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lv_resolve_lead_id_for_visitor(uuid, text) TO service_role;

REVOKE ALL ON FUNCTION public.lv_record_meta_ads_consent(boolean, text, uuid, bigint) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lv_record_meta_ads_consent(boolean, text, uuid, bigint) FROM anon;
REVOKE ALL ON FUNCTION public.lv_record_meta_ads_consent(boolean, text, uuid, bigint) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.lv_record_meta_ads_consent(boolean, text, uuid, bigint) TO service_role;
