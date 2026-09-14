/* eslint-disable @typescript-eslint/no-require-imports -- Isolated PostgreSQL integration test. */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { PGlite } = require('../tmp/sql-validation/node_modules/@electric-sql/pglite')
const tenant = 'a1b2c3d4-0001-4000-8000-000000000001'
const project = 'b1b2c3d4-0001-4000-8000-000000000001'
const advisor = '00000000-0000-4000-8000-000000000001'

async function fixture() {
  const db = new PGlite()
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth; CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;")
  const schema = JSON.parse(fs.readFileSync('scripts/fixtures/integration-schema.json', 'utf8'))
  for (const table of ['leads', 'conversations', 'messages', 'appointments', 'appointment_reschedule_requests', 'lv_outbox']) {
    await db.exec(`CREATE TABLE public.${table} (${Object.entries(schema[table]).map(([c, t]) => `"${c}" ${t.startsWith('public.') ? 'text' : t}${c === 'id' ? ' PRIMARY KEY DEFAULT gen_random_uuid()' : ''}`).join(',')})`)
  }
  await db.exec(`ALTER TABLE appointment_reschedule_requests ADD COLUMN proposed_options jsonb DEFAULT '[]';
    CREATE TABLE appointment_time_holds(request_id uuid);
    CREATE TABLE bot_escalations(conversation_id uuid,assigned_to uuid,reason text,resolved_at timestamptz);
    CREATE TABLE lv_appointment_assignment_events(tenant_id uuid,project_id uuid,appointment_id uuid,request_id uuid,from_advisor_id uuid,to_advisor_id uuid,action text,reason text,actor_id uuid);
    CREATE TABLE lv_visit_intakes(lead_id uuid,tenant_id uuid,project_id uuid,request_id uuid,previous_request_id uuid,status text,updated_at timestamptz);
    CREATE TABLE appointment_change_log(appointment_id uuid,actor_id uuid,action text,detail jsonb);
    CREATE FUNCTION lv_lock_project(uuid,uuid) RETURNS void LANGUAGE sql AS $$ SELECT $$;
    CREATE FUNCTION lv_advisor_eligible_on_project(uuid,uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT $1 IS NOT NULL $$;
    CREATE FUNCTION lv_assert_can_act_on_request(r public.appointment_reschedule_requests) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF r.assigned_advisor_id IS DISTINCT FROM auth.uid() THEN RAISE EXCEPTION 'No autorizado'; END IF; END $$;
    CREATE FUNCTION lv_assert_visit_slot(uuid,timestamptz,timestamptz) RETURNS void LANGUAGE plpgsql AS $$ BEGIN IF $2<=now() OR $3-$2 IS DISTINCT FROM interval '1 hour' THEN RAISE EXCEPTION 'Horario inválido'; END IF; END $$;
    CREATE FUNCTION lv_advisor_has_conflict(uuid,timestamptz,timestamptz,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce(current_setting('test.agenda_conflict',true),'false')='true' $$;
    CREATE FUNCTION lv_cancel_pending_visit_outbox(uuid,text) RETURNS void LANGUAGE sql AS $$ UPDATE public.lv_outbox SET status='cancelled',detail=$2 WHERE appointment_id=$1 AND status='pending' $$;`)
  const agenda = fs.readFileSync('supabase/migrations/20260907210000_agenda_coordination.sql', 'utf8')
  const validation = agenda.slice(agenda.indexOf('CREATE OR REPLACE FUNCTION public.lv_assert_client_inbound_message('), agenda.indexOf('CREATE OR REPLACE FUNCTION public.lv_intake_visit_request('))
  await db.exec(validation)
  await db.exec(fs.readFileSync('supabase/migrations/20260915100000_urgent_visit_coordination.sql', 'utf8'))
  const lead = (await db.query('INSERT INTO leads(tenant_id,project_id,bot_enabled,assigned_to) VALUES($1,$2,true,$3) RETURNING id', [tenant, project, advisor])).rows[0].id
  const conversation = (await db.query("INSERT INTO conversations(tenant_id,project_id,lead_id,channel,status) VALUES($1,$2,$3,'whatsapp','activa') RETURNING id", [tenant, project, lead])).rows[0].id
  const appointment = (await db.query("INSERT INTO appointments(tenant_id,project_id,lead_id,status,responsible_id) VALUES($1,$2,$3,'pendiente',$4) RETURNING id", [tenant, project, lead, advisor])).rows[0].id
  const request = (await db.query(`INSERT INTO appointment_reschedule_requests(tenant_id,project_id,lead_id,appointment_id,status,proposed_by,assigned_advisor_id,advisor_accepted_at,
    created_at,proposed_start_time,proposed_end_time,proposed_options,source_channel)
    VALUES($1,$2,$3,$4,'awaiting_client','advisor',$5,now()-interval '5 minutes',now()-interval '5 minutes',now()+interval '1 day',now()+interval '25 hours',
    '[{"start_time":"2026-10-01T15:00:00Z","end_time":"2026-10-01T16:00:00Z"}]','whatsapp') RETURNING id`, [tenant, project, lead, appointment, advisor])).rows[0].id
  const message = (await db.query("INSERT INTO messages(conversation_id,role,content,sent_at,external_message_id) VALUES($1,'cliente','Ninguno me sirve',now(),'test-msg') RETURNING id", [conversation])).rows[0].id
  await db.query('INSERT INTO appointment_time_holds VALUES($1)', [request])
  await db.query("INSERT INTO lv_outbox(appointment_id,status,kind) VALUES($1,'pending','visit_propose')", [appointment])
  return { db, lead, request, message, conversation, appointment }
}

test('urgent coordination atomically pauses automation, frees rejected times, preserves owner and creates an actionable queue item', async () => {
  const f = await fixture()
  try {
    const result = (await f.db.query('SELECT lv_escalate_visit_coordination($1,$2,$3) AS result', [f.request, f.message, 'Llamar para coordinar; rechazó los horarios.'])).rows[0].result
    assert.equal(result.action, 'escalated'); assert.equal(result.bot_paused, true)
    const lead = (await f.db.query('SELECT * FROM leads WHERE id=$1', [f.lead])).rows[0]
    assert.equal(lead.bot_enabled, false); assert.equal(lead.assigned_to, advisor); assert.equal(lead.handoff_status, 'assigned')
    const request = (await f.db.query('SELECT * FROM appointment_reschedule_requests WHERE id=$1', [f.request])).rows[0]
    assert.equal(request.status, 'awaiting_advisor'); assert.ok(request.coordination_urgent_at); assert.equal(request.reviewed_at, null)
    assert.equal(request.proposed_start_time, null); assert.equal(request.client_accepted_at, null); assert.deepEqual(request.proposed_options, [])
    assert.equal(request.assigned_advisor_id, advisor); assert.match(request.coordination_summary, /Llamar/)
    assert.equal((await f.db.query('SELECT count(*)::int n FROM appointment_time_holds')).rows[0].n, 0)
    assert.equal((await f.db.query('SELECT status FROM lv_outbox')).rows[0].status, 'cancelled')
    assert.equal((await f.db.query('SELECT status FROM appointments')).rows[0].status, 'pendiente')
    assert.equal((await f.db.query('SELECT status FROM conversations')).rows[0].status, 'escalada')
    assert.equal((await f.db.query('SELECT action FROM lv_appointment_assignment_events')).rows[0].action, 'urgent_coordination')
    await f.db.query('SELECT lv_escalate_visit_coordination($1,$2,$3)', [f.request, f.message, 'duplicado'])
    assert.equal((await f.db.query('SELECT count(*)::int n FROM bot_escalations')).rows[0].n, 1)
    assert.equal((await f.db.query('SELECT count(*)::int n FROM lv_appointment_assignment_events')).rows[0].n, 1)
  } finally { await f.db.close() }
})

test('wrong, old, or already resolved inbound cannot pause a bot or create urgent work', async () => {
  const f = await fixture()
  try {
    await assert.rejects(f.db.query('SELECT lv_escalate_visit_coordination($1,$2,$3)', [f.request, 'other-client-message', 'test']))
    await f.db.query("UPDATE messages SET sent_at=now()-interval '1 hour' WHERE id=$1", [f.message])
    await assert.rejects(f.db.query('SELECT lv_escalate_visit_coordination($1,$2,$3)', [f.request, f.message, 'test']))
    await f.db.query('UPDATE messages SET sent_at=now() WHERE id=$1', [f.message])
    await f.db.query("UPDATE appointment_reschedule_requests SET status='confirmed' WHERE id=$1", [f.request])
    await assert.rejects(f.db.query('SELECT lv_escalate_visit_coordination($1,$2,$3)', [f.request, f.message, 'test']))
    assert.equal((await f.db.query('SELECT bot_enabled FROM leads')).rows[0].bot_enabled, true)
    assert.equal((await f.db.query('SELECT count(*)::int n FROM bot_escalations')).rows[0].n, 0)
  } finally { await f.db.close() }
})

test('only the authorized advisor can record a real phone agreement, with fresh conflict checks and no bot resume or message send', async () => {
  const f = await fixture()
  try {
    await f.db.query('SELECT lv_escalate_visit_coordination($1,$2,$3)', [f.request, f.message, 'Llamar para coordinar'])
    const starts = new Date(Date.now() + 86400000).toISOString(), ends = new Date(Date.parse(starts) + 3600000).toISOString()
    const call = notes => f.db.query('SELECT lv_complete_urgent_visit_coordination($1,$2,$3,$4) result', [f.request, starts, ends, notes])
    await assert.rejects(call('Acordamos el horario por llamada'), /No autenticado/)
    await f.db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", ['00000000-0000-4000-8000-000000000002'])
    await assert.rejects(call('Acordamos el horario por llamada'), /No autorizado/)
    await f.db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [advisor])
    await assert.rejects(call(''), /Describa/)
    await f.db.exec("SET test.agenda_conflict='true'")
    await assert.rejects(call('Acordamos el horario por llamada'), /ocupado/)
    assert.equal((await f.db.query('SELECT status FROM appointment_reschedule_requests')).rows[0].status, 'awaiting_advisor')
    await f.db.exec("SET test.agenda_conflict='false'")
    const result = (await call('Acordamos el horario por llamada')).rows[0].result
    assert.equal(result.action, 'confirmed'); assert.equal(result.bot_paused, true)
    assert.equal((await f.db.query('SELECT status FROM appointments')).rows[0].status, 'aceptado')
    assert.equal((await f.db.query('SELECT status FROM appointment_reschedule_requests')).rows[0].status, 'confirmed')
    assert.equal((await f.db.query('SELECT client_accepted_at FROM appointment_reschedule_requests')).rows[0].client_accepted_at, null)
    assert.equal((await f.db.query('SELECT bot_enabled FROM leads')).rows[0].bot_enabled, false)
    assert.equal((await f.db.query("SELECT count(*)::int n FROM lv_outbox WHERE status='pending'")).rows[0].n, 0)
    assert.equal((await f.db.query('SELECT action FROM appointment_change_log')).rows[0].action, 'acuerdo_telefonico')
    await assert.rejects(call('Duplicado de acuerdo'), /ya no está pendiente/)
  } finally { await f.db.close() }
})

test('urgent scheduling preserves an unrelated financing escalation with or without a conversation uniqueness constraint', async () => {
  for (const unique of [false, true]) {
    const f = await fixture()
    try {
      if (unique) await f.db.exec('CREATE UNIQUE INDEX one_open_escalation ON bot_escalations(conversation_id) WHERE resolved_at IS NULL')
      const financialOwner = '00000000-0000-4000-8000-000000000002'
      await f.db.query('INSERT INTO bot_escalations(conversation_id,assigned_to,reason) VALUES($1,$2,$3)', [f.conversation, financialOwner, 'Evaluación de financiamiento con JEP pendiente'])
      await f.db.query('SELECT lv_escalate_visit_coordination($1,$2,$3)', [f.request, f.message, 'Llamar para coordinar la visita'])
      const finance = (await f.db.query("SELECT * FROM bot_escalations WHERE reason='Evaluación de financiamiento con JEP pendiente'")).rows[0]
      assert.equal(finance.assigned_to, financialOwner); assert.equal(finance.resolved_at, null)
      assert.equal((await f.db.query('SELECT count(*)::int n FROM bot_escalations')).rows[0].n, unique ? 1 : 2)
      assert.ok((await f.db.query('SELECT coordination_urgent_at FROM appointment_reschedule_requests')).rows[0].coordination_urgent_at)
      assert.equal((await f.db.query('SELECT action FROM lv_appointment_assignment_events')).rows[0].action, 'urgent_coordination')
      await f.db.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [advisor])
      await f.db.query("SELECT lv_complete_urgent_visit_coordination($1,now()+interval '1 day',now()+interval '25 hours',$2)", [f.request, 'Acordamos por teléfono el horario de la visita'])
      assert.equal((await f.db.query("SELECT resolved_at FROM bot_escalations WHERE reason='Evaluación de financiamiento con JEP pendiente'")).rows[0].resolved_at, null)
    } finally { await f.db.close() }
  }
})
