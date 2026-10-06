/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { PGlite } = require('@electric-sql/pglite')
const tenant = 'a1b2c3d4-0001-4000-8000-000000000001'
const project = 'b1b2c3d4-0001-4000-8000-000000000001'
const read = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8')

async function fixture(t, migrate = true) {
  const db = new PGlite()
  t.after(() => db.close())
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;')
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/integration-schema.json'), 'utf8'))
  for (const [table, cols] of Object.entries(schema)) await db.exec(`CREATE TABLE public.${table} (${Object.entries(cols)
    .map(([column, type]) => `"${column}" ${type.startsWith('public.') ? 'text' : type}${column === 'id' ? ' PRIMARY KEY DEFAULT gen_random_uuid()' : ''}`).join(',')})`)
  await db.exec(`CREATE TABLE public.project_automation_config(project_id uuid,tenant_id uuid,timezone text,business_hours jsonb,review_sla_minutes int);
    CREATE TABLE public.appointment_time_holds(request_id uuid);
    CREATE TABLE public.lv_appointment_assignment_events(tenant_id uuid,project_id uuid,appointment_id uuid,request_id uuid,from_advisor_id uuid,to_advisor_id uuid,action text,reason text);
    CREATE FUNCTION public.lv_assign_appointment_fairly(uuid,uuid[]) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION public.lv_cancel_pending_visit_outbox(uuid,text) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION public.lv_assert_can_act_on_request(public.appointment_reschedule_requests) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION public.lv_advisor_eligible_on_project(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE FUNCTION public.lv_advisor_has_conflict(uuid,timestamptz,timestamptz,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
    CREATE FUNCTION public.lv_interval_within_business_hours(uuid,timestamptz,timestamptz) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
    CREATE FUNCTION public.lv_intake_visit_once(l uuid,p uuid,pref text,s timestamptz,e timestamptz,mid text,body text) RETURNS uuid LANGUAGE plpgsql AS $$
      DECLARE a uuid; BEGIN INSERT INTO public.appointments(tenant_id,project_id,lead_id,status,updated_at) VALUES('${tenant}',p,l,'solicitada',now()) RETURNING id INTO a;
      INSERT INTO public.appointment_reschedule_requests(tenant_id,project_id,lead_id,appointment_id,source_message_id,source_message_text,preferred_time_text,proposed_by,status,created_at)
      VALUES('${tenant}',p,l,a,mid,body,pref,'client','awaiting_advisor',now()); RETURN a; END $$;`)
  await db.query('INSERT INTO project_automation_config VALUES($1,$2,$3,$4,90)', [project, tenant, 'America/Guayaquil', Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(d => [d, { open: '00:00', close: '23:59' }]))])
  await db.query('INSERT INTO projects(id,tenant_id,name,policies_json) VALUES($1,$2,$3,$4)', [project, tenant, 'Proyecto', { project_readiness: { current: { stage: 'not_started', verifiedOn: '2026-09-17', enabledPlaces: ['office'], primaryPlace: 'office', officeAtProjectSite: true } } }])
  for (const name of ['20260910163000_visit_preference_ambiguity.sql', '20260910233000_visit_intake_collection.sql',
    '20260914193000_visit_date_context_repair.sql', '20260914233000_visit_next_week_context.sql', '20260915101000_visit_hours_before_assignment.sql',
    '20260918113000_visit_places_closed_days.sql', '20260918190000_semantic_visit_interpretation.sql']) await db.exec(read(name))
  if (migrate) await db.exec(read('20261006190000_visit_destination_consent.sql'))
  const lead = (await db.query('INSERT INTO leads(tenant_id,project_id) VALUES($1,$2) RETURNING id', [tenant, project])).rows[0].id
  const conversation = (await db.query("INSERT INTO conversations(tenant_id,project_id,lead_id,channel) VALUES($1,$2,$3,'whatsapp') RETURNING id", [tenant, project, lead])).rows[0].id
  const at = new Date(Date.now() + 60_000), later = new Date(at.getTime() + 2_000)
  const requested = new Date(at.getTime() + 7 * 86400000).toISOString().slice(0, 10)
  const body = `Quiero recorrer el edificio el ${requested} a las 10am`
  const source = (await db.query("INSERT INTO messages(conversation_id,role,content,sent_at,external_message_id) VALUES($1,'cliente',$2,$3,'original') RETURNING id", [conversation, body, at.toISOString()])).rows[0].id
  await db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'bot','La obra todavía no está habilitada. ¿Le gustaría coordinar una cita en la oficina?',$2)", [conversation, new Date(at.getTime() + 1_000).toISOString()])
  const accepted = (await db.query("INSERT INTO messages(conversation_id,role,content,sent_at,external_message_id) VALUES($1,'cliente','Sí, en la oficina',$2,'acceptance') RETURNING id", [conversation, later.toISOString()])).rows[0].id
  const preference = { evidence: body, date_text: requested, time_text: 'a las 10 am', canonical_text: `${requested} a las 10 am`,
    location_type: null, confidence: 'high', source_message_id: 'original', source_at: at.toISOString() }
  const state = { version: 'visit-dialogue-v1', status: 'offered', requested_destination: 'building', offered_destination: 'office',
    alternative_accepted: false, pending_preference: preference }
  const currentIntent = { kind: 'accept_visit_preference', purpose: 'accept_alternative', target: 'project', destination: 'office', evidence: 'Sí, en la oficina', confidence: 'high' }
  const payload = { current_intent: currentIntent, source_preference: preference }
  const saveState = async value => db.query('UPDATE conversations SET summary=$2 WHERE id=$1', [conversation, JSON.stringify({ _visit_dialogue: value })])
  await saveState(state)
  const verify = async value => (await db.query('SELECT lv_verified_visit_dialogue_source($1,$2,$3) result', [conversation, accepted, value])).rows[0].result
  const snapshot = { _interpreted_visit: { evidence: 'Sí, en la oficina', confidence: 'high', canonical_text: null, location_type: 'office' }, _visit_dialogue_consent: payload }
  const collect = async value => (await db.query('SELECT lv_collect_visit_intake($1,$2,false,NULL,$3) result', [lead, 'acceptance', value])).rows[0].result
  return { db, lead, conversation, source, accepted, requested, state, payload, preference, verify, saveState, snapshot, collect }
}

test('consent restores the verified original preference and records the current acceptance as source', async t => {
  const f = await fixture(t)
  assert.equal((await f.verify(f.payload)).source_id, f.source)
  const result = await f.collect(f.snapshot)
  assert.equal(result.action, 'submitted')
  assert.equal(result.preferred_location_type, 'office')
  assert.equal(result.slot.requested_date, f.requested)
  const [request] = (await f.db.query('SELECT source_message_id,intake_source_ids,status,interpreted_source_texts FROM appointment_reschedule_requests WHERE id=$1', [result.request_id])).rows
  assert.equal(request.source_message_id, 'acceptance')
  assert.equal(request.status, 'awaiting_advisor')
  assert.ok(request.intake_source_ids.includes(f.source))
  assert.ok(request.intake_source_ids.includes(f.accepted))
  assert.equal(request.interpreted_source_texts[f.source].evidence, f.preference.evidence)
  await f.db.exec(read('20261006190000_visit_destination_consent.sql'))
  assert.equal((await f.collect(f.snapshot)).request_id, result.request_id)
})

test('availability questions, altered evidence, missing metadata and revoked state cannot restore or register a preference', async t => {
  const f = await fixture(t)
  for (const patch of [{ purpose: 'availability_information' }, { kind: 'visit_information' }, { confidence: 'low' }, { evidence: 'acepto algo que nunca dijo' }, { target: 'other' }, { destination: 'site' }]) {
    assert.equal(await f.verify({ ...f.payload, current_intent: { ...f.payload.current_intent, ...patch } }), null)
  }
  assert.equal(await f.verify({ source_preference: f.preference, current_intent: {} }), null)
  assert.equal(await f.verify({ ...f.payload, source_preference: { ...f.preference, canonical_text: `${f.requested} a las 12 pm` } }), null)
  for (const status of ['declined', 'collecting', 'confirmed']) {
    await f.saveState({ ...f.state, status })
    assert.equal(await f.verify(f.payload), null)
  }
  await f.saveState({ ...f.state, version: undefined })
  assert.equal(await f.verify(f.payload), null)
  await f.saveState(f.state)
  const result = await f.collect({ ...f.snapshot, _visit_dialogue_consent: { ...f.payload, current_intent: { ...f.payload.current_intent, purpose: 'availability_information' } } })
  assert.equal(result.action, 'collecting')
  assert.equal((await f.db.query('SELECT count(*)::int count FROM appointments')).rows[0].count, 0)
})

test('foreign sources and newly disabled office never supply a visit time', async t => {
  const f = await fixture(t)
  const foreign = (await f.db.query("INSERT INTO conversations(tenant_id,project_id,lead_id,channel) VALUES($1,$2,$3,'whatsapp') RETURNING id", [tenant, project, f.lead])).rows[0].id
  await f.db.query('UPDATE messages SET conversation_id=$2 WHERE id=$1', [f.source, foreign])
  assert.equal(await f.verify(f.payload), null)
  await f.db.query('UPDATE messages SET conversation_id=$2 WHERE id=$1', [f.source, f.conversation])
  await f.db.query('UPDATE projects SET policies_json=$2 WHERE id=$1', [project, { project_readiness: { current: { enabledPlaces: ['site'] } } }])
  assert.equal(await f.verify(f.payload), null)
})

test('older SQL ignores the optional restoration payload safely and creates no appointment from a later yes', async t => {
  const f = await fixture(t, false)
  const result = await f.collect(f.snapshot)
  assert.equal(result.action, 'collecting')
  assert.equal(result.slot.requested_date, null)
  assert.equal((await f.db.query('SELECT count(*)::int count FROM appointments')).rows[0].count, 0)
})
