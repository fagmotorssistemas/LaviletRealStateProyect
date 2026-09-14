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
const { visitDetailText, isVisitDetail, needsVisitHelp, visitTurnIntent } = require('../src/lib/integrations/automation/visit-intake.ts')
const { PGlite } = require('../tmp/sql-validation/node_modules/@electric-sql/pglite')
const read = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8')
const tenant = 'a1b2c3d4-0001-4000-8000-000000000001'
const project = 'b1b2c3d4-0001-4000-8000-000000000001'

test('appointment alternatives and expressive date/hour fragments route to coordination', () => {
  for (const value of ['Para mañana a las 8', 'Para mañana digo', 'Para mañanaaaanaaaaaaaaaaa', 'A las oooochoooooooi']) {
    assert.equal(isVisitDetail(value), true, value)
    assert.equal(visitTurnIntent(value), 'counterproposal', value)
  }
  assert.equal(visitDetailText('Para mañanaaaanaaaaaaaaaaa'), 'para manana')
  assert.equal(visitDetailText('A las oooochoooooooi'), 'a las ocho')
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
  await db.exec(read('20260910163000_visit_preference_ambiguity.sql'))
  await db.exec(read('20260910233000_visit_intake_collection.sql'))
  return db
}

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
