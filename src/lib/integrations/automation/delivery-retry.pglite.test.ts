import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const tenant = 'a1b2c3d4-0001-4000-8000-000000000001', project = 'b1b2c3d4-0001-4000-8000-000000000001'
async function fixture() {
  const db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE lv_integration_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,project_id uuid,
      event_key text,kind text,status text DEFAULT 'pending',contact_key text,payload jsonb DEFAULT '{}',result jsonb DEFAULT '{}',
      received_at timestamptz DEFAULT now(),available_at timestamptz DEFAULT now(),claimed_at timestamptz,claim_token uuid,
      lease_until timestamptz,completed_at timestamptz,UNIQUE(project_id,event_key));
    CREATE TABLE profiles(id uuid,role text,is_active boolean);
    CREATE TABLE leads(id uuid,tenant_id uuid,project_id uuid,contact_id text,kommo_id bigint);
    CREATE TABLE conversations(id uuid PRIMARY KEY,tenant_id uuid,project_id uuid,summary text);
    CREATE TABLE kommo_message_evidence(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,project_id uuid,contact_id text,
      external_message_id text,kommo_lead_id bigint,direction text,delivery_status text,content text,sent_at timestamptz,observed_at timestamptz DEFAULT now());`)
  const workers = readFileSync('supabase/migrations/20261005200000_conversation_workers.sql', 'utf8')
  await db.exec(workers.slice(workers.indexOf('CREATE OR REPLACE FUNCTION public.lv_app_worker_lock'), workers.indexOf('CREATE OR REPLACE FUNCTION public.lv_app_contact_lock')))
  await db.exec(readFileSync('supabase/migrations/20261006220000_transport_reliability.sql', 'utf8'))
  await db.exec(readFileSync('supabase/migrations/20261014100000_confirmed_delivery_retry.sql', 'utf8'))
  const scalar = async (sql: string, args: unknown[] = []) => Object.values((await db.query(sql, args)).rows[0] as object)[0]
  const actor = randomUUID(), conversation = randomUUID(), journalKey = '__reply_registration__:fixture'
  const ids = [randomUUID(), randomUUID(), randomUUID()], journalId = randomUUID()
  await db.query("INSERT INTO profiles VALUES($1,'admin',true)", [actor])
  const before = JSON.stringify({ historical_text: 'x'.repeat(25000) })
  await db.query('INSERT INTO conversations VALUES($1,$2,$3,$4)', [conversation, tenant, project, before])
  const add = async (id: string, kind = 'inbound', status = 'uncertain', otherProject = project) => {
    await db.query(`INSERT INTO lv_integration_events(id,tenant_id,project_id,event_key,kind,status,contact_key,payload,result,claimed_at,completed_at)
      VALUES($1::uuid,$2,$3,$1::uuid::text,$4,$5,'42:100',$6::jsonb,$7::jsonb,now(),now())`, [id, tenant, otherProject, kind, status,
      JSON.stringify({ kommoId: 42, contactId: 100, externalId: id, sentAt: new Date().toISOString(), text: 'Consulta' }),
      JSON.stringify({ reason: 'KOMMO_UNAVAILABLE', requires_review: true, delivery_uncertain: true })])
  }
  for (const id of ids) await add(id)
  const checkpoint = { version: 1, event_ids: ids, delivery_state: 'attempted', registration_state: 'pending',
    args: { p_conversation_id: conversation, p_content: 'Respuesta comprobada', p_tool_calls: { source_message_id: ids[2] } },
    summary_before: before, summary_after: JSON.stringify({ bedrooms: 3 }), retry_safe: true }
  await db.query(`INSERT INTO lv_integration_events(id,tenant_id,project_id,event_key,kind,status,contact_key,payload,result)
    VALUES($1,$2,$3,$4,'lock','completed','42:100','{"task":"reply_registration"}',$5::jsonb)`,
    [journalId, tenant, project, journalKey, JSON.stringify(checkpoint)])
  const review = (id = ids[0], outcome = 'not_sent', retry = true, provider: string | null = null, reviewer = actor) => scalar(
    'SELECT lv_app_reconcile_delivery_v2($1,$2,$3,true,$4,$5,$6)', [id, reviewer, outcome, provider, 'No salió', retry]) as Promise<Record<string, unknown>>
  return { db, scalar, actor, conversation, before, ids, journalId, add, review }
}

test('one review resolves the three-message batch and queues exactly one durable retry; duplicate saves are idempotent', async () => {
  const f = await fixture()
  try {
    const next = randomUUID(); await f.add(next, 'inbound', 'pending')
    const reviewed = await f.review()
    assert.equal(reviewed.batch_size, 3)
    assert.equal(await f.scalar("SELECT count(*)::int FROM lv_integration_events WHERE status='uncertain'"), 0)
    assert.equal(await f.scalar("SELECT count(*)::int FROM lv_integration_events WHERE kind='delivery_retry'"), 1)
    assert.equal(await f.scalar('SELECT status FROM lv_integration_events WHERE id=$1', [next]), 'pending')
    const repeated = await f.review(f.ids[1])
    assert.equal(repeated.already_reviewed, true)
    assert.equal(repeated.retry_event_id, reviewed.retry_event_id)
    assert.equal(await f.scalar("SELECT count(*)::int FROM lv_integration_events WHERE kind='delivery_retry'"), 1)
    const wake = await f.scalar("SELECT lv_app_contact_wakeup('42:100')") as Record<string, unknown>
    assert.equal(wake.event_id, reviewed.retry_event_id)
    const token = randomUUID()
    assert.equal(await f.scalar("SELECT lv_app_contact_lock($1,'42:100')", [token]), true)
    const claimed = (await f.db.query<{ id: string }>("SELECT * FROM lv_app_claim_contact($1,'42:100')", [token])).rows
    assert.deepEqual(claimed.map(row => row.id), [reviewed.retry_event_id])
    assert.equal(await f.scalar('SELECT status FROM lv_integration_events WHERE id=$1', [next]), 'pending')
  } finally { await f.db.close() }
})

test('a global worker also prioritizes the retry without merging it into new customer input', async () => {
  const f = await fixture()
  try {
    await f.add(randomUUID(), 'inbound', 'pending')
    const reviewed = await f.review(), token = randomUUID()
    assert.equal(await f.scalar("SELECT lv_app_worker_lock($1,'acquire')", [token]), true)
    assert.deepEqual((await f.db.query<{ id: string }>('SELECT * FROM lv_app_claim($1)', [token])).rows.map(row => row.id), [reviewed.retry_event_id])
  } finally { await f.db.close() }
})

test('history verification cannot be bypassed; invalid scope, actor, busy worker and accepted replies roll back the review', async () => {
  const f = await fixture()
  try {
    await assert.rejects(f.review(f.ids[0], 'not_sent', true, null, randomUUID()), /DELIVERY_REVIEW_FORBIDDEN/)
    await assert.rejects(f.review(f.ids[0], 'sent', false, 'absent'), /DELIVERY_EVIDENCE_REQUIRED/)
    const foreign = randomUUID(); await f.add(foreign, 'inbound', 'uncertain', randomUUID())
    await assert.rejects(f.review(foreign), /INCIDENT_NOT_REVIEWABLE/)
    const token = randomUUID()
    await f.scalar("SELECT lv_app_contact_lock($1,'42:100')", [token])
    await assert.rejects(f.review(), /WORKER_BUSY/)
    await f.scalar("SELECT lv_app_worker_lock($1,'release')", [token])
    await f.db.query("UPDATE lv_integration_events SET result=jsonb_set(result,'{delivery_state}','\"accepted\"') WHERE id=$1", [f.journalId])
    await assert.rejects(f.review(), /DELIVERY_OUTCOME_CONFLICT/)
    assert.equal(await f.scalar('SELECT status FROM lv_integration_events WHERE id=$1', [f.ids[0]]), 'uncertain')
    assert.equal(await f.scalar("SELECT count(*)::int FROM lv_integration_events WHERE kind='delivery_retry'"), 0)
  } finally { await f.db.close() }
})

test('confirmed delivery reconciles the entire batch against exact provider content without scheduling a resend', async () => {
  const f = await fixture()
  try {
    await f.db.query(`INSERT INTO kommo_message_evidence(tenant_id,project_id,contact_id,external_message_id,kommo_lead_id,direction,delivery_status,content,sent_at)
      VALUES($1,$2,'100','found',42,'outgoing','sent','Incorrecto',now())`, [tenant, project])
    await assert.rejects(f.review(f.ids[0], 'sent', false, 'found'), /DELIVERY_EVIDENCE_REQUIRED/)
    await f.db.exec("UPDATE kommo_message_evidence SET content='Respuesta comprobada'")
    await f.review(f.ids[0], 'sent', false, 'found')
    assert.equal(await f.scalar("SELECT count(*)::int FROM lv_integration_events WHERE kind='inbound' AND status='completed'"), 3)
    assert.equal(await f.scalar("SELECT count(*)::int FROM lv_integration_events WHERE kind='delivery_retry'"), 0)
    assert.equal(await f.scalar("SELECT result->>'delivery_state' FROM lv_integration_events WHERE id=$1", [f.journalId]), 'accepted')
  } finally { await f.db.close() }
})

test('retry is optional, requires a prepared checkpoint and is bounded; failed validation cancels nothing', async () => {
  const f = await fixture()
  try {
    await f.db.query("UPDATE lv_integration_events SET result=result||'{\"delivery_retry_count\":2}' WHERE id=$1", [f.journalId])
    await assert.rejects(f.review(), /DELIVERY_RETRY_LIMIT/)
    assert.equal(await f.scalar('SELECT status FROM lv_integration_events WHERE id=$1', [f.ids[0]]), 'uncertain')
    const reviewed = await f.review(f.ids[0], 'not_sent', false)
    assert.equal(reviewed.retry_event_id, null)
    assert.equal(await f.scalar("SELECT count(*)::int FROM lv_integration_events WHERE status='uncertain'"), 0)
  } finally { await f.db.close() }
})

test('an unrelated unknown send for the same contact is preserved and continues to block the queued retry', async () => {
  const f = await fixture()
  try {
    const unrelated = randomUUID(); await f.add(unrelated)
    await f.review()
    assert.equal(await f.scalar('SELECT status FROM lv_integration_events WHERE id=$1', [unrelated]), 'uncertain')
    assert.equal(await f.scalar("SELECT lv_app_contact_wakeup('42:100')"), null)
    const token = randomUUID()
    await f.scalar("SELECT lv_app_contact_lock($1,'42:100')", [token])
    assert.deepEqual((await f.db.query("SELECT * FROM lv_app_claim_contact($1,'42:100')", [token])).rows, [])
  } finally { await f.db.close() }
})

test('accepted retry memory uses a body comparison for a 25k snapshot and cannot overwrite newer state', async () => {
  const f = await fixture()
  try {
    const reviewed = await f.review()
    const journal = await f.scalar("SELECT id FROM lv_integration_events WHERE kind='lock' AND result->'event_ids' ? $1", [reviewed.retry_event_id])
    await assert.rejects(f.scalar('SELECT lv_app_save_retry_memory($1)', [journal]), /DELIVERY_RETRY_ACCEPTANCE_REQUIRED/)
    await f.db.query("UPDATE lv_integration_events SET result=result||'{\"delivery_state\":\"accepted\",\"registration_state\":\"registered\"}' WHERE id=$1", [journal])
    assert.equal(await f.scalar('SELECT lv_app_save_retry_memory($1)', [journal]), true)
    assert.equal(await f.scalar('SELECT summary FROM conversations WHERE id=$1', [f.conversation]), '{"bedrooms":3}')
    assert.equal(await f.scalar('SELECT lv_app_save_retry_memory($1)', [journal]), true)
    await f.db.query('UPDATE conversations SET summary=$1 WHERE id=$2', ['{"newer":true}', f.conversation])
    assert.equal(await f.scalar('SELECT lv_app_save_retry_memory($1)', [journal]), false)
    assert.equal(await f.scalar('SELECT summary FROM conversations WHERE id=$1', [f.conversation]), '{"newer":true}')
    assert.equal(await f.scalar("SELECT has_function_privilege('authenticated','lv_app_reconcile_delivery_v2(uuid,uuid,text,boolean,text,text,boolean)','EXECUTE')"), false)
  } finally { await f.db.close() }
})
