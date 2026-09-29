const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')

const tenant = 'a1b2c3d4-0001-4000-8000-000000000001'
const project = 'b1b2c3d4-0001-4000-8000-000000000001'
const lead = '10000000-0000-4000-8000-000000000001'
const otherLead = '10000000-0000-4000-8000-000000000002'
const unit = '20000000-0000-4000-8000-000000000605'
const otherUnit = '20000000-0000-4000-8000-000000000099'
const advisor = '30000000-0000-4000-8000-000000000001'
const advisor2 = '30000000-0000-4000-8000-000000000002'
const scoringMigration = 'supabase/migrations/20260929100000_interest_evaluation_handoff_decision.sql'
const handoffMigration = 'supabase/migrations/20260929101000_reservation_handoff_receipt.sql'
const read = path => fs.readFileSync(path, 'utf8')

async function fixture(t, migrate = true) {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table leads(id uuid primary key,tenant_id uuid,project_id uuid,name text,kommo_id bigint,
      status text default 'nuevo',stage text,temperature text default 'frio',temperature_score int default 0,
      temperature_updated_at timestamptz,updated_at timestamptz,
      assigned_to uuid,bot_enabled boolean default true,tracking_opt_out_at timestamptz,
      handoff_status text default 'none',handoff_reason text,handoff_requested_at timestamptz,
      handoff_assigned_at timestamptz,seller_response_due_at timestamptz);
    create table messages(conversation_id uuid,external_message_id text,role text,content text,sent_at timestamptz);
    create table conversations(id uuid primary key,lead_id uuid,status text default 'abierta',started_at timestamptz default now());
    create table lead_scoring_rules(event_type text primary key,points int,reason text,repeatable boolean,active boolean);
    create table project_automation_config(project_id uuid,temperature_warm_min int,temperature_hot_min int,sla_response_minutes int);
    create table lead_score_events(lead_id uuid,event_type text,points int,reason text,source_message_id text,idempotency_key text,unique(lead_id,idempotency_key));
    create table lead_temperature_history(lead_id uuid,from_temperature text,to_temperature text,score int,reason text,created_at timestamptz);
    create table stage_calls(id uuid,stage text);
    create function set_lead_stage(uuid,text,text) returns void language sql as $$
      insert into stage_calls values($1,$2); update leads set stage=$2 where id=$1;
    $$;
    create table units(id uuid primary key,tenant_id uuid,project_id uuid,is_published boolean,status text);
    create table profiles(id uuid primary key,is_active boolean);
    create table project_salespeople(id uuid default gen_random_uuid(),tenant_id uuid,project_id uuid,
      salesperson_id uuid,receives_leads boolean,last_lead_assigned_at timestamptz,rotation_order int);
    create table test_project_clock(is_open boolean); insert into test_project_clock values(true);
    create function is_project_open(uuid,timestamptz) returns boolean language sql as $$select is_open from public.test_project_clock$$;
    create function add_business_minutes(uuid,timestamptz,integer) returns timestamptz language sql as $$select $2+make_interval(mins=>$3)$$;
    create table bot_escalations(conversation_id uuid,assigned_to uuid,reason text,resolved_at timestamptz);
    create table advisor_notifications(tenant_id uuid,project_id uuid,recipient_id uuid,lead_id uuid,kind text,
      title text,body text,assignment_at timestamptz,metadata jsonb,unique(lead_id,recipient_id,assignment_at));
    insert into leads(id,tenant_id,project_id,name) values('${lead}','${tenant}','${project}','Carlos'),
      ('${otherLead}','${tenant}','10000000-0000-4000-8000-000000000099','Otro');
    insert into conversations(id,lead_id) values('${lead}','${lead}'),('${otherLead}','${otherLead}');
    insert into project_automation_config values('${project}',25,60,120);
    insert into lead_scoring_rules values('asked_reservation',25,'reserva',false,true),
      ('requested_visit',15,'visita',false,true),('asked_price',70,'precio',false,true);
    insert into units values('${unit}','${tenant}','${project}',true,'disponible'),
      ('${otherUnit}','${tenant}','10000000-0000-4000-8000-000000000099',true,'disponible');
    insert into profiles values('${advisor}',true),('${advisor2}',true);
    insert into project_salespeople(tenant_id,project_id,salesperson_id,receives_leads,rotation_order)
      values('${tenant}','${project}','${advisor}',true,1),('${tenant}','${project}','${advisor2}',true,2);
    insert into messages values
      ('${lead}','reserve','cliente','por el momento no, entonces quiero separar el departametno 605}',now()),
      ('${lead}','other','cliente','también quiero reservar',now()),
      ('${lead}','price','cliente','precio',now()),
      ('${lead}','empty-signals','cliente','gracias',now()),
      ('${lead}','bot','bot','quiero separar el 605',now()),
      ('${lead}','blank','cliente','',now()),
      ('${otherLead}','foreign','cliente','quiero separar el 605',now());
  `)
  const scoring = read('supabase/migrations/20260905140000_automation_rules.sql')
    .match(/create or replace function public\.apply_lead_events\([\s\S]*?\$function\$;/i)
  assert.ok(scoring)
  await db.exec(scoring[0])
  await db.exec(read('supabase/migrations/20260923211512_interest_evaluation_evidence.sql'))
  await db.exec(read('supabase/migrations/20260919003000_handoff_keeps_bot_active.sql'))
  const notification = read('supabase/migrations/20260920120000_advisor_manual_takeover_notifications.sql')
    .match(/CREATE OR REPLACE FUNCTION public\.lv_notify_lead_assignment\(\)[\s\S]*?EXECUTE FUNCTION public\.lv_notify_lead_assignment\(\);/)
  assert.ok(notification)
  await db.exec(notification[0])
  const install = async () => { await db.exec(read(scoringMigration)); await db.exec(read(handoffMigration)) }
  if (migrate) await install()
  return {
    db, install,
    evaluate: async (events, source = 'reserve', id = lead) => (await db.query(
      'select lv_evaluate_message_interest_v2($1,$2::jsonb,$3) result', [id, JSON.stringify(events), source]
    )).rows[0].result,
    request: async (overrides = {}) => (await db.query(
      'select lv_request_reservation_handoff($1,$2,$3::jsonb,$4,$5::jsonb) result',
      [overrides.lead ?? lead, overrides.source ?? 'reserve', JSON.stringify(overrides.units ?? [unit]),
        overrides.evidence ?? 'quiero separar el departametno 605}', overrides.evidenceIds === undefined ? null : JSON.stringify(overrides.evidenceIds)]
    )).rows[0].result,
    row: async (sql, values = []) => (await db.query(sql, values)).rows[0],
  }
}

test('scoring preserves the actual handoff decision and replays without reapplying points or assigning', async t => {
  const h = await fixture(t)
  const first = await h.evaluate(['asked_reservation'])
  assert.equal(first.handoff_required, true)
  assert.equal(first.handoff_reason, 'pregunto como reservar')
  assert.equal(first.temperature_score, 25)
  assert.equal(first.decision_source, 'apply_lead_events')
  assert.deepEqual(first.recognized_events, ['asked_reservation'])
  assert.equal(first.source_message_id, 'reserve')
  assert.ok(first.evaluation_id)
  await h.db.exec("update lead_scoring_rules set active=false,points=100 where event_type='asked_reservation'")
  const replay = await h.evaluate(['asked_reservation'])
  assert.deepEqual(replay, first)
  assert.deepEqual(await h.evaluate(['requested_visit']), first, 'same source cannot replace the original interpretation')
  assert.equal((await h.row('select count(*)::int n from stage_calls')).n, 1)
  assert.equal((await h.row('select count(*)::int n from lead_score_events')).n, 1)
  assert.equal((await h.row('select count(*)::int n from lead_reservation_requests')).n, 0)
  const state = await h.row('select temperature_score,stage,assigned_to,handoff_status from leads where id=$1', [lead])
  assert.deepEqual(state, { temperature_score: 25, stage: 'reserva_venta', assigned_to: null, handoff_status: 'none' })
})

test('v2 recovers historical advice from its snapshot without migration replay or new stage changes', async t => {
  const h = await fixture(t, false)
  await h.db.query('select lv_evaluate_message_interest($1,$2::jsonb,$3)', [lead, '["asked_price"]', 'price'])
  await h.db.query('select lv_evaluate_message_interest($1,$2::jsonb,$3)', [lead, '[]', 'empty-signals'])
  await h.install()
  assert.equal((await h.row('select count(*)::int n from stage_calls')).n, 1)
  assert.equal((await h.row('select count(*)::int n from lead_reservation_requests')).n, 0)
  await h.db.exec('update project_automation_config set temperature_hot_min=200')
  const historical = await h.evaluate(['asked_price'], 'price')
  assert.equal(historical.decision_source, 'historical_snapshot')
  assert.equal(historical.handoff_reason, 'alcanzo 60 puntos o mas')
  assert.equal(historical.temperature_score, 70)
  const noSignals = await h.evaluate([], 'empty-signals')
  assert.equal(noSignals.temperature, 'caliente')
  assert.equal(noSignals.handoff_required, false)
  assert.equal(noSignals.handoff_reason, null)
  assert.equal((await h.row('select count(*)::int n from stage_calls')).n, 1)
  assert.equal((await h.row('select count(*)::int n from lead_score_events')).n, 1)
})

test('current scoring retains visit precedence and does not create a handoff for an empty extraction', async t => {
  const h = await fixture(t)
  const first = await h.evaluate(['asked_reservation', 'requested_visit', 'asked_price'])
  assert.equal(first.handoff_reason, 'solicito una visita')
  assert.equal(first.temperature, 'caliente')
  const empty = await h.evaluate([], 'empty-signals')
  assert.equal(empty.decision_source, 'no_new_signals')
  assert.equal(empty.handoff_required, false)
  assert.equal(empty.temperature_score, 110)
  await h.db.query('select lv_evaluate_message_interest($1,$2::jsonb,$3)', [lead, '[]', 'other'])
  assert.equal((await h.row("select handoff_decision->>'decision_source' source from lead_interest_evaluations where source_message_id='other'")).source, 'no_new_signals')
})

test('reservation assigns once, records verified evidence, preserves bot and inventory, and reports current ownership on replay', async t => {
  const h = await fixture(t)
  const result = await h.request({ evidence: 'QUIERO   SEPARAR EL DEPARTAMETNO 605}' })
  assert.equal(result.request_status, 'requested')
  assert.equal(result.handoff_status, 'assigned')
  assert.equal(result.assigned_to, advisor)
  assert.equal(result.assignment_mode, 'rotated')
  assert.equal(result.replayed, false)
  assert.ok(result.response_due_at)
  assert.deepEqual(result.unit_ids, [unit])
  const replay = await h.request({ units: [otherUnit] })
  assert.equal(replay.request_id, result.request_id)
  assert.equal(replay.replayed, true)
  assert.deepEqual(replay.unit_ids, [unit], 'retry cannot replace the requested units')
  assert.equal(replay.assigned_to, advisor)
  assert.equal((await h.row('select count(*)::int n from advisor_notifications')).n, 1)
  assert.equal((await h.row('select count(*)::int n from bot_escalations')).n, 1)
  assert.equal((await h.row('select count(*)::int n from lead_reservation_requests')).n, 1)
  const state = await h.row('select bot_enabled,status,stage from leads where id=$1', [lead])
  assert.deepEqual(state, { bot_enabled: true, status: 'nuevo', stage: null })
  assert.equal((await h.row('select status from units where id=$1', [unit])).status, 'disponible')
  await h.db.query("update leads set assigned_to=$2,handoff_status='acknowledged' where id=$1", [lead, advisor2])
  const changedOwner = await h.request()
  assert.equal(changedOwner.assigned_to, advisor2)
  assert.equal(changedOwner.handoff_status, 'acknowledged')
  assert.equal(changedOwner.assignment_mode, 'rotated', 'original decision stays auditable')
})

test('reservation reuses an active existing owner outside office hours without another assignment notification', async t => {
  const h = await fixture(t)
  await h.db.query(`update leads set assigned_to=$2,handoff_status='acknowledged',
    handoff_assigned_at='2026-09-20',seller_response_due_at='2026-09-30' where id=$1`, [lead, advisor2])
  await h.db.query('update leads set bot_enabled=false where id=$1', [lead])
  await h.db.exec(`update test_project_clock set is_open=false;
    update project_salespeople set receives_leads=false where salesperson_id='${advisor2}'`)
  const result = await h.request()
  assert.equal(result.assignment_mode, 'reused')
  assert.equal(result.assigned_to, advisor2)
  assert.equal(result.handoff_status, 'acknowledged')
  assert.equal((await h.row('select count(*)::int n from advisor_notifications')).n, 1)
  const state = await h.row('select bot_enabled,handoff_assigned_at from leads where id=$1', [lead])
  assert.equal(state.bot_enabled, false)
  assert.equal(new Date(state.handoff_assigned_at).toISOString(), '2026-09-20T00:00:00.000Z')
  assert.equal((await h.row('select count(*)::int n from project_salespeople where last_lead_assigned_at is not null')).n, 0)
})

test('reservation queues without an eligible advisor and does not revive an opt-out or reserve stock', async t => {
  const h = await fixture(t)
  await h.db.exec('update profiles set is_active=false')
  await h.db.query('update leads set assigned_to=$2,bot_enabled=false,tracking_opt_out_at=now() where id=$1', [lead, advisor])
  const result = await h.request({ units: [] })
  assert.equal(result.handoff_status, 'queued')
  assert.equal(result.assigned_to, null)
  assert.equal(result.assignment_mode, 'queued')
  assert.equal(result.response_due_at, null)
  const state = await h.row('select bot_enabled,tracking_opt_out_at from leads where id=$1', [lead])
  assert.equal(state.bot_enabled, false)
  assert.ok(state.tracking_opt_out_at)
  assert.equal((await h.row('select count(*)::int n from advisor_notifications')).n, 1, 'only the earlier explicit assignment notified')
  assert.equal((await h.row('select status from units where id=$1', [unit])).status, 'disponible')
})

test('reservation queues outside office hours even when new-lead advisors are available', async t => {
  const h = await fixture(t)
  await h.db.exec('update test_project_clock set is_open=false')
  const result = await h.request()
  assert.equal(result.handoff_status, 'queued')
  assert.equal(result.assigned_to, null)
  assert.equal((await h.row('select count(*)::int n from advisor_notifications')).n, 0)
  assert.equal((await h.row('select bot_enabled from leads where id=$1', [lead])).bot_enabled, true)
})

test('both RPCs require scoped customer evidence; reservation validates units and only service role may execute', async t => {
  const h = await fixture(t)
  for (const source of ['bot', 'blank', 'foreign', 'missing']) {
    await assert.rejects(h.evaluate(['asked_reservation'], source), /CUSTOMER_EVIDENCE_REQUIRED/)
    await assert.rejects(h.request({ source }), /CUSTOMER_EVIDENCE_REQUIRED/)
  }
  await assert.rejects(h.evaluate(['asked_reservation'], 'foreign', otherLead), /INTEREST_SCOPE_MISMATCH/)
  await assert.rejects(h.request({ lead: otherLead, source: 'foreign' }), /RESERVATION_SCOPE_MISMATCH/)
  await assert.rejects(h.request({ evidence: 'asked_reservation' }), /RESERVATION_EVIDENCE_MISMATCH/)
  await assert.rejects(h.request({ evidence: '' }), /RESERVATION_EVIDENCE_MISMATCH/)
  await assert.rejects(h.request({ units: [otherUnit] }), /RESERVATION_UNIT_SCOPE_MISMATCH/)
  await assert.rejects(h.request({ units: ['not-a-uuid'] }), /INVALID_RESERVATION_UNITS/)
  await assert.rejects(h.request({ units: [null] }), /INVALID_RESERVATION_UNITS/)
  await assert.rejects(h.request({ units: { id: unit } }), /INVALID_RESERVATION_UNITS/)
  await assert.rejects(h.evaluate(['not_a_rule']), /INVALID_INTEREST_RULE/)
  await assert.rejects(h.evaluate({ asked_reservation: true }), /INVALID_INTEREST_EVENTS/)
  await h.db.query('update units set is_published=false where id=$1', [unit])
  await assert.rejects(h.request(), /RESERVATION_UNIT_SCOPE_MISMATCH/)
  assert.equal((await h.row('select count(*)::int n from lead_reservation_requests')).n, 0)
  for (const name of ['lv_evaluate_message_interest_v2(uuid,jsonb,text)', 'lv_request_reservation_handoff(uuid,text,jsonb,text,jsonb)']) {
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await h.row('select has_function_privilege($1,$2,\'execute\') allowed', [role, name])).allowed, false)
    }
    assert.equal((await h.row('select has_function_privilege(\'service_role\',$1,\'execute\') allowed', [name])).allowed, true)
  }
  for (const role of ['anon', 'authenticated', 'service_role']) {
    assert.equal((await h.row("select has_table_privilege($1,'lead_reservation_requests','INSERT') allowed", [role])).allowed, false)
  }
  await h.db.exec('set role service_role')
  try {
    assert.equal((await h.evaluate(['asked_reservation'])).handoff_required, true)
    assert.equal((await h.request({ units: [] })).request_status, 'requested')
  } finally { await h.db.exec('reset role') }
})

test('split reservation proves ordered customer messages from one conversation and keeps legacy four-argument calls valid', async t => {
  const h = await fixture(t)
  await h.db.query(`insert into messages values
    ($1,'batch-first','cliente','por ahora no, quiero separar','2026-09-29T10:00:00Z'),
    ($1,'batch-last','cliente','el departamento 605','2026-09-29T10:00:01Z'),
    ($1,'batch-later','cliente','otro mensaje','2026-09-29T10:00:02Z')`, [lead])
  const request = { source: 'batch-last', evidence: 'quiero separar el departamento 605', evidenceIds: ['batch-first', 'batch-last'] }
  await assert.rejects(h.request({ ...request, evidenceIds: ['batch-last', 'batch-first'] }), /EVIDENCE_MESSAGES_INVALID/)
  await assert.rejects(h.request({ ...request, evidenceIds: ['batch-first', 'batch-last', 'batch-last'] }), /EVIDENCE_MESSAGES_INVALID/)
  await assert.rejects(h.request({ ...request, evidenceIds: ['batch-later', 'batch-last'] }), /EVIDENCE_MESSAGES_OUT_OF_ORDER/)
  await assert.rejects(h.request({ ...request, evidenceIds: ['bot', 'batch-last'] }), /CUSTOMER_EVIDENCE_REQUIRED/)
  await assert.rejects(h.request({ ...request, evidenceIds: ['foreign', 'batch-last'] }), /CUSTOMER_EVIDENCE_REQUIRED/)
  await assert.rejects(h.request({ ...request, evidenceIds: ['blank', 'batch-last'] }), /CUSTOMER_EVIDENCE_REQUIRED/)
  await assert.rejects(h.request({ ...request, evidenceIds: ['missing', 'batch-last'] }), /CUSTOMER_EVIDENCE_REQUIRED/)
  await h.db.query("insert into conversations(id,lead_id) values($1,$2)", [unit, lead])
  await h.db.query("insert into messages values($1,'other-conversation','cliente','quiero separar','2026-09-29T10:00:00Z')", [unit])
  await assert.rejects(h.request({ ...request, evidenceIds: ['other-conversation', 'batch-last'] }), /CUSTOMER_EVIDENCE_REQUIRED/)
  await assert.rejects(h.request({ ...request, evidenceIds: ['batch-first', null, 'batch-last'] }), /EVIDENCE_MESSAGES_INVALID/)
  await assert.rejects(h.request({ ...request, evidenceIds: 'batch-last' }), /EVIDENCE_MESSAGES_INVALID/)
  const result = await h.request(request)
  assert.equal(result.handoff_status, 'assigned')
  assert.deepEqual(result.evidence_message_ids, ['batch-first', 'batch-last'])
  assert.equal((await h.request(request)).replayed, true)
  const stored = await h.row('select evidence,evidence_message_ids from lead_reservation_requests where source_message_id=$1', ['batch-last'])
  assert.deepEqual(stored, { evidence: 'quiero separar el departamento 605', evidence_message_ids: ['batch-first', 'batch-last'] })
  assert.equal((await h.row('select count(*)::int n from advisor_notifications')).n, 1)
  const legacy = await h.row('select lv_request_reservation_handoff($1,$2,$3::jsonb,$4) result',
    [lead, 'reserve', JSON.stringify([unit]), 'quiero separar el departametno 605}'])
  assert.equal(legacy.result.handoff_status, 'assigned')
  assert.deepEqual(legacy.result.evidence_message_ids, ['reserve'])
})
