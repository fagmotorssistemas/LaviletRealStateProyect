const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')
const schema = { ...require('./fixtures/integration-schema.json'), ...require('./fixtures/manual-reset-schema.json') }
const lid = '52fa6e93-4bd4-42ad-963a-666e9c7902a7'
const tenant = 'a1b2c3d4-0001-4000-8000-000000000001'
const project = 'b1b2c3d4-0001-4000-8000-000000000001'
test('Carlos admin reset: isolated execution, backup, identity, API denial and rollback', async () => {
  const db = new PGlite()
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')
    for (const [table, columns] of Object.entries(schema)) {
      const fields = Object.entries(columns).map(([name, format]) => {
        const type = /^(uuid|text|boolean|jsonb|json|smallint|integer|bigint|numeric|double precision|real|date|time without time zone|timestamp with time zone|timestamp without time zone|text\[\]|uuid\[\]|integer\[\])$/.test(format) ? format : 'text'
        return `"${name}" ${type}${name === 'id' ? ' PRIMARY KEY DEFAULT gen_random_uuid()' : ''}`
      })
      await db.exec(`CREATE TABLE public."${table}" (${fields.join(',')})`)
    }
    await db.query('INSERT INTO tenants(id) VALUES($1)',[tenant])
    await db.query('INSERT INTO projects(id,tenant_id) VALUES($1,$2)',[project,tenant])
    await db.exec(fs.readFileSync('supabase/migrations/20260909180000_kommo_app_runtime.sql','utf8'))
    await db.exec(`CREATE FUNCTION lv_lock_project(uuid,uuid) RETURNS void LANGUAGE sql AS $$ SELECT pg_advisory_xact_lock(1) $$;
      CREATE TABLE kommo_message_evidence(id int primary key, lead_id uuid);
      CREATE TABLE lead_interest_evaluations(id int primary key, lead_id uuid);
      ALTER TABLE messages ADD FOREIGN KEY(conversation_id) REFERENCES conversations(id);
      ALTER TABLE asesoria_financiamiento ADD FOREIGN KEY(prequalification_id) REFERENCES financing_prequalifications(id);`)
    await db.query('INSERT INTO leads(id,tenant_id,project_id,kommo_id,contact_id,phone,temperature_score,behavior_signals) VALUES($1,$2,$3,4454162,\'9432278\',\'+593987110032\',60,\'{"unit":"502"}\')',[lid,tenant,project])
    await db.query('INSERT INTO lv_auto_config(tenant_id,project_id,test_only,test_lead_id) VALUES($1,$2,true,$3)',[tenant,project,lid])
    const conv=(await db.query('INSERT INTO conversations(lead_id,tenant_id,project_id) VALUES($1,$2,$3) RETURNING id',[lid,tenant,project])).rows[0].id
    await db.query("INSERT INTO messages(conversation_id,content) VALUES($1,'old test')",[conv])
    await db.query('INSERT INTO kommo_message_evidence VALUES(1,$1);',[lid])
    await db.query('INSERT INTO lead_interest_evaluations VALUES(1,$1)',[lid])
    const pre=(await db.query('INSERT INTO financing_prequalifications(lead_id) VALUES($1) RETURNING id',[lid])).rows[0].id
    await db.query('INSERT INTO asesoria_financiamiento(lead_id,prequalification_id) VALUES($1,$2)',[lid,pre])
    const sql=fs.readFileSync('operations/restaurar_reinicio_carlos_20260925.sql','utf8')
    await db.exec(sql)
    await db.exec(sql)
    assert.equal((await db.query('SELECT count(*)::int n FROM messages')).rows[0].n,1)
    for(const role of ['anon','authenticated','service_role']) assert.equal((await db.query("SELECT has_function_privilege($1,'lv_reset_lavilet_test_lead()','EXECUTE') ok",[role])).rows[0].ok,false)
    await db.exec('UPDATE lv_auto_config SET test_only=false')
    await assert.rejects(db.query('SELECT lv_reset_lavilet_test_lead()'),/REQUIRES_TEST_ONLY/)
    await db.exec("UPDATE lv_auto_config SET test_only=true; UPDATE leads SET contact_id='wrong'")
    await assert.rejects(db.query('SELECT lv_reset_lavilet_test_lead()'),/no coincide/)
    await db.exec("UPDATE leads SET contact_id='9432278'")
    // Force a restrictive new FK: the backup and all deletes must roll back.
    await db.exec('CREATE TABLE retained_reference(id uuid references conversations(id))')
    await db.query('INSERT INTO retained_reference VALUES($1)',[conv])
    await assert.rejects(db.query('SELECT lv_reset_lavilet_test_lead()'),/foreign key/)
    assert.equal((await db.query('SELECT count(*)::int n FROM lv_manual_test_reset_backups')).rows[0].n,0)
    await db.exec('DROP TABLE retained_reference')
    const result=(await db.query('SELECT lv_reset_lavilet_test_lead() r')).rows[0].r
    assert.equal(result.status,'reset')
    const backup=(await db.query('SELECT snapshot FROM lv_manual_test_reset_backups WHERE id=$1',[result.backup_id])).rows[0].snapshot
    assert.equal(backup.messages[0].content,'old test')
    assert.equal((await db.query('SELECT count(*)::int n FROM messages')).rows[0].n,0)
    assert.equal((await db.query('SELECT temperature_score FROM leads')).rows[0].temperature_score,0)
    assert.equal((await db.query('SELECT count(*)::int n FROM kommo_message_evidence')).rows[0].n,1)
    assert.equal((await db.query('SELECT count(*)::int n FROM lead_interest_evaluations')).rows[0].n,1)
  } finally { await db.close() }
})
