/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Module = require('node:module')
const load = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(__dirname, '..', 'src', id.slice(2))
  return load.call(this, id, parent, main)
}
require('./test-typescript.cjs')
const { visitDetailText, isVisitDetail, needsVisitHelp, visitTurnIntent, intakeReply } = require('../src/lib/integrations/automation/visit-intake.ts')
const { PGlite } = require('../tmp/sql-validation/node_modules/@electric-sql/pglite')
const read = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8')
const tenant = 'a1b2c3d4-0001-4000-8000-000000000001'
const project = 'b1b2c3d4-0001-4000-8000-000000000001'

test('appointment alternatives and expressive date/hour fragments route to coordination', () => {
  for (const value of ['Para mañana a las 8', 'Para mañana digo', 'Para mañanaaaanaaaaaaaaaaa', 'A las oooochoooooooi', 'Para el domimngo a las 10 am']) {
    assert.equal(isVisitDetail(value), true, value)
    assert.equal(visitTurnIntent(value), 'counterproposal', value)
  }
  assert.equal(visitDetailText('Para mañanaaaanaaaaaaaaaaa'), 'para manana')
  assert.equal(visitDetailText('A las oooochoooooooi'), 'a las ocho')
  assert.equal(visitDetailText('Para el domimngo a las 10 am'), 'para el domingo a las 10 am')
  assert.equal(isVisitDetail('¿La oficina está en el mismo lugar?'), false)
  assert.equal(visitTurnIntent('Prefiero la oficina'), 'counterproposal')
  for (const value of ['Prefiero otra\nQué opciones tiene?', 'gracias y a que hora puedo agendar??', '¿Cuándo puedo ir?', '¿Qué horarios tienen disponibles?']) {
    assert.equal(needsVisitHelp(value), true, value)
    assert.equal(visitTurnIntent(value), 'counterproposal', value)
  }
  for (const value of ['¿Qué precio tiene el 210?', 'Quiero cancelar la cita', 'Está bien, gracias', '¿El banco atiende mañana?', '¿Qué incluye el departamento?']) assert.equal(visitTurnIntent(value), null, value)
  for (const value of ['Qué opciones tiene de departamentos', 'Qué opciones tiene de locales', 'Qué opciones tiene de financiamiento']) {
    assert.equal(needsVisitHelp(value), false, value)
    assert.equal(visitTurnIntent(value), null, value)
  }
})

test('next-week corrections route as a new client preference and name relative days explicitly', () => {
  for (const value of ['El siguiente lunes a las 10 am', 'La siguiente semana el lunes a las 10 am', 'Puede ser mañana\nNo no, mejor la siguiente semana el lunes a las 10 am, puede ser?']) {
    assert.equal(visitTurnIntent(value), 'counterproposal', value)
  }
  const at = '2026-09-14T21:49:00Z'
  const result = { action: 'submitted', slot: { confidence: 'exact', requested_date: '2026-09-15', start_time: '2026-09-15T16:00:00Z', has_time: true } }
  assert.match(intakeReply(result, at), /para mañana, martes 15 de septiembre a las 11 a\. m\./)
  assert.doesNotMatch(intakeReply(result, at), /confirmamos su cita|https|Qué día/i)
  assert.match(intakeReply({ action: 'collecting', slot: { requested_date: '2026-09-14', has_time: false } }, at), /para hoy, lunes 14 de septiembre.*A qué hora/)
})

async function database() {
  const db = new PGlite()
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;')
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/integration-schema.json'), 'utf8'))
  for (const [table, cols] of Object.entries(schema)) {
    await db.exec(`CREATE TABLE public.${table} (${Object.entries(cols).map(([column, type]) => `"${column}" ${type.startsWith('public.') ? 'text' : type}${column === 'id' ? ' PRIMARY KEY DEFAULT gen_random_uuid()' : ''}`).join(',')})`)
  }
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
  await db.query('INSERT INTO project_automation_config VALUES($1,$2,$3,$4,90)', [project, tenant, 'America/Guayaquil', Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(d => [d, { open: '08:00', close: '18:00' }]))])
  await db.query('INSERT INTO projects(id,tenant_id,name,policies_json) VALUES($1,$2,$3,$4)', [project, tenant, 'La Vilet', {
    project_readiness: { current: { stage: 'building', progress: 'Obra en construcción', verifiedOn: '2026-09-18', enabledPlaces: ['site'], primaryPlace: 'site', conditions: '', materials: [] } },
  }])
  await db.exec(read('20260910163000_visit_preference_ambiguity.sql'))
  await db.exec(read('20260910233000_visit_intake_collection.sql'))
  return db
}

test('initial business-hours questions collect the client preference before requesting advisor review', async () => {
  const db = await database()
  try {
    await db.exec(read('20260914193000_visit_date_context_repair.sql'))
    await db.exec(read('20260914233000_visit_next_week_context.sql'))
    await db.exec(read('20260915101000_visit_hours_before_assignment.sql'))
    const lead = (await db.query('INSERT INTO leads(tenant_id,project_id) VALUES($1,$2) RETURNING id', [tenant, project])).rows[0].id
    const conversation = (await db.query("INSERT INTO conversations(tenant_id,project_id,lead_id,channel) VALUES($1,$2,$3,'whatsapp') RETURNING id", [tenant, project, lead])).rows[0].id
    let sequence = Date.now()
    const turn = async content => {
      const id = (await db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'cliente',$2,$3) RETURNING id", [conversation, content, new Date(sequence += 1000).toISOString()])).rows[0].id
      const result = (await db.query('SELECT lv_collect_visit_intake($1,$2,false,NULL,NULL) r', [lead, id])).rows[0].r
      await db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'bot','Indíquenos su preferencia',$2)", [conversation, new Date(sequence += 1000).toISOString()])
      return result
    }
    assert.equal((await turn('¿Qué horarios tienen? ¿Cuándo y a qué hora puedo ir?')).action, 'collecting')
    assert.equal((await db.query('SELECT count(*)::int n FROM appointment_reschedule_requests')).rows[0].n, 0)
    const partial = await turn('Para mañana')
    assert.equal(partial.action, 'collecting')
    assert.ok(partial.slot.requested_date)
    assert.equal((await db.query('SELECT count(*)::int n FROM appointment_reschedule_requests')).rows[0].n, 0)
    const complete = await turn('A las 11 am')
    assert.equal(complete.action, 'submitted')
    assert.equal(complete.slot.requested_date, partial.slot.requested_date)
    assert.equal((await db.query('SELECT status FROM appointment_reschedule_requests')).rows[0].status, 'awaiting_advisor')
    assert.equal((await db.query("SELECT count(*)::int n FROM appointments WHERE status IN ('aceptado','reprogramado')")).rows[0].n, 0)
  } finally { await db.close() }
})

test('SQL next-week migration resolves Monday corrections and never confirms a client preference', async () => {
  const db = await database()
  try {
    await db.exec(read('20260914193000_visit_date_context_repair.sql'))
    const at = '2026-09-14T21:49:00Z'
    const parts = async (value, reference = at) => (await db.query('SELECT lv_visit_preference_parts($1,$2,$3) p', [value, reference, 'America/Guayaquil'])).rows[0].p
    assert.equal((await parts('El siguiente lunes a las 10 am')).requested_date, '2026-09-14', 'reproduce deployed same-day/past failure')
    await db.exec(read('20260914233000_visit_next_week_context.sql'))
    const corrected = 'Puede ser mañana\nNo no, mejor la siguiente semana el lunes a las 10 am, puede ser?'
    for (const value of [corrected, 'El siguiente lunes a las 10 am', 'El próximo lunes a las 10 am', 'La próxima semana el lunes a las 10 am', 'El lunes de la semana que viene a las 10 am', 'El lunes siguiente a las 10 am', 'Para el lunes de la semana entrante a las 10 am']) {
      const result = await parts(value)
      assert.equal(result.requested_date, '2026-09-21', value)
      assert.deepEqual(result.hours, [10], value)
    }
    assert.equal((await parts('El martes de la siguiente semana a las 10 am')).requested_date, '2026-09-22')
    assert.equal((await parts('El siguiente lunes a las 10 am', '2026-09-15T18:00:00Z')).requested_date, '2026-09-21')
    assert.equal((await parts('El lunes de esta semana a las 10 am', '2026-09-15T18:00:00Z')).requested_date, '2026-09-14', 'do not silently move a genuinely past explicit week')
    assert.equal((await parts('El lunes a las 10 am')).requested_date, '2026-09-14')
    assert.equal((await parts('Mañana a las 11')).requested_date, '2026-09-15')
    assert.equal((await parts('Hoy a las 5 pm')).requested_date, '2026-09-14')
    assert.equal((await parts('El lunes de la próxima semana a las 10 am', '2026-12-28T20:00:00Z')).requested_date, '2027-01-04')
    for (const value of ['La próxima semana a las 10 am', 'El lunes o martes de la próxima semana a las 10 am', 'Dentro de dos semanas el lunes a las 10 am']) assert.equal((await parts(value)).ambiguous, true, value)
    assert.equal((await parts('No puedo el siguiente lunes a las 10 am')).clear_date, true)
    assert.equal((await parts('Prefiero otra opción')).clear_date, true)
    const exact = (await db.query('SELECT lv_parse_visit_preference($1,$2,$3) p', [corrected, at, 'America/Guayaquil'])).rows[0].p
    assert.equal(exact.confidence, 'exact')
    assert.equal(exact.requested_date, '2026-09-21')
    assert.equal(new Date(exact.start_time).toISOString(), '2026-09-21T15:00:00.000Z')

    const nextMonday = (await db.query("SELECT ((clock_timestamp() AT TIME ZONE 'America/Guayaquil')::date-extract(isodow FROM clock_timestamp() AT TIME ZONE 'America/Guayaquil')::int+8)::text d")).rows[0].d
    const lead = (await db.query('INSERT INTO leads(tenant_id,project_id) VALUES($1,$2) RETURNING id', [tenant, project])).rows[0].id
    const conversation = (await db.query("INSERT INTO conversations(tenant_id,project_id,lead_id,channel) VALUES($1,$2,$3,'whatsapp') RETURNING id", [tenant, project, lead])).rows[0].id
    let sequence = Date.now()
    const message = async (role, content) => (await db.query('INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,$2,$3,$4) RETURNING id', [conversation, role, content, new Date(sequence += 1000).toISOString()])).rows[0].id
    await message('cliente', 'Puede ser mañana')
    const correctionId = await message('cliente', 'No no, mejor la siguiente semana el lunes a las 10 am, puede ser?')
    const first = (await db.query('SELECT lv_collect_visit_intake($1,$2,false,NULL,NULL) r', [lead, correctionId])).rows[0].r
    assert.equal(first.action, 'submitted')
    assert.equal(first.slot.requested_date, nextMonday)
    assert.equal(new Date(first.slot.start_time).getUTCHours(), 15)
    await message('bot', 'Revisaremos ese horario.')
    const repeatId = await message('cliente', 'El siguiente lunes a las 10 am')
    const second = (await db.query('SELECT lv_collect_visit_intake($1,$2,false,$3,NULL) r', [lead, repeatId, first.request_id])).rows[0].r
    assert.equal(second.action, 'submitted')
    assert.equal(second.slot.requested_date, nextMonday)
    assert.equal((await db.query("SELECT count(*)::int n FROM appointments WHERE status IN ('aceptado','reprogramado')")).rows[0].n, 0)
    assert.equal((await db.query('SELECT content FROM messages WHERE id=$1', [correctionId])).rows[0].content, 'No no, mejor la siguiente semana el lunes a las 10 am, puede ser?', 'raw message is preserved')
  } finally { await db.close() }
})

test('SQL migration fixes the real mañana regression, preserves fragments and rejects obsolete options', async () => {
  const db = await database()
  try {
    const parts = async value => (await db.query('SELECT lv_visit_preference_parts($1,$2,$3) p', [value, '2026-09-14T18:23:06Z', 'America/Guayaquil'])).rows[0].p
    assert.equal((await parts('Para mañana a las 8')).requested_date, null, 'reproduce deployed parser failure before migration')
    await db.exec(read('20260914193000_visit_date_context_repair.sql'))
    for (const value of ['Para mañana a las 8', 'Para mañana digo', 'Para mañana no digo', 'Para mañanaaaanaaaaaaaaaaa']) assert.equal((await parts(value)).requested_date, '2026-09-15', value)
    for (const value of ['mañana a las 8 a. m.', 'mañana a las 8 am', 'mañana a las ocho de la mañana']) assert.deepEqual((await parts(value)).hours, [8], value)
    assert.deepEqual((await parts('A las oooochoooooooi')).hours, [8, 20])
    assert.equal((await parts('No puedo mañana')).clear_date, true)
    assert.equal((await parts('Prefiero otra')).clear_time, true)
    assert.equal((await parts('Qué opciones tiene?')).clear_date, true)
    assert.equal((await parts('Mañana o el viernes')).ambiguous, true)
    assert.deepEqual((await parts('No puedo a esa hora, mejor a las 3')).hours, [3, 15])
    assert.equal((await parts('Prefiero otra opción para mañana a las 8')).requested_date, '2026-09-15')
    assert.deepEqual((await parts('Prefiero otro horario a las 3')).hours, [3, 15])
    assert.equal((await parts('Prefiero otra fecha para el 15 de septiembre')).requested_date, '2026-09-15')
    assert.equal((await parts('Para el 2026-02-30 a las 8')).ambiguous, true)
    const tomorrow = (await db.query("SELECT ((clock_timestamp() AT TIME ZONE 'America/Guayaquil')::date+1)::text d")).rows[0].d
    const lead = (await db.query('INSERT INTO leads(tenant_id,project_id) VALUES($1,$2) RETURNING id', [tenant, project])).rows[0].id
    const conversation = (await db.query("INSERT INTO conversations(tenant_id,project_id,lead_id,channel) VALUES($1,$2,$3,'whatsapp') RETURNING id", [tenant, project, lead])).rows[0].id
    let sequence = Date.now()
    const message = async content => (await db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'cliente',$2,$3) RETURNING id", [conversation, content, new Date(sequence += 1000).toISOString()])).rows[0].id
    const botMessage = async content => db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'bot',$2,$3)", [conversation, content, new Date(sequence += 1000).toISOString()])
    const turn = async (value, previous = null, help = false) => {
      const id = await message(value)
      const result = (await db.query('SELECT lv_collect_visit_intake($1,$2,$3,$4,NULL) r', [lead, id, help, previous])).rows[0].r
      await botMessage('Respuesta del bot')
      return result
    }
    assert.equal((await turn('Quiero agendar mi visita')).action, 'collecting')
    assert.equal((await turn('Para mañanaaaanaaaaaaaaaaa')).slot.requested_date, tomorrow)
    let result = await turn('A las oooochoooooooi')
    assert.equal(result.action, 'submitted')
    assert.equal(result.slot.requested_date, tomorrow)
    assert.equal(result.slot.confidence, 'exact')
    assert.equal(new Date(result.slot.start_time).getUTCHours(), 13)
    const appointment = (await db.query('SELECT appointment_id FROM appointment_reschedule_requests WHERE id=$1', [result.request_id])).rows[0].appointment_id
    await db.query("UPDATE appointment_reschedule_requests SET status='superseded' WHERE id=$1", [result.request_id])
    const advisorProposal = (await db.query("INSERT INTO appointment_reschedule_requests(tenant_id,project_id,lead_id,appointment_id,previous_request_id,proposed_by,status,proposed_start_time,proposed_end_time,created_at) VALUES($1,$2,$3,$4,$5,'advisor','awaiting_client',$6,$7,clock_timestamp()) RETURNING id", [tenant, project, lead, appointment, result.request_id, tomorrow + 'T14:00:00-05:00', tomorrow + 'T15:00:00-05:00'])).rows[0].id
    await message('Prefiero otra')
    result = await turn('Qué opciones tiene?', advisorProposal)
    assert.equal(result.action, 'submitted')
    assert.equal(result.needs_help, true)
    assert.equal(result.slot.start_time, null, 'do not resubmit the advisor time rejected by the client')
    const previous = result.request_id
    await message('Queiro reagendar mi cita')
    result = await turn('Para mañana a las 8', previous)
    assert.equal(result.action, 'submitted')
    assert.equal(result.slot.requested_date, tomorrow)
    assert.equal(new Date(result.slot.start_time).getUTCHours(), 13)
    assert.equal((await db.query('SELECT content FROM messages WHERE content=$1', ['A las oooochoooooooi'])).rows.length, 1, 'raw transcript is unchanged')
    assert.equal((await db.query("SELECT count(*)::int n FROM appointments WHERE status IN ('aceptado','reprogramado')")).rows[0].n, 0, 'client preference does not confirm availability')
    await db.query('UPDATE project_automation_config SET business_hours=$1', [Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map(d => [d, { open: '08:30', close: '18:30' }]))])
    const previousExact = result.request_id
    result = await turn('Quiero reagendar para mañana a las 8', previousExact)
    assert.equal(result.action, 'collecting')
    assert.equal(result.slot.requested_date, tomorrow)
    assert.deepEqual(result.slot.hours, [8, 20])
    await botMessage('¿Se refiere a las ocho de la mañana o de la tarde?')
    result = await turn('Mañana', previousExact)
    assert.equal(result.action, 'submitted')
    assert.equal(result.review_reason, 'outside_hours')
    assert.equal(result.needs_help, true)
    assert.equal(result.slot.requested_date, tomorrow)
    assert.equal(new Date(result.slot.start_time).getUTCHours(), 13, 'meridiem clarification preserves the original eight oclock')
  } finally { await db.close() }
})

test('current enabled places are preserved, office can be selected, and closed days never notify an advisor', async () => {
  const db = await database()
  try {
    await db.exec(read('20260914193000_visit_date_context_repair.sql'))
    await db.exec(read('20260914233000_visit_next_week_context.sql'))
    await db.exec(read('20260915101000_visit_hours_before_assignment.sql'))
    await db.exec(read('20260918113000_visit_places_closed_days.sql'))
    await db.query('UPDATE projects SET policies_json=$1 WHERE id=$2', [{
      project_readiness: { current: { stage: 'building', progress: 'Obra en construcción', verifiedOn: '2026-09-18', enabledPlaces: ['site','office'], primaryPlace: 'site', conditions: '', materials: [] } },
    }, project])
    await db.query('UPDATE project_automation_config SET business_hours=$1', [{
      1:{open:'08:30',close:'18:30'},2:{open:'08:30',close:'18:30'},3:{open:'08:30',close:'18:30'},
      4:{open:'08:30',close:'18:30'},5:{open:'08:30',close:'18:30'},6:{open:'09:30',close:'13:30'},
    }])
    assert.equal((await db.query("SELECT lv_normalize_visit_text('domimngo') value")).rows[0].value, 'domingo')
    const lead = (await db.query('INSERT INTO leads(tenant_id,project_id) VALUES($1,$2) RETURNING id', [tenant, project])).rows[0].id
    const conversation = (await db.query("INSERT INTO conversations(tenant_id,project_id,lead_id,channel) VALUES($1,$2,$3,'whatsapp') RETURNING id", [tenant, project, lead])).rows[0].id
    let sequence = Date.now()
    const turn = async content => {
      const id=(await db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'cliente',$2,$3) RETURNING id",[conversation,content,new Date(sequence+=1000).toISOString()])).rows[0].id
      const result=(await db.query('SELECT lv_collect_visit_intake($1,$2,false,NULL,NULL) r',[lead,id])).rows[0].r
      await db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'bot','Respuesta de coordinación',$2)",[conversation,new Date(sequence+=1000).toISOString()])
      return result
    }
    const sunday=await turn('Para el domimngo a las 10 am')
    assert.equal(sunday.action,'closed_day')
    assert.equal((await db.query('SELECT count(*)::int n FROM appointment_reschedule_requests')).rows[0].n,0)
    const location=await turn('El lunes a las 10 am')
    assert.equal(location.action,'collecting')
    assert.equal(location.needs_location,true)
    assert.deepEqual(location.enabled_places,['site','office'])
    assert.match(intakeReply(location),/terreno del proyecto o nuestra oficina/)
    assert.equal((await db.query('SELECT count(*)::int n FROM appointment_reschedule_requests')).rows[0].n,0)
    const submitted=await turn('Prefiero la oficina')
    assert.equal(submitted.action,'submitted')
    assert.equal(submitted.preferred_location_type,'office')
    const saved=(await db.query('SELECT r.preferred_location_type,a.location_type FROM appointment_reschedule_requests r JOIN appointments a ON a.id=r.appointment_id WHERE r.id=$1',[submitted.request_id])).rows[0]
    assert.deepEqual(saved,{preferred_location_type:'office',location_type:'oficina'})
  } finally { await db.close() }
})

test('semantic extraction survives spelling errors without changing the raw visit message', async () => {
  const db = await database()
  try {
    await db.exec(read('20260914193000_visit_date_context_repair.sql'))
    await db.exec(read('20260914233000_visit_next_week_context.sql'))
    await db.exec(read('20260915101000_visit_hours_before_assignment.sql'))
    await db.exec(read('20260918113000_visit_places_closed_days.sql'))
    await db.exec(read('20260918190000_semantic_visit_interpretation.sql'))
    await db.query('UPDATE projects SET policies_json=$1 WHERE id=$2', [{
      project_readiness: { current: { stage: 'building', progress: 'Obra en construcción', verifiedOn: '2026-09-18', enabledPlaces: ['site','office'], primaryPlace: 'site', conditions: '', materials: [] } },
    }, project])
    const lead = (await db.query('INSERT INTO leads(tenant_id,project_id) VALUES($1,$2) RETURNING id', [tenant, project])).rows[0].id
    const conversation = (await db.query("INSERT INTO conversations(tenant_id,project_id,lead_id,channel) VALUES($1,$2,$3,'whatsapp') RETURNING id", [tenant, project, lead])).rows[0].id
    const rawDate = 'Quiero ir el luness a la ofisina'
    const dateId = (await db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'cliente',$2,clock_timestamp()) RETURNING id", [conversation, rawDate])).rows[0].id
    const dateInterpretation = { _interpreted_visit: { evidence: 'luness a la ofisina', date_text: 'lunes', time_text: null,
      location_type: 'office', canonical_text: 'lunes', confidence: 'high' } }
    const partial = (await db.query('SELECT lv_collect_visit_intake($1,$2,false,NULL,$3) r', [lead, dateId, dateInterpretation])).rows[0].r
    assert.equal(partial.action, 'collecting')
    assert.ok(partial.slot.requested_date)
    await db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'bot','¿A qué hora le gustaría visitarnos?',clock_timestamp())", [conversation])
    const rawTime = 'A las dies am'
    const timeId = (await db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'cliente',$2,clock_timestamp()) RETURNING id", [conversation, rawTime])).rows[0].id
    const timeInterpretation = { _interpreted_visit: { evidence: 'dies am', date_text: null, time_text: 'a las 10 am',
      location_type: null, canonical_text: 'a las 10 am', confidence: 'high' } }
    const result = (await db.query('SELECT lv_collect_visit_intake($1,$2,false,NULL,$3) r', [lead, timeId, timeInterpretation])).rows[0].r
    assert.equal(result.action, 'submitted')
    assert.equal(result.slot.confidence, 'exact')
    assert.equal(new Date(result.slot.start_time).getUTCHours(), 15)
    assert.equal(result.preferred_location_type, 'office')
    const saved = (await db.query('SELECT source_message_text,preferred_time_text,interpreted_source_texts FROM appointment_reschedule_requests WHERE id=$1', [result.request_id])).rows[0]
    assert.equal(saved.source_message_text, rawTime)
    assert.equal(saved.preferred_time_text, 'a las 10 am')
    assert.equal(saved.interpreted_source_texts[dateId].evidence, 'luness a la ofisina')
    assert.equal(saved.interpreted_source_texts[timeId].evidence, 'dies am')
    assert.equal((await db.query('SELECT content FROM messages WHERE id=$1', [dateId])).rows[0].content, rawDate)
    assert.equal((await db.query('SELECT content FROM messages WHERE id=$1', [timeId])).rows[0].content, rawTime)

    const otherLead = (await db.query('INSERT INTO leads(tenant_id,project_id) VALUES($1,$2) RETURNING id', [tenant, project])).rows[0].id
    const otherConversation = (await db.query("INSERT INTO conversations(tenant_id,project_id,lead_id,channel) VALUES($1,$2,$3,'whatsapp') RETURNING id", [tenant, project, otherLead])).rows[0].id
    const otherId = (await db.query("INSERT INTO messages(conversation_id,role,content,sent_at) VALUES($1,'cliente','Quiero una visita',clock_timestamp()) RETURNING id", [otherConversation])).rows[0].id
    const unsupported = { _interpreted_visit: { evidence: 'el domingo a las 10', date_text: 'domingo', time_text: 'a las 10 am', canonical_text: 'domingo a las 10 am', confidence: 'high' } }
    const ignored = (await db.query('SELECT lv_collect_visit_intake($1,$2,false,NULL,$3) r', [otherLead, otherId, unsupported])).rows[0].r
    assert.equal(ignored.action, 'collecting', 'interpretation without literal evidence is ignored')
  } finally { await db.close() }
})
