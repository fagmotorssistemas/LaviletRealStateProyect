/**
 * Valida la activacion en una base PGlite aislada. No usa Supabase remoto.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'

const root = path.resolve(__dirname, '../../..')
const migration = path.join(root, 'supabase/migrations/20260921143000_production_nutrition_restricted_to_carlos.sql')
const rollback = path.join(root, 'supabase/rollbacks/20260921143000_production_nutrition_restricted_to_carlos_down.sql')

describe('nutricion productiva restringida a Carlos', () => {
  it('activa los pasos aprobados y mantiene cerrados 24 h y los demas leads', async () => {
    const db = new PGlite()
    await db.exec(`
      CREATE ROLE authenticated NOLOGIN;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
        $$ SELECT null::uuid $$;
      CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE AS
        $$ SELECT true $$;

      CREATE TABLE public.projects (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL,
        policies_json jsonb,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.leads (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL,
        project_id uuid NOT NULL,
        name text,
        phone text,
        assigned_to uuid,
        bot_enabled boolean NOT NULL DEFAULT false,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE public.lv_auto_config (
        tenant_id uuid NOT NULL,
        project_id uuid NOT NULL,
        enabled boolean NOT NULL,
        dry_run boolean NOT NULL,
        test_only boolean NOT NULL,
        test_lead_id uuid
      );
      CREATE TABLE public.lv_integration_events (
        id uuid PRIMARY KEY,
        tenant_id uuid NOT NULL,
        project_id uuid NOT NULL,
        kind text NOT NULL,
        payload jsonb NOT NULL DEFAULT '{}'::jsonb
      );
      ALTER TABLE public.lv_integration_events ENABLE ROW LEVEL SECURITY;

      INSERT INTO public.projects(id, tenant_id, policies_json)
      VALUES (
        'b1b2c3d4-0001-4000-8000-000000000001',
        'a1b2c3d4-0001-4000-8000-000000000001',
        '{"existing":{"kept":true},"nutrition_week_one":{"enabled":true,"activatedAt":"2026-09-15T17:35:38.167Z","visits":true},"nutrition_later":{"2":{"enabled":true,"activatedAt":"2026-09-16T17:35:38.167Z"},"custom":{"kept":true}}}'
      );
      INSERT INTO public.leads(id, tenant_id, project_id, name, phone, bot_enabled)
      VALUES
        ('52fa6e93-4bd4-42ad-963a-666e9c7902a7', 'a1b2c3d4-0001-4000-8000-000000000001', 'b1b2c3d4-0001-4000-8000-000000000001', 'Carlos', '+593 987 110 032', false),
        ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'a1b2c3d4-0001-4000-8000-000000000001', 'b1b2c3d4-0001-4000-8000-000000000001', 'Otro lead', '0999999999', true);
      INSERT INTO public.lv_auto_config(tenant_id, project_id, enabled, dry_run, test_only, test_lead_id)
      VALUES ('a1b2c3d4-0001-4000-8000-000000000001', 'b1b2c3d4-0001-4000-8000-000000000001', false, true, false, null);
    `)

    await db.exec(fs.readFileSync(migration, 'utf8'))

    const runtime = await db.query<{
      enabled: boolean
      dry_run: boolean
      test_only: boolean
      test_lead_id: string
    }>('select enabled, dry_run, test_only, test_lead_id from public.lv_auto_config')
    assert.deepEqual(runtime.rows[0], {
      enabled: true,
      dry_run: false,
      test_only: true,
      test_lead_id: '52fa6e93-4bd4-42ad-963a-666e9c7902a7',
    })

    const leads = await db.query<{ phone: string; bot_enabled: boolean }>(
      'select phone, bot_enabled from public.leads order by phone',
    )
    assert.deepEqual(leads.rows, [
      { phone: '+593 987 110 032', bot_enabled: true },
      { phone: '0999999999', bot_enabled: false },
    ])

    const project = await db.query<{ policies_json: Record<string, unknown> }>(
      'select policies_json from public.projects',
    )
    const policies = project.rows[0].policies_json as Record<string, Record<string, unknown>>
    assert.equal((policies.existing as Record<string, unknown>).kept, true)
    assert.equal(policies.nutrition_24h.enabled, false)
    assert.equal(policies.nutrition_24h.metaApproved, false)
    assert.equal(policies.nutrition_24h.templateLinked, false)
    assert.equal(policies.nutrition_week_one.enabled, true)
    assert.equal(policies.nutrition_week_one.activatedAt, '2026-09-15T17:35:38.167Z')
    assert.equal(policies.nutrition_week_one.visits, true)
    assert.equal((policies.nutrition_later['2'] as Record<string, unknown>).enabled, true)
    assert.equal((policies.nutrition_later['2'] as Record<string, unknown>).activatedAt, '2026-09-16T17:35:38.167Z')
    assert.equal((policies.nutrition_later['3'] as Record<string, unknown>).enabled, true)
    assert.equal((policies.nutrition_later.custom as Record<string, unknown>).kept, true)

    await db.exec(fs.readFileSync(rollback, 'utf8'))
    const rolledBack = await db.query<{ policies_json: Record<string, Record<string, unknown>> }>(
      'select policies_json from public.projects',
    )
    assert.equal(rolledBack.rows[0].policies_json.nutrition_24h.enabled, false)
    assert.equal(rolledBack.rows[0].policies_json.nutrition_week_one.enabled, false)

    const restricted = await db.query<{ test_only: boolean; test_lead_id: string }>(
      'select test_only, test_lead_id from public.lv_auto_config',
    )
    assert.equal(restricted.rows[0].test_only, true)
    assert.equal(restricted.rows[0].test_lead_id, '52fa6e93-4bd4-42ad-963a-666e9c7902a7')
    await db.close()
  })
})
