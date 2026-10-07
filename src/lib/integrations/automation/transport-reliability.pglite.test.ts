import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { normalizeKommoWebhook } from './webhook'
import { compareInboundOrder } from './inbound-order'

const project = 'b1b2c3d4-0001-4000-8000-000000000001'
const tenant = 'a1b2c3d4-0001-4000-8000-000000000001'
async function fixture() {
  const db = new PGlite()
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE TABLE lv_integration_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid, project_id uuid,
      event_key text,kind text,status text DEFAULT 'pending',contact_key text,payload jsonb DEFAULT '{}',result jsonb DEFAULT '{}',
      received_at timestamptz DEFAULT now(),available_at timestamptz DEFAULT now(),claimed_at timestamptz,claim_token uuid,lease_until timestamptz,completed_at timestamptz,UNIQUE(project_id,event_key));
    CREATE TABLE leads(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,project_id uuid,contact_id text,kommo_id bigint,updated_at timestamptz DEFAULT now());
    CREATE TABLE profiles(id uuid,role text,is_active boolean);
    CREATE TABLE kommo_message_evidence(id uuid DEFAULT gen_random_uuid(),tenant_id uuid,project_id uuid,contact_id text,
      external_message_id text,kommo_lead_id bigint,direction text,delivery_status text,sent_at timestamptz,observed_at timestamptz DEFAULT now());`)
  await db.exec(readFileSync('supabase/migrations/20261006220000_transport_reliability.sql', 'utf8'))
  const scalar = async (sql: string, args: unknown[] = []) => Object.values((await db.query(sql, args)).rows[0] as object)[0]
  const add = async (key: string, kind: string, contact: string | null, status = 'pending', payload = {}) => scalar(
    `INSERT INTO lv_integration_events(tenant_id,project_id,event_key,kind,contact_key,status,payload) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING id`,
    [tenant, project, key, kind, contact, status, JSON.stringify(payload)]) as Promise<string>
  return { db, scalar, add }
}

test('normalization and receiver agree on 200; 201 fails atomically and retries deduplicate', async () => {
  const f = await fixture()
  try {
    const now = Date.now(), message = (i: number) => ({ id: `batch-${i}`, entity_id: 42, contact_id: 100,
      type: 'incoming', origin: 'waba', author: { type: 'external' }, created_at: Math.floor(now / 1000), text: 'Consulta' })
    const normalize = (count: number) => normalizeKommoWebhook(JSON.stringify({ account: { id: 36919007 }, message: { add: Array.from({ length: count }, (_, i) => message(i)) } }), 'application/json', now)
    const normalized = normalize(200)
    assert.equal(normalized.inbound.length, 200)
    assert.equal(await f.scalar('SELECT lv_app_receive($1::jsonb)', [JSON.stringify(normalized.inbound)]), 200)
    assert.equal(await f.scalar('SELECT lv_app_receive($1::jsonb)', [JSON.stringify(normalized.inbound)]), 0)
    assert.throws(() => normalize(201), /TOO_MANY_EVENTS/)
    await assert.rejects(f.scalar('SELECT lv_app_receive($1::jsonb)', [JSON.stringify([...normalized.inbound, { ...normalized.inbound[0], externalId: 'extra' }])]), /INVALID_EVENTS/)
    assert.equal(await f.scalar("SELECT count(*)::int FROM lv_integration_events WHERE kind='inbound'"), 200)
  } finally { await f.db.close() }
})

test('milliseconds preserve corrections; exact ties use database ingestion and legacy ties stay stable', async () => {
  const f = await fixture()
  try {
    const now = Date.now(), base = Math.floor(now / 1000) * 1000
    const add = [{ id: 'z-first', text: 'No', sec_created_at: base + 100 }, { id: 'a-last', text: 'Sí', sec_created_at: base + 800 }]
      .map(row => ({ ...row, created_at: base / 1000, entity_id: 42, contact_id: 100, type: 'incoming', origin: 'waba', author: { type: 'external' } }))
    const normalized = normalizeKommoWebhook(JSON.stringify({ account: { id: 36919007 }, message: { add } }), 'application/json', base + 1000)
    assert.deepEqual(normalized.inbound.sort(compareInboundOrder).map(row => row.text), ['No', 'Sí'])
    assert.deepEqual(normalized.inbound.map(row => row.sentAt), normalized.evidence.map(row => row.sentAt))
    await f.scalar('SELECT lv_app_receive($1::jsonb)', [JSON.stringify(normalized.inbound.map(row => ({ ...row, sentAt: new Date(base).toISOString(), transportSequence: 999 })))])
    const rows = (await f.db.query<{ payload: { sentAt: string; transportSequence: number; text: string } }>("SELECT payload FROM lv_integration_events WHERE kind='inbound' ORDER BY ingest_order")).rows.map(row => row.payload)
    assert.ok(rows[0].transportSequence < rows[1].transportSequence)
    assert.deepEqual(rows.reverse().sort(compareInboundOrder).map(row => row.text), ['No', 'Sí'])
    assert.equal(compareInboundOrder({ sentAt: '2026-01-01' }, { sentAt: '2026-01-01' }), 0)
  } finally { await f.db.close() }
})

test('manual without entity ID persists its resolved key and does not guess among several leads', async () => {
  const f = await fixture()
  try {
    await f.db.query('INSERT INTO leads(tenant_id,project_id,contact_id,kommo_id) VALUES($1,$2,$3,$4)', [tenant, project, '100', 42])
    const event = { externalId: 'manual', kommoId: 0, contactId: 100, userId: 9001 }
    assert.equal(await f.scalar('SELECT lv_app_receive_advisor_outbound($1::jsonb)', [JSON.stringify([event])]), 1)
    assert.equal(await f.scalar("SELECT contact_key FROM lv_integration_events WHERE event_key='advisor_outbound:manual'"), '42:100')
    assert.equal(await f.scalar('SELECT lv_app_contact_wakeup($1)', ['0:100']), null)
    assert.ok(await f.scalar('SELECT lv_app_contact_wakeup($1)', ['42:100']))
    await f.db.query('INSERT INTO leads(tenant_id,project_id,contact_id,kommo_id) VALUES($1,$2,$3,$4)', [tenant, project, '100', 43])
    await f.scalar('SELECT lv_app_receive_advisor_outbound($1::jsonb)', [JSON.stringify([{ ...event, externalId: 'ambiguous' }])])
    assert.equal(await f.scalar("SELECT contact_key FROM lv_integration_events WHERE event_key='advisor_outbound:ambiguous'"), 'contact:100')
    assert.equal(await f.scalar("SELECT (payload->>'identityAmbiguous')::boolean FROM lv_integration_events WHERE event_key='advisor_outbound:ambiguous'"), true)
  } finally { await f.db.close() }
})

test('one lead or one contact cannot own concurrent workers; distinct resources still reach cap three', async () => {
  const f = await fixture()
  try {
    const lock = (key: string) => f.scalar('SELECT lv_app_contact_lock($1,$2)', [randomUUID(), key])
    assert.equal(await lock('42:100'), true)
    assert.equal(await lock('42:101'), false)
    assert.equal(await lock('43:100'), false)
    assert.equal(await lock('43:101'), true)
    assert.equal(await lock('44:102'), true)
    assert.equal(await lock('45:103'), false)
    await assert.rejects(lock('invalid'), /INVALID_CONTACT_LEASE/)
  } finally { await f.db.close() }
})

test('maintenance progresses while contact send locks are occupied; backup cannot poison its active claim', async () => {
  const f = await fixture()
  try {
    const contact = randomUUID(), maintenance = randomUUID(), backup = randomUUID()
    await f.scalar('SELECT lv_app_contact_lock($1,$2)', [contact, '42:100'])
    assert.equal(await f.scalar("SELECT lv_app_worker_lock($1,'acquire')", [backup]), false)
    assert.equal(await f.scalar('SELECT lv_app_maintenance_lock($1)', [maintenance]), true)
    const job = await f.add('maintenance:now', 'maintenance', null)
    assert.equal((await f.db.query('SELECT * FROM lv_app_claim_maintenance($1)', [maintenance])).rows.length, 1)
    await f.scalar("SELECT lv_app_worker_lock($1,'release')", [contact])
    assert.equal(await f.scalar("SELECT lv_app_worker_lock($1,'acquire')", [backup]), true)
    await f.db.query('SELECT * FROM lv_app_claim($1)', [backup])
    assert.equal(await f.scalar('SELECT status FROM lv_integration_events WHERE id=$1', [job]), 'processing')
  } finally { await f.db.close() }
})

test('uncertainty still blocks inbound, but manual attention progresses and explicit review never replays', async () => {
  const f = await fixture()
  try {
    const actor = randomUUID(), token = randomUUID()
    await f.db.query("INSERT INTO profiles VALUES($1,'admin',true)", [actor])
    const incident = await f.add('unknown', 'inbound', '42:100', 'uncertain', { contactId: 100, kommoId: 42 })
    const next = await f.add('new', 'inbound', '42:100')
    assert.equal(await f.scalar('SELECT lv_app_contact_wakeup($1)', ['42:100']), null)
    const manual = await f.add('manual-after', 'advisor_outbound', '42:100')
    await f.scalar('SELECT lv_app_contact_lock($1,$2)', [token, '42:100'])
    assert.deepEqual((await f.db.query<{ id: string }>('SELECT * FROM lv_app_claim_contact($1,$2)', [token, '42:100'])).rows.map(row => row.id), [manual])
    await f.db.query("UPDATE lv_integration_events SET status='completed' WHERE id=$1", [manual])
    await f.scalar("SELECT lv_app_worker_lock($1,'release')", [token])
    const review = (outcome: string, reviewed: boolean, evidence: string | null = null, reviewer = actor) => f.scalar(
      'SELECT lv_app_reconcile_delivery($1,$2,$3,$4,$5,$6)', [incident, reviewer, outcome, reviewed, evidence, 'Historial de Kommo revisado'])
    await assert.rejects(review('not_sent', false), /DELIVERY_REVIEW_REQUIRED/)
    await assert.rejects(f.scalar('SELECT lv_app_reconcile_delivery($1,$2,NULL,true,NULL,$3)', [incident, actor, 'Historial de Kommo revisado']), /DELIVERY_REVIEW_REQUIRED/)
    await assert.rejects(review('not_sent', true, null, randomUUID()), /DELIVERY_REVIEW_FORBIDDEN/)
    await assert.rejects(review('sent', true, 'unobserved'), /DELIVERY_EVIDENCE_REQUIRED/)
    await f.db.query(`INSERT INTO kommo_message_evidence(tenant_id,project_id,contact_id,external_message_id,kommo_lead_id,direction,delivery_status,sent_at)
      VALUES($1,$2,'100','accepted-only',42,'outgoing','accepted',now())`, [tenant, project])
    await assert.rejects(review('sent', true, 'accepted-only'), /DELIVERY_EVIDENCE_REQUIRED/)
    assert.equal(await f.scalar('SELECT status FROM lv_integration_events WHERE id=$1', [incident]), 'uncertain')
    assert.ok(await review('not_sent', true))
    assert.equal(await f.scalar('SELECT status FROM lv_integration_events WHERE id=$1', [incident]), 'cancelled')
    assert.equal(await f.scalar('SELECT status FROM lv_integration_events WHERE id=$1', [next]), 'pending')
    assert.equal((await review('not_sent', true) as { already_reviewed: boolean }).already_reviewed, true)
    assert.ok(await f.scalar('SELECT lv_app_contact_wakeup($1)', ['42:100']))
  } finally { await f.db.close() }
})

test('account admission reserves ordered slots shared across callers and grants only service execution', async () => {
  const f = await fixture()
  try {
    const delays = await Promise.all(Array.from({ length: 3 }, () => f.scalar('SELECT lv_app_reserve_kommo_call()')))
    assert.equal(delays[0], 0)
    assert.ok(Number(delays[1]) > 200)
    assert.ok(Number(delays[2]) > Number(delays[1]) + 200)
    assert.equal(await f.scalar("SELECT has_function_privilege('anon','lv_app_reserve_kommo_call()','EXECUTE')"), false)
    assert.equal(await f.scalar("SELECT has_function_privilege('service_role','lv_app_reserve_kommo_call()','EXECUTE')"), true)
    assert.equal((await f.scalar('SELECT lv_app_transport_contract()') as { version: string }).version, 'transport-v2')
  } finally { await f.db.close() }
})

test('unknown shared lead or chat blocks other keys and cannot be reconciled during related work', async () => {
  const f = await fixture()
  try {
    const actor = randomUUID(), token = randomUUID(), globalToken = randomUUID()
    await f.db.query("INSERT INTO profiles VALUES($1,'admin',true)", [actor])
    const incident = await f.add('shared-unknown', 'inbound', '42:100', 'uncertain', { contactId: 100, kommoId: 42 })
    await f.add('same-lead', 'inbound', '42:101')
    await f.add('same-chat', 'inbound', '43:100')
    for (const key of ['42:101', '43:100']) {
      assert.equal(await f.scalar('SELECT lv_app_contact_wakeup($1)', [key]), null)
    }
    assert.equal(await f.scalar('SELECT lv_app_contact_lock($1,$2)', [token, '42:101']), true)
    assert.equal((await f.db.query('SELECT * FROM lv_app_claim_contact($1,$2)', [token, '42:101'])).rows.length, 0)
    const review = () => f.scalar('SELECT lv_app_reconcile_delivery($1,$2,$3,$4,$5,$6)', [incident, actor, 'not_sent', true, null, 'Historial revisado sin envío'])
    await assert.rejects(review(), /WORKER_BUSY/)
    await f.scalar("SELECT lv_app_worker_lock($1,'release')", [token])
    assert.equal(await f.scalar("SELECT lv_app_worker_lock($1,'acquire')", [globalToken]), true)
    assert.equal((await f.db.query('SELECT * FROM lv_app_claim($1)', [globalToken])).rows.length, 0)
    await assert.rejects(review(), /WORKER_BUSY/)
    await f.scalar("SELECT lv_app_worker_lock($1,'release')", [globalToken])
    await review()
    for (const key of ['42:101', '43:100']) assert.ok(await f.scalar('SELECT lv_app_contact_wakeup($1)', [key]))
  } finally { await f.db.close() }
})

test('expired processing on another contact of the same lead becomes uncertain before a new claim', async () => {
  const f = await fixture()
  try {
    const token = randomUUID(), oldToken = randomUUID()
    const orphan = await f.add('orphan-related', 'inbound', '42:100', 'processing')
    await f.db.query('UPDATE lv_integration_events SET claim_token=$1 WHERE id=$2', [oldToken, orphan])
    const pending = await f.add('later-related', 'inbound', '42:101')
    await f.scalar('SELECT lv_app_contact_lock($1,$2)', [token, '42:101'])
    assert.equal((await f.db.query('SELECT * FROM lv_app_claim_contact($1,$2)', [token, '42:101'])).rows.length, 0)
    assert.equal(await f.scalar('SELECT status FROM lv_integration_events WHERE id=$1', [orphan]), 'uncertain')
    assert.equal(await f.scalar('SELECT status FROM lv_integration_events WHERE id=$1', [pending]), 'pending')
  } finally { await f.db.close() }
})
