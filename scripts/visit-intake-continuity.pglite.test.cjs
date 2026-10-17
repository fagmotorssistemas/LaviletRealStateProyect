/* eslint-disable @typescript-eslint/no-require-imports -- Isolated SQL regression with no external services. */
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const assert = require('node:assert/strict')
const { PGlite } = require('@electric-sql/pglite')
require('./test-typescript.cjs')
const { normalizedVisitPreference } = require('../src/lib/integrations/automation/visit-preference-contract.ts')
const { visitPreferenceFixture: metadata } = require('../src/lib/integrations/automation/fixtures/visit-preference.fixture.ts')
const { resolveVisitCalendar } = require('../src/lib/integrations/automation/visit-calendar.ts')
const tenant = 'a1b2c3d4-0001-4000-8000-000000000001'
const project = 'b1b2c3d4-0001-4000-8000-000000000001'
const migration = '20261017000000_typed_visit_preferences.sql'
const read = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8')

async function fixture(t, migrated = true) {
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
    CREATE FUNCTION public.lv_interval_within_business_hours(p_project uuid,s timestamptz,e timestamptz) RETURNS boolean LANGUAGE sql AS $$
      SELECT coalesce((s AT TIME ZONE timezone)::date=(e AT TIME ZONE timezone)::date AND
      (s AT TIME ZONE timezone)::time >= (business_hours->extract(isodow FROM s AT TIME ZONE timezone)::text->>'open')::time AND
      (e AT TIME ZONE timezone)::time <= (business_hours->extract(isodow FROM s AT TIME ZONE timezone)::text->>'close')::time,false) FROM public.project_automation_config WHERE project_id=p_project $$;
    CREATE FUNCTION public.lv_intake_visit_once(l uuid,p uuid,pref text,s timestamptz,e timestamptz,mid text,body text) RETURNS uuid LANGUAGE plpgsql AS $$
      DECLARE a uuid; BEGIN INSERT INTO public.appointments(tenant_id,project_id,lead_id,status,updated_at) VALUES('${tenant}',p,l,'solicitada',now()) RETURNING id INTO a;
      INSERT INTO public.appointment_reschedule_requests(tenant_id,project_id,lead_id,appointment_id,source_message_id,source_message_text,preferred_time_text,proposed_by,status,created_at)
      VALUES('${tenant}',p,l,a,mid,body,pref,'client','awaiting_advisor',now()); RETURN a; END $$;`)
  await db.query('INSERT INTO project_automation_config VALUES($1,$2,$3,$4,90)', [project, tenant, 'America/Guayaquil', Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(day => [day, { open: '08:30', close: '18:30' }]))])
  await db.query('INSERT INTO projects(id,tenant_id,name,policies_json) VALUES($1,$2,$3,$4)', [project, tenant, 'Proyecto', {
    project_readiness: { current: { stage: 'not_started', enabledPlaces: ['office'], primaryPlace: 'office', officeAtProjectSite: true } },
  }])
  for (const name of ['20260910163000_visit_preference_ambiguity.sql', '20260910233000_visit_intake_collection.sql',
    '20260914193000_visit_date_context_repair.sql', '20260914233000_visit_next_week_context.sql', '20260915101000_visit_hours_before_assignment.sql',
    '20260918113000_visit_places_closed_days.sql', '20260918190000_semantic_visit_interpretation.sql', '20261006190000_visit_destination_consent.sql']) await db.exec(read(name))
  if (migrated) await db.exec(read(migration))
  const lead = (await db.query('INSERT INTO leads(tenant_id,project_id) VALUES($1,$2) RETURNING id', [tenant, project])).rows[0].id
  const conversation = (await db.query("INSERT INTO conversations(tenant_id,project_id,lead_id,channel) VALUES($1,$2,$3,'whatsapp') RETURNING id", [tenant, project, lead])).rows[0].id
  const friday = new Date(Date.now() + 14 * 86400000)
  friday.setUTCDate(friday.getUTCDate() + (5 - friday.getUTCDay() + 7) % 7)
  friday.setUTCHours(20, 0, 0, 0)
  let sequence = friday.getTime()
  const turn = async (current, preference, context) => {
    const id = (await db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'cliente',$2,$3) RETURNING id", [conversation, current, new Date(sequence += 1000).toISOString()])).rows[0].id
    const snapshot = { ...(preference ? { _interpreted_visit: preference } : {}), ...(context || {}) }
    const result = (await db.query('SELECT lv_collect_visit_intake($1,$2,false,NULL,$3) result', [lead, id, snapshot])).rows[0].result
    await db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'bot','Seguimos coordinando la visita',$2)", [conversation, new Date(sequence += 1000).toISOString()])
    return { ...result, source_id: id }
  }
  return { db, lead, conversation, friday, turn }
}

const date = { kind: 'weekday', weekday: 3, week_offset: 1 }
const time = { kind: 'clock', hour: 3, minute: 0, meridiem: 'pm' }
const pref = (evidence, changes = {}) => normalizedVisitPreference(metadata({ evidence, date, time, ...changes }), evidence)

test('retired SQL text parsers cannot interpret a date or schedule a request through older callers', async t => {
  const f = await fixture(t)
  for (const body of ['O sea el miércoles a las tres', 'El miércoles 21 de octubre a las 3 de la tarde', 'mañana a las 15:00']) {
    for (const name of ['lv_parse_visit_preference', 'lv_visit_preference_parts']) {
      const parsed = (await f.db.query(`SELECT ${name}($1,$2,$3) parts`, [body, f.friday.toISOString(), 'America/Guayaquil'])).rows[0].parts
      assert.equal(parsed.confidence, 'unknown')
      assert.equal(parsed.requires_typed_recovery, true)
    }
  }
  assert.equal((await f.db.query('SELECT count(*)::int n FROM appointment_reschedule_requests')).rows[0].n, 0)
})

test('an already confirmed appointment retains its recorded times without reparsing legacy messages', async t => {
  const f = await fixture(t)
  const result = await f.turn('Miércoles a las tres', pref('Miércoles a las tres'))
  assert.equal(result.action, 'submitted')
  const start = new Date(f.friday.getTime() + 3 * 86400000).toISOString()
  const end = new Date(Date.parse(start) + 90 * 60000).toISOString()
  await f.db.query("UPDATE appointments SET status='aceptado',start_time=$2,end_time=$3 WHERE id=(SELECT appointment_id FROM appointment_reschedule_requests WHERE id=$1)", [result.request_id, start, end])
  await f.db.query("UPDATE appointment_reschedule_requests SET status='confirmed',interpreted_source_texts='{}' WHERE id=$1", [result.request_id])
  const slot = (await f.db.query('SELECT lv_requested_visit_slot(r) slot FROM appointment_reschedule_requests r WHERE id=$1', [result.request_id])).rows[0].slot
  assert.equal(slot.confidence, 'exact')
  assert.equal(Date.parse(slot.start_time), Date.parse(start))
  assert.equal(Date.parse(slot.end_time), Date.parse(end))
})

test('accepting the offered office restores separately sourced day and hour without reading either sentence', async t => {
  const f = await fixture(t)
  const at = f.friday.getTime()
  const original = []
  for (const [i, body, changes] of [
    [0, 'O sea el miércoles que viene', { date, time: { kind: 'none' } }],
    [1, 'A las tres de la tarde', { date: { kind: 'none' }, time }],
  ]) {
    const sent = new Date(at - (2 - i) * 60000).toISOString()
    const id = (await f.db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'cliente',$2,$3) RETURNING id", [f.conversation, body, sent])).rows[0].id
    original.push({ ...pref(body, changes), source: { kind: 'current', message_id: id }, source_message_id: id, source_at: sent })
  }
  const state = { version: 'visit-dialogue-v1', status: 'offered', offered_destination: 'office', alternative_accepted: false,
    requested_destination: 'model', pending_preference: original.at(-1), pending_preferences: original }
  await f.db.query('UPDATE conversations SET summary=$2 WHERE id=$1', [f.conversation, JSON.stringify({ _visit_dialogue: state })])
  const current = 'Sí, en la oficina está bien'
  const intent = { kind: 'accept_visit_preference', purpose: 'accept_alternative', target: 'project', destination: 'office', evidence: current, confidence: 'high' }
  const result = await f.turn(current, pref(current, { date: { kind: 'none' }, time: { kind: 'none' }, location_type: 'office' }), {
    _visit_dialogue_consent: { current_intent: intent, source_preference: original.at(-1), source_preferences: original },
  })
  assert.equal(result.action, 'submitted')
  assert.equal(result.slot.confidence, 'exact')
  assert.equal(new Date(result.slot.start_time).getUTCHours(), 20)
  assert.equal(new Date(result.slot.start_time).getUTCDay(), 3)
  const draft = (await f.db.query('SELECT * FROM lv_visit_intakes WHERE lead_id=$1', [f.lead])).rows[0]
  for (const component of original) assert.ok(draft.source_ids.includes(component.source_message_id))
})

test('a buffered date and clock preserve separate sources without reading the words in SQL', async t => {
  const f = await fixture(t)
  const at = f.friday.getTime()
  const dateText = 'Bueno, para el miércoles de la próxima semana'
  const timeText = 'A las tres de la tarde'
  const first = (await f.db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'cliente',$2,$3) RETURNING id", [f.conversation, dateText, new Date(at).toISOString()])).rows[0].id
  const second = (await f.db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'cliente',$2,$3) RETURNING id", [f.conversation, timeText, new Date(at + 1000).toISOString()])).rows[0].id
  const preferences = [metadata({ evidence: dateText, date, source: { kind: 'current', message_id: first } }),
    metadata({ evidence: timeText, time, source: { kind: 'current', message_id: second } })]
  const result = (await f.db.query('SELECT lv_collect_visit_intake($1,$2,false,NULL,$3) result', [f.lead, second, {
    _interpreted_visits: preferences, _current_visit_message_ids: [first, second],
  }])).rows[0].result
  assert.equal(result.action, 'submitted')
  assert.equal(new Date(result.slot.start_time).getUTCHours(), 20)
  assert.equal(new Date(result.slot.start_time).getUTCDay(), 3)
  const stored = (await f.db.query('SELECT interpreted_source_texts FROM appointment_reschedule_requests')).rows[0].interpreted_source_texts
  assert.equal(stored[first].evidence, dateText)
  assert.equal(stored[second].evidence, timeText)
})

test('typed preferences record one request independently of the words used to express the same choice', async t => {
  const f = await fixture(t)
  const first = 'Bueno, o sea, quisiera una para el miércoles'
  const partial = await f.turn(first, pref(first, { time: { kind: 'none' } }))
  assert.equal(partial.action, 'collecting')
  assert.equal(partial.slot.confidence, 'date_only')
  const current = 'Bueno, el miércoles a las 3, miércoles a las 3 de la tarde, que lo extraigan.'
  const result = await f.turn(current, pref(current))
  assert.equal(result.action, 'submitted')
  assert.equal(result.slot.confidence, 'exact')
  assert.equal(new Date(result.slot.start_time).getUTCHours(), 20)
  assert.equal(new Date(result.slot.start_time).getUTCDay(), 3)
  const requests = (await f.db.query('SELECT id,status,interpreted_source_texts FROM appointment_reschedule_requests')).rows
  assert.equal(requests.length, 1)
  assert.equal(requests[0].status, 'awaiting_advisor')
  assert.equal(requests[0].interpreted_source_texts[result.source_id].version, 'visit-preference-v2')
  assert.equal(requests[0].interpreted_source_texts[result.source_id].evidence, current)
  const duplicate = (await f.db.query('SELECT lv_collect_visit_intake($1,$2,false,NULL,$3) result', [f.lead, result.source_id, { _interpreted_visit: pref(current) }])).rows[0].result
  assert.equal(duplicate.request_id, result.request_id)
  assert.equal((await f.db.query("SELECT count(*)::int n FROM appointments WHERE status IN ('aceptado','reprogramado')")).rows[0].n, 0)
  await f.db.exec(read(migration))
  assert.equal((await f.db.query('SELECT count(*)::int n FROM appointment_reschedule_requests')).rows[0].n, 1)
})

test('missing and legacy metadata never cause SQL to recover a slot by parsing otherwise clear customer text', async t => {
  const f = await fixture(t)
  for (const [current, old] of [['Quiero ir el miércoles a las 3 pm', null], ['El miércoles a las 3 de la tarde',
    { evidence: 'El miércoles a las 3 de la tarde', confidence: 'high', canonical_text: 'miercoles a las 3 pm', date_text: 'miercoles', time_text: 'a las 3 pm' }]]) {
    const result = await f.turn(current, old)
    assert.equal(result.action, 'collecting')
    assert.equal(result.requires_typed_recovery, true)
    assert.equal(result.slot.start_time, null)
    assert.equal(result.slot.requested_date, null)
  }
  assert.equal((await f.db.query('SELECT count(*)::int n FROM appointment_reschedule_requests')).rows[0].n, 0)
  const definition = (await f.db.query("SELECT pg_get_functiondef('public.lv_collect_visit_intake(uuid,text,boolean,uuid,jsonb)'::regprocedure) body")).rows[0].body
  assert.equal(definition.includes('lv_visit_preference_parts'), false)
  assert.equal(definition.includes('lv_normalize_visit_text'), false)
  assert.equal(definition.includes('canonical_text'), false)
})

test('date/time accumulation is typed and keeps an earlier hour only for the first date or unchanged time', async t => {
  const f = await fixture(t)
  const current = 'Esta preferencia'
  const clock = await f.turn(current, pref(current, { date: { kind: 'none' } }))
  assert.equal(clock.slot.confidence, 'time_only')
  const completed = await f.turn(current, pref(current, { time: { kind: 'none' } }))
  assert.equal(completed.action, 'submitted')
  assert.equal(new Date(completed.slot.start_time).getUTCHours(), 20)
  const g = await fixture(t)
  assert.equal((await g.turn(current, pref(current, { time: { kind: 'clock', hour: 8, minute: 0, meridiem: null } }))).action, 'collecting')
  const changed = await g.turn(current, pref(current, { date: { kind: 'weekday', weekday: 4, week_offset: 1 }, time: { kind: 'none' } }))
  assert.equal(changed.slot.has_time, false)
  assert.equal(changed.action, 'collecting')
})

test('medium metadata, schema errors, explicit ambiguity and refusal preserve their own meaning', async t => {
  const f = await fixture(t)
  const current = 'La opción que le comenté'
  const ambiguous = await f.turn(current, pref(current, { decision: 'ambiguous', uncertain_fields: ['date'], date: { kind: 'none' } }))
  assert.equal(ambiguous.action, 'collecting')
  assert.equal(ambiguous.slot.start_time, null)
  const declined = await f.turn(current, pref(current, { decision: 'declined', uncertain_fields: ['time'] }))
  assert.equal(declined.action, 'collecting')
  assert.equal(declined.slot.has_time, false)
  const medium = await f.turn(current, pref(current, { confidence: 'medium' }))
  assert.equal(medium.action, 'submitted')
  const request = (await f.db.query('SELECT interpreted_source_texts FROM appointment_reschedule_requests WHERE id=$1', [medium.request_id])).rows[0]
  assert.equal(request.interpreted_source_texts[medium.source_id].confidence, 'medium')
  const g = await fixture(t)
  for (const changes of [{ evidence: 'Nunca dijo esto' }, { time: { kind: 'clock', hour: 25, minute: 0, meridiem: '24h', period: null } },
    { date: { kind: 'absolute', year: 2031, month: 2, day: 30 } }, { decision: null }]) {
    const invalid = await g.turn(current, metadata({ evidence: current, date, time, ...changes }))
    assert.equal(invalid.action, 'collecting')
    assert.equal(invalid.slot.start_time, null)
  }
})

test('a contextual acknowledgment restores original typed evidence only from this collecting conversation', async t => {
  const f = await fixture(t)
  const original = 'Bueno, el miércoles a las tres, esa es la hora'
  const source = await f.turn(original)
  assert.equal(source.action, 'collecting')
  await f.db.query('UPDATE conversations SET summary=$2 WHERE id=$1', [f.conversation, JSON.stringify({ _pending_question: { id: 'visit_date_time', act: 'visit' } })])
  const current = 'Sí, justamente esa fecha', sourceAt = (await f.db.query('SELECT sent_at FROM messages WHERE id=$1', [source.source_id])).rows[0].sent_at
  const raw = metadata({ evidence: original, date, time, source: { kind: 'history', message_id: source.source_id } })
  const answer = { question_id: 'visit_date_time', kind: 'affirmative', evidence: current, confidence: 'high' }
  const restored = normalizedVisitPreference(raw, current, { collecting: true, pendingQuestion: { id: 'visit_date_time' }, answer,
    history: [{ id: source.source_id, role: 'cliente', content: original, sent_at: sourceAt.toISOString() }] })
  assert.ok(restored)
  const result = await f.turn(current, restored, { _visit_preference_context: { question_id: 'visit_date_time', answer } })
  assert.equal(result.action, 'submitted')
  assert.equal(Date.parse(result.slot.start_time), Date.parse(resolveVisitCalendar(restored, { sourceAt, timezone: 'America/Guayaquil' }).start_time))
  const saved = (await f.db.query('SELECT interpreted_source_texts FROM appointment_reschedule_requests WHERE id=$1', [result.request_id])).rows[0]
  assert.equal(saved.interpreted_source_texts[source.source_id].evidence, original)
  assert.equal(Object.hasOwn(saved.interpreted_source_texts, result.source_id), false, 'a yes is not mislabeled as the original date declaration')
})

test('another pending object, unverified source or missing acknowledgment cannot restore historical preferences', async t => {
  const f = await fixture(t)
  const original = 'Aquel miércoles a las tres', source = await f.turn(original)
  await f.db.query('UPDATE conversations SET summary=$2 WHERE id=$1', [f.conversation, JSON.stringify({ _pending_question: { id: 'financing_invitation' } })])
  const current = 'Sí', history = metadata({ evidence: original, date, time, source: { kind: 'history', message_id: source.source_id } })
  const result = await f.turn(current, history, { _visit_preference_context: { question_id: 'visit_date_time', answer: { question_id: 'visit_date_time', kind: 'affirmative', confidence: 'high', evidence: current } } })
  assert.equal(result.action, 'collecting')
  assert.equal(result.slot.start_time, null)
  assert.equal((await f.db.query('SELECT count(*)::int n FROM appointment_reschedule_requests')).rows[0].n, 0)
})

test('SQL and pure calendar resolution agree on the same typed values, never on paraphrase spelling', async t => {
  const f = await fixture(t)
  const sourceAt = '2026-10-16T20:16:00Z', timezone = 'America/Guayaquil', current = 'Una preferencia'
  for (const fields of [{ date, time }, { date: { kind: 'relative_day', offset_days: 1 }, time },
    { date: { kind: 'weekday', weekday: 5, occurrence: 'strictly_next' }, time },
    { date: { kind: 'absolute', year: 2026, month: 10, day: 21, weekday: 3 }, time },
    { date: { kind: 'month_day', month: 10, day: 21 }, time }]) {
    const preference = pref(current, fields), pure = resolveVisitCalendar(preference, { sourceAt, timezone })
    const sql = (await f.db.query('SELECT lv_visit_typed_parts($1,$2,$3) parts', [preference, sourceAt, timezone])).rows[0].parts
    assert.equal(sql.valid, true)
    assert.equal(sql.requested_date, pure.requested_date)
    assert.deepEqual(sql.hours, pure.hours)
    assert.equal(sql.minute, pure.minute)
  }
})

