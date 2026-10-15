-- Explicit project condition approved by its owner. Preserve later edits.
BEGIN;
UPDATE public.projects
SET policies_json = coalesce(policies_json, '{}'::jsonb) || jsonb_build_object('pool_access', jsonb_build_object(
  'allowTemporaryGuests', false,
  'updatedAt', '2026-10-15T18:00:00Z',
  'updatedBy', 'project-owner-approved-pool-access-2026-10-15'
)), updated_at = clock_timestamp()
WHERE id = 'b1b2c3d4-0001-4000-8000-000000000001'::uuid
  AND tenant_id = 'a1b2c3d4-0001-4000-8000-000000000001'::uuid
  AND NOT coalesce(policies_json, '{}'::jsonb) ? 'pool_access';
COMMIT;
