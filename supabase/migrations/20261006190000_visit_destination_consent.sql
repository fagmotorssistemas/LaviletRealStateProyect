-- Restore a prior preference only when a later, current message accepts the
-- authorized destination offered in this same conversation. Questions about
-- opening hours are never consent and never reach this helper from the app.
CREATE OR REPLACE FUNCTION public.lv_verified_visit_dialogue_source(p_conversation uuid,p_current_message uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $fn$
DECLARE c public.conversations; current_message public.messages; source_message public.messages;
 state jsonb; preference jsonb; intent jsonb; policies jsonb; quote text; current_quote text;
BEGIN
 SELECT * INTO c FROM public.conversations WHERE id=p_conversation;
 SELECT * INTO current_message FROM public.messages WHERE id=p_current_message AND conversation_id=c.id AND role='cliente';
 IF c.id IS NULL OR current_message.id IS NULL OR jsonb_typeof(p_payload)<>'object' THEN RETURN NULL; END IF;
 BEGIN state:=(coalesce(nullif(c.summary,''),'{}')::jsonb)->'_visit_dialogue'; EXCEPTION WHEN OTHERS THEN RETURN NULL; END;
 preference:=p_payload->'source_preference'; intent:=p_payload->'current_intent';
 IF state->>'version' IS DISTINCT FROM 'visit-dialogue-v1' OR state->>'status' IS DISTINCT FROM 'offered'
  OR coalesce((state->>'alternative_accepted')::boolean,false)
  OR state->>'offered_destination' IS NULL OR jsonb_typeof(preference)<>'object' OR jsonb_typeof(intent)<>'object'
  OR intent->>'kind' IS DISTINCT FROM 'accept_visit_preference' OR intent->>'purpose' IS DISTINCT FROM 'accept_alternative'
  OR intent->>'target' IS DISTINCT FROM 'project' OR intent->>'confidence' IS DISTINCT FROM 'high'
  OR intent->>'destination' IS DISTINCT FROM state->>'offered_destination' THEN RETURN NULL; END IF;
 current_quote:=nullif(trim(intent->>'evidence'),'');
 IF current_quote IS NULL OR length(current_quote)>240 OR position(lower(current_quote) in lower(current_message.content))=0 THEN RETURN NULL; END IF;
 IF preference->>'confidence' IS DISTINCT FROM 'high' OR preference->>'source_message_id' IS DISTINCT FROM state#>>'{pending_preference,source_message_id}'
  OR preference->>'evidence' IS DISTINCT FROM state#>>'{pending_preference,evidence}'
  OR preference->>'canonical_text' IS DISTINCT FROM state#>>'{pending_preference,canonical_text}'
  OR preference->>'date_text' IS DISTINCT FROM state#>>'{pending_preference,date_text}'
  OR preference->>'time_text' IS DISTINCT FROM state#>>'{pending_preference,time_text}' THEN RETURN NULL; END IF;
 SELECT * INTO source_message FROM public.messages WHERE conversation_id=c.id AND role='cliente'
  AND (id::text=preference->>'source_message_id' OR external_message_id=preference->>'source_message_id')
  AND sent_at<current_message.sent_at LIMIT 1;
 IF source_message.id IS NULL THEN RETURN NULL; END IF;
 quote:=nullif(trim(preference->>'evidence'),'');
 IF quote IS NULL OR length(quote)>240 OR position(lower(quote) in lower(source_message.content))=0
  OR nullif(preference->>'canonical_text','') IS NULL OR length(preference->>'canonical_text')>160
  OR preference->>'canonical_text' !~ '^[a-z0-9:/ -]+$' THEN RETURN NULL; END IF;
 SELECT policies_json INTO policies FROM public.projects WHERE id=c.project_id AND tenant_id=c.tenant_id;
 IF NOT coalesce((policies#>'{project_readiness,current,enabledPlaces}') ? (state->>'offered_destination'),false) THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('source_id',source_message.id,'destination',state->>'offered_destination',
  'interpretation',preference-'source_message_id'-'source_at'||jsonb_build_object('location_type',state->>'offered_destination'));
END $fn$;
REVOKE ALL ON FUNCTION public.lv_verified_visit_dialogue_source(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lv_verified_visit_dialogue_source(uuid,uuid,jsonb) TO service_role;

-- Keep every existing collection, authorization, deduplication and agenda guard.
-- Add the verified original source before the existing slot calculation. The
-- preference's relative date is therefore anchored to the original message.
DO $patch$
DECLARE definition text; anchor text:='r.intake_source_ids:=draft.source_ids;'; addition text;
BEGIN
 SELECT pg_get_functiondef('public.lv_collect_visit_intake(uuid,text,boolean,uuid,jsonb)'::regprocedure) INTO definition;
 IF position('lv_verified_visit_dialogue_source' in definition)>0 THEN RETURN; END IF;
 IF position(anchor in definition)=0 OR position('interpretation jsonb; canonical_text' in definition)=0 THEN
  RAISE EXCEPTION 'Visit intake definition changed; review the narrow consent integration before applying.';
 END IF;
 addition:=$body$
 dialogue_source:=public.lv_verified_visit_dialogue_source(c.id,m.id,p_snapshot->'_visit_dialogue_consent');
 IF dialogue_source IS NOT NULL THEN
  SELECT array_agg(DISTINCT x) INTO draft.source_ids FROM (
   SELECT unnest(draft.source_ids) x UNION ALL SELECT (dialogue_source->>'source_id')::uuid
  ) verified_sources;
  draft.interpreted_source_texts:=coalesce(draft.interpreted_source_texts,'{}'::jsonb)
   ||jsonb_build_object(dialogue_source->>'source_id',dialogue_source->'interpretation');
  r.interpreted_source_texts:=draft.interpreted_source_texts;
  interpreted_location:=dialogue_source->>'destination';
 END IF;
 r.intake_source_ids:=draft.source_ids;
$body$;
 definition:=replace(definition,'interpretation jsonb; canonical_text','dialogue_source jsonb; interpretation jsonb; canonical_text');
 definition:=replace(definition,anchor,addition);
 EXECUTE definition;
END $patch$;
