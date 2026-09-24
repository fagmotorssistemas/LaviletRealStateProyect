-- Incremental: no rows removed; existing RLS and table ACLs remain unchanged.
-- Corrections reclassify earlier report periods using the current relationship.
BEGIN;

CREATE OR REPLACE FUNCTION public.replace_meta_ad_promoted_properties(
  p_tenant_id uuid, p_project_id uuid, p_ad_account_id text, p_ad_id text,
  p_targets jsonb, p_expected_ids uuid[], p_user_id uuid, p_note text
) RETURNS uuid[]
LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
DECLARE
  current_ids uuid[];
  new_ids uuid[] := ARRAY[]::uuid[];
  target jsonb;
  unit_target uuid;
  external_target text;
  inserted_id uuid;
  changed_at timestamptz := clock_timestamp();
BEGIN
  -- Only the authorized server action may call this routine. It verifies the
  -- signed-in user's CRM role/tenant and the ad's live Meta account beforehand.
  -- Do not grant or assume SELECT on auth.users. The server verifies getUser();
  -- existing assigned_by/superseded_by foreign keys validate persisted actor IDs.
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'authenticated_actor_required';
  END IF;
  IF p_ad_id IS NULL OR p_ad_id !~ '^[0-9]{5,30}$' OR p_ad_account_id IS NULL OR p_ad_account_id !~ '^act_[0-9]+$' THEN
    RAISE EXCEPTION 'invalid_ad_scope';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects WHERE id=p_project_id AND tenant_id=p_tenant_id) THEN
    RAISE EXCEPTION 'project_not_in_tenant';
  END IF;
  IF jsonb_typeof(p_targets) IS DISTINCT FROM 'array' OR jsonb_array_length(p_targets) NOT BETWEEN 1 AND 20
    OR p_note IS NULL OR length(btrim(p_note)) NOT BETWEEN 1 AND 1000 OR p_expected_ids IS NULL THEN
    RAISE EXCEPTION 'invalid_property_confirmation';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant_id::text || ':' || p_project_id::text || ':' || p_ad_id, 0));
  -- Legacy null accounts must be reviewed, not silently overwritten.
  IF EXISTS (SELECT 1 FROM public.meta_ad_promoted_units WHERE tenant_id=p_tenant_id AND project_id=p_project_id
      AND ad_id=p_ad_id AND superseded_at IS NULL AND ad_account_id IS DISTINCT FROM p_ad_account_id) THEN
    RAISE EXCEPTION 'existing_relation_account_mismatch';
  END IF;
  SELECT coalesce(array_agg(id ORDER BY id),ARRAY[]::uuid[]) INTO current_ids
  FROM public.meta_ad_promoted_units WHERE tenant_id=p_tenant_id AND project_id=p_project_id
    AND ad_account_id=p_ad_account_id AND ad_id=p_ad_id AND superseded_at IS NULL;
  IF current_ids IS DISTINCT FROM (SELECT coalesce(array_agg(x ORDER BY x),ARRAY[]::uuid[]) FROM unnest(p_expected_ids) x) THEN
    RAISE EXCEPTION 'property_relation_changed';
  END IF;

  -- Validate the whole replacement before superseding anything.
  FOR target IN SELECT value FROM jsonb_array_elements(p_targets) LOOP
    unit_target := nullif(target->>'unitId','')::uuid;
    external_target := nullif(btrim(target->>'externalLabel'),'');
    IF (unit_target IS NULL) = (external_target IS NULL) OR length(external_target)>160 THEN
      RAISE EXCEPTION 'choose_unit_or_external';
    END IF;
    IF unit_target IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.units
        WHERE id=unit_target AND tenant_id=p_tenant_id AND project_id=p_project_id) THEN
      RAISE EXCEPTION 'unit_not_in_tenant_project';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(p_targets)) <>
     (SELECT count(DISTINCT coalesce(nullif(value->>'unitId','')::uuid::text, lower(btrim(value->>'externalLabel')))) FROM jsonb_array_elements(p_targets)) THEN
    RAISE EXCEPTION 'duplicate_property';
  END IF;

  -- Idempotent confirmation: no new history if the actual targets did not change.
  IF (SELECT coalesce(jsonb_agg(k ORDER BY k),'[]'::jsonb) FROM
       (SELECT coalesce(unit_id::text,btrim(external_label)) k FROM public.meta_ad_promoted_units WHERE id=ANY(current_ids)) a)
    = (SELECT jsonb_agg(k ORDER BY k) FROM
       (SELECT coalesce(nullif(value->>'unitId','')::uuid::text,btrim(value->>'externalLabel')) k FROM jsonb_array_elements(p_targets)) b) THEN
    RETURN current_ids;
  END IF;
  UPDATE public.meta_ad_promoted_units SET superseded_at=changed_at,superseded_by=p_user_id
    WHERE id=ANY(current_ids);
  FOR target IN SELECT value FROM jsonb_array_elements(p_targets) LOOP
    INSERT INTO public.meta_ad_promoted_units(tenant_id,project_id,ad_account_id,ad_id,unit_id,external_label,note,assigned_by,assigned_at)
    VALUES(p_tenant_id,p_project_id,p_ad_account_id,p_ad_id,nullif(target->>'unitId','')::uuid,
      nullif(btrim(target->>'externalLabel'),''),btrim(p_note),p_user_id,changed_at)
    RETURNING id INTO inserted_id;
    new_ids := array_append(new_ids,inserted_id);
  END LOOP;
  RETURN new_ids;
END;
$$;

REVOKE ALL ON FUNCTION public.replace_meta_ad_promoted_properties(uuid,uuid,text,text,jsonb,uuid[],uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.replace_meta_ad_promoted_properties(uuid,uuid,text,text,jsonb,uuid[],uuid,text) TO service_role;
COMMENT ON FUNCTION public.replace_meta_ad_promoted_properties(uuid,uuid,text,text,jsonb,uuid[],uuid,text) IS
  'Atomic property correction; authorized server only. Keeps superseded rows and rejects stale edits. Does not modify CRM contacts or Meta delivery.';
COMMIT;
