/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path')
const { PGlite } = require('@electric-sql/pglite')
test('area draft migration is idempotent, preserves approved rows and remains restricted to its own table', async () => {
  const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261007190000_project_area_fact_drafts.sql'), 'utf8')
  assert.doesNotMatch(migration, /INSERT INTO|UPDATE public|DELETE FROM|DROP TABLE|GRANT|REVOKE/i)
  const db = new PGlite()
  try {
    await db.exec("CREATE TABLE public.project_area_facts (id uuid PRIMARY KEY, safe_sales_text text NOT NULL, approved_for_bot boolean NOT NULL, review_status text NOT NULL); INSERT INTO public.project_area_facts VALUES ('40b31a51-8c57-4b0b-8dc1-8e7548b3cb32','Texto vigente confirmado',true,'verified');")
    const before = (await db.query('SELECT * FROM public.project_area_facts')).rows[0]
    await db.exec(migration); await db.exec(migration)
    const row = (await db.query('SELECT * FROM public.project_area_facts')).rows[0]
    assert.deepEqual(row, { ...before, draft_content: null })
    await db.query('UPDATE public.project_area_facts SET draft_content=$1::jsonb WHERE id=$2', [JSON.stringify({ safe_sales_text: 'Borrador nuevo no publicado' }), before.id])
    const published = (await db.query("SELECT safe_sales_text FROM public.project_area_facts WHERE approved_for_bot=true AND review_status='verified'")).rows
    assert.deepEqual(published, [{ safe_sales_text: 'Texto vigente confirmado' }])
    await assert.rejects(db.query('UPDATE public.project_area_facts SET draft_content=$1::jsonb', ['[]']), /check constraint/)
    const constraints = await db.query("SELECT count(*)::int AS count FROM pg_constraint WHERE conname='project_area_facts_draft_content_object'")
    assert.equal(constraints.rows[0].count, 1)
  } finally { await db.close() }
})
