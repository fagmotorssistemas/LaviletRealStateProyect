-- Draft editing must never overwrite the information already approved for bot use.
-- The bot continues selecting existing public columns; drafts are never prompt inputs.
ALTER TABLE public.project_area_facts
  ADD COLUMN IF NOT EXISTS draft_content jsonb;

DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_area_facts_draft_content_object'
    AND conrelid = 'public.project_area_facts'::regclass) THEN
    ALTER TABLE public.project_area_facts ADD CONSTRAINT project_area_facts_draft_content_object
      CHECK (draft_content IS NULL OR jsonb_typeof(draft_content) = 'object');
  END IF;
END $migration$;

COMMENT ON COLUMN public.project_area_facts.draft_content IS
  'Administrator draft. Saving a draft preserves published fields; explicit publication verifies and approves the live content.';
