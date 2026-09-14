// Executes the real proposal functions in isolated PostgreSQL. Never reads .env or contacts a lead.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { PGlite } = require('../tmp/integration-sql-tests/node_modules/@electric-sql/pglite')
const schema = { ...require('./fixtures/integration-schema.json'), ...require('./fixtures/manual-reset-schema.json') }
const read = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name + '.sql'), 'utf8')
const legacy = read('20260907210000_agenda_coordination')
const extract = name => {
  const start = legacy.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`)
  if (start < 0) throw Error(name)
  return legacy.slice(start, legacy.indexOf('$function$;', legacy.indexOf('AS $function$', start)) + '$function$;'.length)
}

test('multiple visit options are held atomically and only the selected option is confirmed', async t => {
  const db = new PGlite()
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE SCHEMA auth;')
    for (const [table, columns] of Object.entries(schema)) {
      const fields = Object.entries(columns).map(([name, format]) => `"${name}" ${/^(uuid|text|boolean|jsonb|json|smallint|integer|bigint|numeric|double precision|real|date|time without time zone|timestamp with time zone|timestamp without time zone|text\[\]|uuid\[\]|integer\[\])$/.test(format) ? format : 'text'}${name === 'id' ? ' PRIMARY KEY DEFAULT gen_random_uuid()' : ''}`)
      await db.exec(`CREATE TABLE public."${table}" (${fields.join(',')});`)
    }
    await db.exec(`CREATE TABLE public.project_automation_config(project_id uuid,tenant_id uuid,proposal_hold_minutes integer,visit_location_url text,mode text,is_active boolean,timezone text,business_hours jsonb);
      CREATE TABLE public.project_salesperson_time_off(salesperson_id uuid,starts_at timestamptz,ends_at timestamptz);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.user_id',true),'')::uuid $$;
      CREATE FUNCTION public.lv_can_coordinate() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
      CREATE FUNCTION public.lv_lock_project(uuid,uuid) RETURNS void LANGUAGE sql AS $$ SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text)) $$;
      CREATE FUNCTION public.lv_cancel_pending_visit_outbox(uuid,text) RETURNS void LANGUAGE sql AS $$ UPDATE public.lv_outbox SET status='cancelled' WHERE appointment_id=$1 AND status='pending' $$;
      ALTER TABLE lv_outbox ADD UNIQUE(dedupe_key);
      ALTER TABLE appointment_reschedule_requests ALTER COLUMN created_at SET DEFAULT now();
      ALTER TABLE appointment_reschedule_requests ALTER COLUMN updated_at SET DEFAULT now();
      ALTER TABLE appointment_time_holds ALTER COLUMN created_at SET DEFAULT now();`)
    for (const name of ['lv_interval_within_business_hours','lv_assert_visit_slot','lv_advisor_eligible_on_project','lv_assert_can_act_on_request',
      'lv_format_visit_clock','lv_format_visit_date','lv_format_visit_when','lv_build_visit_confirm_message',
      'lv_enqueue_visit_outbox','lv_assert_client_inbound_message','lv_advisor_propose_request','lv_confirm_visit_from_request','lv_client_accept_request']) {
      await db.exec(extract(name))
    }
    const migration = read('20260914200000_visit_proposal_options')
    await db.exec(migration)
    await db.exec(migration)
    const query = async (sql, args = []) => (await db.query(sql, args)).rows
    const tenant = randomUUID(), project = randomUUID(), advisor = randomUUID(), lead = randomUUID(), appointment = randomUUID(), request = randomUUID(), convo = randomUUID()
    await db.query("SELECT set_config('test.user_id',$1,false)", [advisor])
    await db.query('INSERT INTO profiles(id,role,is_active) VALUES($1,\'asesor\',true)', [advisor])
    await db.query("INSERT INTO projects(id,tenant_id,address,policies_json) VALUES($1,$2,'Ricardo Darquea y Elena Landívar','{\"bot_visits\":{\"launch_destination\":\"office\"}}')", [project, tenant])
    await db.query('INSERT INTO project_salespeople(salesperson_id,tenant_id,project_id) VALUES($1,$2,$3)', [advisor, tenant, project])
    await db.query("INSERT INTO project_automation_config VALUES($1,$2,120,'https://maps.example/place','lanzamiento',true,'America/Guayaquil',$3)", [project, tenant, JSON.stringify(Object.fromEntries([1,2,3,4,5,6,7].map(day => [day,{open:'08:00',close:'18:00'}])))])
    await db.query("INSERT INTO leads(id,tenant_id,project_id,name) VALUES($1,$2,$3,'Client')", [lead, tenant, project])
    await db.query("INSERT INTO appointments(id,tenant_id,project_id,lead_id,responsible_id,status) VALUES($1,$2,$3,$4,$5,'solicitada')", [appointment, tenant, project, lead, advisor])
    await db.query("INSERT INTO appointment_reschedule_requests(id,tenant_id,project_id,lead_id,appointment_id,assigned_advisor_id,status,proposed_by,request_type,source_message_text) VALUES($1,$2,$3,$4,$5,$6,'awaiting_advisor','client','visit','¿Cuándo puedo ir?')", [request, tenant, project, lead, appointment, advisor])
    await db.query('INSERT INTO conversations(id,lead_id,tenant_id,project_id,channel) VALUES($1,$2,$3,$4,\'whatsapp\')', [convo, lead, tenant, project])
    const day = (await query("SELECT ((now() AT TIME ZONE 'America/Guayaquil')::date+2)::text AS day"))[0].day
    const slots = [9,11,15].map(hour => ({ start_time:`${day}T${String(hour).padStart(2,'0')}:00:00-05:00`, end_time:`${day}T${String(hour+1).padStart(2,'0')}:00:00-05:00` }))
    let version
    await t.test('read preview validates the advisor, slots, location and count without mutating', async () => {
      const result = (await query('SELECT lv_validate_visit_options($1,$2) AS value',[request,JSON.stringify(slots)]))[0].value
      version=result.request_version
      assert.equal(result.map_url,'https://maps.example/place')
      assert.equal((await query('SELECT count(*)::int AS n FROM appointment_time_holds'))[0].n,0)
      await assert.rejects(query('SELECT lv_validate_visit_options($1,$2)',[request,'[]']),/uno y tres/)
      await assert.rejects(query('SELECT lv_validate_visit_options($1,$2)',[request,JSON.stringify([slots[0],slots[0]])]),/repetidos/)
      await db.query("SELECT set_config('test.user_id',$1,false)",[randomUUID()])
      await assert.rejects(query('SELECT lv_validate_visit_options($1,$2)',[request,JSON.stringify(slots)]),/otro asesor/)
      await db.query("SELECT set_config('test.user_id',$1,false)",[advisor])
    })
    await t.test('a pending request with an exact interval and a requested appointment block availability', async () => {
      const other = randomUUID(), otherRequest = randomUUID()
      await db.query("INSERT INTO appointments(id,responsible_id,status,start_time,end_time) VALUES($1,$2,'solicitada',$3,$4)",[other,advisor,slots[1].start_time,slots[1].end_time])
      await assert.rejects(query('SELECT lv_validate_visit_options($1,$2)',[request,JSON.stringify(slots)]),/ocupado/)
      await db.query('UPDATE appointments SET start_time=NULL,end_time=NULL WHERE id=$1',[other])
      await db.query("INSERT INTO appointment_reschedule_requests(id,appointment_id,assigned_advisor_id,status,proposed_start_time,proposed_end_time) VALUES($1,$2,$3,'awaiting_advisor',$4,$5)",[otherRequest,other,advisor,slots[1].start_time,slots[1].end_time])
      await assert.rejects(query('SELECT lv_validate_visit_options($1,$2)',[request,JSON.stringify(slots)]),/ocupado/)
      await db.query('DELETE FROM appointment_reschedule_requests WHERE id=$1',[otherRequest])
      await db.query('DELETE FROM appointments WHERE id=$1',[other])
    })
    let proposal
    const draft='Puede elegir el horario que le venga mejor. Si prefiere otro día, cuéntenos para verificarlo.'
    await t.test('stale previews cannot enqueue; one action stores all holds and one outgoing proposal', async () => {
      await assert.rejects(query('SELECT lv_advisor_propose_visit_options($1,$2,$3,$4)',[request,JSON.stringify(slots),draft,'old-version']),/solicitud cambió/)
      proposal=(await query('SELECT to_jsonb(lv_advisor_propose_visit_options($1,$2,$3,$4)) AS value',[request,JSON.stringify(slots),draft,version]))[0].value
      assert.equal(proposal.status,'awaiting_client')
      assert.equal(proposal.proposed_options.length,3)
      assert.equal((await query('SELECT count(*)::int AS n FROM appointment_time_holds'))[0].n,3)
      const outgoing=(await query('SELECT * FROM lv_outbox'))
      assert.equal(outgoing.length,1); assert.equal(outgoing[0].payload.message_draft,draft)
      assert.equal(outgoing[0].payload.options.length,3)
      const retried=(await query('SELECT to_jsonb(lv_advisor_propose_visit_options($1,$2,$3,$4)) AS value',[request,JSON.stringify(slots),draft,version]))[0].value
      assert.equal(retried.id,proposal.id)
      assert.equal((await query('SELECT count(*)::int AS n FROM lv_outbox'))[0].n,1)
    })
    await t.test('a bare yes, out-of-range choice or fabricated inbound cannot confirm', async () => {
      const message=randomUUID()
      await db.query("INSERT INTO messages(id,conversation_id,role,content,sent_at) VALUES($1,$2,'cliente','Sí',now())",[message,convo])
      await assert.rejects(query('SELECT lv_client_accept_request($1,$2)',[proposal.id,message]),/elegir uno/)
      await assert.rejects(query('SELECT lv_client_select_visit_option($1,4,$2)',[proposal.id,message]),/opción/)
      await assert.rejects(query('SELECT lv_client_select_visit_option($1,2,$2)',[proposal.id,randomUUID()]),/inbound/)
      assert.equal((await query('SELECT status FROM appointments WHERE id=$1',[appointment]))[0].status,'solicitada')
    })
    await t.test('outgoing proposals recheck later alternatives when the agenda changes after review', async () => {
      const job=(await query("SELECT id FROM lv_outbox WHERE kind='visit_propose'"))[0].id
      assert.equal((await query('SELECT lv_outbox_event_is_current($1) AS ok',[job]))[0].ok,true)
      const other=randomUUID()
      await db.query("INSERT INTO appointments(id,responsible_id,status,start_time,end_time) VALUES($1,$2,'pendiente',$3,$4)",[other,advisor,slots[2].start_time,slots[2].end_time])
      assert.equal((await query('SELECT lv_outbox_event_is_current($1) AS ok',[job]))[0].ok,false)
      await db.query('DELETE FROM appointments WHERE id=$1',[other])
      assert.equal((await query('SELECT lv_outbox_event_is_current($1) AS ok',[job]))[0].ok,true)
    })
    await t.test('choosing the second option confirms that interval and releases all other holds', async () => {
      const message=randomUUID()
      await db.query("INSERT INTO messages(id,conversation_id,role,content,sent_at) VALUES($1,$2,'cliente','La segunda opción',now())",[message,convo])
      const selected=(await query('SELECT to_jsonb(lv_client_select_visit_option($1,2,$2)) AS value',[proposal.id,message]))[0].value
      assert.equal(selected.status,'confirmed')
      assert.equal(Date.parse(selected.proposed_start_time),Date.parse(slots[1].start_time))
      const saved=(await query('SELECT * FROM appointments WHERE id=$1',[appointment]))[0]
      assert.equal(saved.status,'aceptado'); assert.equal(Date.parse(saved.start_time),Date.parse(slots[1].start_time))
      assert.equal((await query('SELECT count(*)::int AS n FROM appointment_time_holds'))[0].n,0)
      assert.equal((await query("SELECT count(*)::int AS n FROM lv_outbox WHERE status='pending' AND kind='visit_confirm'"))[0].n,1)
    })
    await t.test('selection RPC is restricted to the automation service', async () => {
      for(const role of ['anon','authenticated']) assert.equal((await query("SELECT has_function_privilege($1,'lv_client_select_visit_option(uuid,integer,text)','EXECUTE') AS ok",[role]))[0].ok,false)
      assert.equal((await query("SELECT has_function_privilege('service_role','lv_client_select_visit_option(uuid,integer,text)','EXECUTE') AS ok"))[0].ok,true)
    })
  } finally { await db.close() }
})
