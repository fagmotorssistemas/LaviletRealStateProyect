// Isolated PostgreSQL; never reads .env, calls Kommo or resets a real lead.
// Uses the same local PGlite installation as integrations-sql.test.cjs.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { PGlite } = require('../tmp/integration-sql-tests/node_modules/@electric-sql/pglite')
const schema = { ...require('./fixtures/integration-schema.json'), ...require('./fixtures/manual-reset-schema.json') }
const tenant = 'a1b2c3d4-0001-4000-8000-000000000001'
const project = 'b1b2c3d4-0001-4000-8000-000000000001'
const nataly = 'bf32833f-fd65-461e-9e0e-31844e4d6814'
const carlos = '52fa6e93-4bd4-42ad-963a-666e9c7902a7'
const read = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name), 'utf8')
const migration = read('20260914170000_manual_test_contacts_reset.sql')

test('manual resets preserve other leads, back up context and prevent old followups', async t => {
  const db = new PGlite()
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')
    for (const [table, columns] of Object.entries(schema)) {
      const fields = Object.entries(columns).map(([name, format]) => {
        const type = /^(uuid|text|boolean|jsonb|json|smallint|integer|bigint|numeric|double precision|real|date|time without time zone|timestamp with time zone|timestamp without time zone|text\[\]|uuid\[\]|integer\[\])$/.test(format) ? format : 'text'
        return `"${name}" ${type}${name === 'id' ? ' PRIMARY KEY DEFAULT gen_random_uuid()' : ''}`
      })
      await db.exec(`CREATE TABLE public."${table}" (${fields.join(',')});`)
    }
    await db.query('INSERT INTO tenants(id) VALUES($1)', [tenant])
    await db.query('INSERT INTO projects(id,tenant_id) VALUES($1,$2)', [project, tenant])
    await db.exec(read('20260909180000_kommo_app_runtime.sql'))
    await db.exec(`CREATE FUNCTION public.lv_lock_project(uuid,uuid) RETURNS void LANGUAGE sql AS $$
      SELECT pg_advisory_xact_lock(hashtext($1::text),hashtext($2::text)) $$;
      ALTER TABLE lv_visit_intakes ADD PRIMARY KEY (conversation_id);
      ALTER TABLE lv_visit_intakes ADD FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
      ALTER TABLE lv_visit_intakes ADD FOREIGN KEY (request_id) REFERENCES appointment_reschedule_requests(id) ON DELETE SET NULL;
      ALTER TABLE messages ADD FOREIGN KEY (conversation_id) REFERENCES conversations(id);
      ALTER TABLE appointment_reschedule_requests ADD FOREIGN KEY (appointment_id) REFERENCES appointments(id);
      ALTER TABLE lv_outbox ADD FOREIGN KEY (cycle_id) REFERENCES lv_cycles(id);`)
    const query = async (sql, params = []) => (await db.query(sql, params)).rows
    const count = async table => Number((await query(`SELECT count(*) AS n FROM public.${table}`))[0].n)
    const seed = async (id, kommo, phone) => {
      await db.query(`INSERT INTO leads(id,tenant_id,project_id,kommo_id,phone,name,bot_enabled,handoff_status,behavior_signals,budget)
        VALUES($1,$2,$3,$4,$5,'Test',false,'requested','{"unit":"210"}',200000)`, [id, tenant, project, kommo, phone])
      const conversation = (await query("INSERT INTO conversations(lead_id,tenant_id,project_id,summary) VALUES($1,$2,$3,'Old context') RETURNING id", [id, tenant, project]))[0].id
      await db.query("INSERT INTO messages(conversation_id,content,role) VALUES($1,'Old conversation','cliente')", [conversation])
      const appointment = (await query('INSERT INTO appointments(lead_id,tenant_id,project_id) VALUES($1,$2,$3) RETURNING id', [id, tenant, project]))[0].id
      const request = (await query('INSERT INTO appointment_reschedule_requests(lead_id,appointment_id) VALUES($1,$2) RETURNING id', [id, appointment]))[0].id
      await db.query('INSERT INTO lv_visit_intakes(conversation_id,lead_id,request_id) VALUES($1,$2,$3)', [conversation, id, request])
      await db.query('INSERT INTO lead_nutrition(lead_id,next_send_at) VALUES($1,now())', [id])
      const cycle = (await query('INSERT INTO lv_cycles(lead_id) VALUES($1) RETURNING id', [id]))[0].id
      await db.query("INSERT INTO lv_outbox(lead_id,cycle_id,status) VALUES($1,$2,'pending')", [id, cycle])
      await db.query('SELECT lv_app_receive($1::jsonb)', [JSON.stringify([{ externalId: `old-${kommo}`, kommoId: kommo, contactId: kommo, text: 'Old inbound' }])])
      for (const payload of [{ task: 'nutrition_24h', leadId: id }, { task: 'nutrition_24h', kommoId: kommo }]) {
        await db.query("INSERT INTO lv_integration_events(tenant_id,project_id,event_key,kind,payload) VALUES($1,$2,$3,'maintenance',$4)", [tenant, project, randomUUID(), JSON.stringify(payload)])
      }
    }
    await seed(nataly, 3928256, '+593939731833')
    await seed(carlos, 2710090, '+593987110032')
    await db.query("INSERT INTO lv_integration_events(tenant_id,project_id,event_key,kind) VALUES($1,$2,'general-maintenance','maintenance')", [tenant, project])
    await t.test('installation and reinstallation never execute a reset, and API roles cannot call it', async () => {
      await db.exec(migration)
      await db.exec(migration)
      assert.equal(await count('messages'), 2)
      assert.equal(await count('lv_manual_test_reset_backups'), 0)
      for (const role of ['anon', 'authenticated', 'service_role']) {
        for (const fn of ['lv_reset_lavilet_test_contact(integer)', 'lv_reset_lavilet_nataly_lead()', 'lv_reset_lavilet_test_lead()']) {
          assert.equal((await query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', [role, fn]))[0].allowed, false)
        }
      }
    })
    const rollbackCase = async action => {
      await db.exec('BEGIN')
      try { await action() } finally { await db.exec('ROLLBACK') }
      assert.equal(await count('messages'), 2)
      assert.equal(await count('lv_manual_test_reset_backups'), 0)
    }
    await t.test('wrong identities and arbitrary IDs are rejected without changing conversations', async () => {
      await assert.rejects(query('SELECT lv_reset_lavilet_test_contact(999)'), /Solo se permite/)
      for (const [column, value] of [['phone', '+593000000000'], ['kommo_id', 111], ['tenant_id', randomUUID()], ['project_id', randomUUID()]]) {
        await rollbackCase(async () => {
          await db.query(`UPDATE leads SET ${column}=$1 WHERE id=$2`, [value, nataly])
          await assert.rejects(query('SELECT lv_reset_lavilet_nataly_lead()'), /no coincide/)
        })
      }
    })
    await t.test('active worker, unresolved sends, contracts, reservations and sales block the reset', async () => {
      await rollbackCase(async () => {
        await db.query("SELECT lv_app_worker_lock($1,'acquire')", [randomUUID()])
        await assert.rejects(query('SELECT lv_reset_lavilet_nataly_lead()'), /ejecutor está trabajando/)
      })
      for (const status of ['claimed', 'uncertain']) {
        await rollbackCase(async () => {
          await db.query('UPDATE lv_outbox SET status=$1 WHERE lead_id=$2', [status, nataly])
          await assert.rejects(query('SELECT lv_reset_lavilet_nataly_lead()'), /en curso o sin resolver/)
        })
      }
      await rollbackCase(async () => {
        await db.query("UPDATE lv_integration_events SET status='processing' WHERE payload->>'leadId'=$1", [nataly])
        await assert.rejects(query('SELECT lv_reset_lavilet_nataly_lead()'), /en curso o sin resolver/)
      })
      for (const table of ['contracts', 'reservations', 'unit_sales_closings']) {
        await rollbackCase(async () => {
          await db.query(`INSERT INTO ${table}(lead_id) VALUES($1)`, [nataly])
          await assert.rejects(query('SELECT lv_reset_lavilet_nataly_lead()'), /contratos, reservas o ventas/)
        })
      }
    })
    await t.test('Nataly resets with a full backup while Carlos and general maintenance stay intact', async () => {
      const otherBefore = await query('SELECT to_jsonb(l) AS lead FROM leads l WHERE id=$1', [carlos])
      const result = (await query('SELECT lv_reset_lavilet_nataly_lead() AS result'))[0].result
      assert.equal(result.lead_id, nataly)
      assert.equal(result.status, 'reset')
      assert.equal(result.deleted.events_cancelled_and_scrubbed, 3)
      const after = (await query('SELECT * FROM leads WHERE id=$1', [nataly]))[0]
      assert.equal(after.kommo_id, 3928256)
      assert.equal(after.bot_enabled, true)
      assert.equal(after.handoff_status, 'none')
      assert.equal(after.budget, null)
      assert.equal(after.assigned_to, null)
      assert.deepEqual(after.behavior_signals, {})
      assert.deepEqual(await query('SELECT to_jsonb(l) AS lead FROM leads l WHERE id=$1', [carlos]), otherBefore)
      for (const table of ['conversations', 'appointments', 'lv_visit_intakes', 'appointment_reschedule_requests', 'lv_outbox', 'lv_cycles', 'lead_nutrition']) {
        assert.equal((await query(`SELECT count(*)::int AS n FROM ${table} WHERE lead_id=$1`, [nataly]))[0].n, 0, table)
        assert.equal((await query(`SELECT count(*)::int AS n FROM ${table} WHERE lead_id=$1`, [carlos]))[0].n, 1, table)
      }
      assert.equal(await count('messages'), 1)
      const backup = (await query('SELECT snapshot FROM lv_manual_test_reset_backups WHERE id=$1', [result.backup_id]))[0].snapshot
      assert.equal(backup.lead.id, nataly)
      assert.equal(backup.messages[0].content, 'Old conversation')
      assert.equal(backup.integration_events.length, 3)
      assert.equal(backup.lv_visit_intakes.length, 1)
      const events = await query("SELECT status,payload FROM lv_integration_events WHERE result->>'backup_id'=$1", [result.backup_id])
      assert.equal(events.length, 3)
      assert.ok(events.every(e => e.status === 'cancelled' && !e.payload.text && !e.payload.task))
      assert.equal((await query("SELECT status FROM lv_integration_events WHERE event_key='general-maintenance'"))[0].status, 'pending')
      assert.equal((await query("SELECT count(*)::int AS n FROM lv_integration_events WHERE status='pending'"))[0].n, 4)
      assert.equal((await query("SELECT lv_app_receive($1::jsonb) AS n", [JSON.stringify([{ externalId: 'old-3928256', kommoId: 3928256, contactId: 3928256, text: 'Retry' }])]))[0].n, 0)
      assert.equal((await query("SELECT claim_token FROM lv_integration_events WHERE event_key='__worker__'"))[0].claim_token, null)
    })
    await t.test('the existing Carlos command still works and resets remain repeatable', async () => {
      assert.equal((await query('SELECT lv_reset_lavilet_test_lead() AS r'))[0].r.lead_id, carlos)
      assert.equal(await count('messages'), 0)
      assert.equal((await query('SELECT lv_reset_lavilet_nataly_lead() AS r'))[0].r.lead_id, nataly)
      assert.equal(await count('leads'), 2)
    })
    await t.test('the complete SQL file installs the missing function and resets Nataly in one operation', async () => {
      await db.exec('DROP FUNCTION lv_reset_lavilet_nataly_lead();')
      const conversation = (await query('INSERT INTO conversations(lead_id,tenant_id,project_id) VALUES($1,$2,$3) RETURNING id', [nataly, tenant, project]))[0].id
      await db.query("INSERT INTO messages(conversation_id,role,content) VALUES($1,'cliente','A new test')", [conversation])
      const operation = fs.readFileSync(path.join(__dirname, '../supabase/operations/reset_nataly_test_lead.sql'), 'utf8')
      await db.exec(operation)
      assert.equal(await count('messages'), 0)
      assert.equal(await count('leads'), 2)
      assert.equal((await query("SELECT to_regprocedure('public.lv_reset_lavilet_nataly_lead()')::text AS fn"))[0].fn, 'lv_reset_lavilet_nataly_lead()')
    })
    await t.test('Pablo installer adds a private, identity-bound reset without executing it or changing Nataly and Carlos', async () => {
      const pablo = 'e49607f2-ba8d-4a2b-a607-85617072800c'
      await seed(pablo, 3577404, '+593987077120')
      const backupsBefore = await count('lv_manual_test_reset_backups')
      const otherBefore = await query('SELECT to_jsonb(l) AS lead FROM leads l WHERE id<>$1 ORDER BY id', [pablo])
      const installer = read('20260915120000_manual_pablo_test_reset.sql')
      assert.equal(fs.readFileSync(path.join(__dirname, '../operations/activar_reinicio_pablo_y_nataly.sql'), 'utf8'), installer)
      await db.exec(installer)
      await db.exec(installer)
      assert.equal(await count('messages'), 1)
      assert.equal(await count('lv_manual_test_reset_backups'), backupsBefore)
      for (const role of ['anon', 'authenticated', 'service_role']) {
        assert.equal((await query("SELECT has_function_privilege($1,'lv_reset_lavilet_pablo_lead()','EXECUTE') AS allowed", [role]))[0].allowed, false)
      }
      await db.exec('BEGIN')
      await db.query("UPDATE leads SET phone='+593000000000' WHERE id=$1", [pablo])
      await assert.rejects(query('SELECT lv_reset_lavilet_pablo_lead()'), /no coincide/)
      await db.exec('ROLLBACK')
      assert.equal(await count('messages'), 1)
      const result = (await query('SELECT lv_reset_lavilet_pablo_lead() AS result'))[0].result
      assert.equal(result.lead_id, pablo)
      assert.equal(result.deleted.events_cancelled_and_scrubbed, 3)
      assert.equal(await count('messages'), 0)
      assert.equal(await count('leads'), 3)
      assert.equal(await count('lv_manual_test_reset_backups'), backupsBefore + 1)
      assert.deepEqual(await query('SELECT to_jsonb(l) AS lead FROM leads l WHERE id<>$1 ORDER BY id', [pablo]), otherBefore)
      const after = (await query('SELECT * FROM leads WHERE id=$1', [pablo]))[0]
      assert.equal(after.kommo_id, 3577404)
      assert.equal(after.bot_enabled, true)
      assert.equal(after.handoff_status, 'none')
      const backup = (await query('SELECT snapshot FROM lv_manual_test_reset_backups WHERE id=$1', [result.backup_id]))[0].snapshot
      assert.equal(backup.lead.id, pablo)
      assert.equal(backup.messages[0].content, 'Old conversation')
      assert.equal((await query('SELECT lv_reset_lavilet_nataly_lead() AS r'))[0].r.lead_id, nataly)
      assert.equal((await query('SELECT lv_reset_lavilet_pablo_lead() AS r'))[0].r.lead_id, pablo)
    })
  } finally { await db.close() }
})
