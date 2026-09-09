// PostgreSQL aislado en memoria. No lee .env ni conecta a Supabase.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PGlite } = require('../tmp/integration-sql-tests/node_modules/@electric-sql/pglite')
const schema = require('./fixtures/integration-schema.json')
const scope = { tenant: 'a1b2c3d4-0001-4000-8000-000000000001', project: 'b1b2c3d4-0001-4000-8000-000000000001' }
const migration = name => fs.readFileSync(path.join(__dirname, '../supabase/migrations', name + '.sql'), 'utf8')
const rollback = name => fs.readFileSync(path.join(__dirname, '../supabase/rollbacks', name + '_down.sql'), 'utf8')
test('runtime migrations: dedupe, grouping, leases, uncertainty, privileges and rollback', async () => {
  const db = new PGlite()
  try {
    await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;')
    for (const [table, columns] of Object.entries(schema)) {
      const fields = Object.entries(columns).map(([name, format]) => {
        const type = /^(uuid|text|boolean|jsonb|json|integer|bigint|numeric|double precision|real|date|timestamp with time zone|timestamp without time zone|text\[\]|uuid\[\]|integer\[\])$/.test(format) ? format : 'text'
        return `"${name}" ${type}${name === 'id' ? ' PRIMARY KEY' : ''}`
      })
      await db.exec(`CREATE TABLE public."${table}" (${fields.join(',')});`)
    }
    await db.query('INSERT INTO tenants(id) VALUES($1);', [scope.tenant])
    await db.query('INSERT INTO projects(id,tenant_id) VALUES($1,$2);', [scope.project, scope.tenant])
    await db.exec(`CREATE FUNCTION lv_now(uuid) RETURNS timestamptz LANGUAGE sql STABLE AS 'SELECT now()';
      CREATE FUNCTION lv_outbox_event_is_current(uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT true';
      CREATE FUNCTION appointment_reminders_paused(uuid) RETURNS boolean LANGUAGE sql STABLE AS 'SELECT false';`)
    const runtime = '20260909180000_kommo_app_runtime', context = '20260909181000_kommo_app_context', routes = '20260909182000_kommo_visit_routes'
    await db.exec(migration(runtime)); await db.exec(migration(context))
    assert.equal((await db.query("SELECT has_table_privilege('authenticated','lv_integration_events','SELECT') AS allowed")).rows[0].allowed, false)
    assert.equal((await db.query("SELECT has_function_privilege('anon','lv_app_receive(jsonb)','EXECUTE') AS allowed")).rows[0].allowed, false)
    const receive = async events => (await db.query('SELECT lv_app_receive($1::jsonb) AS count', [JSON.stringify(events)])).rows[0].count
    assert.equal(await receive([{ externalId: 'one', contactId: 1, kommoId: 5 }, { externalId: 'two', contactId: 1, kommoId: 5 }]), 2)
    assert.equal(await receive([{ externalId: 'one', contactId: 1, kommoId: 5 }]), 0)
    const token1 = '00000000-0000-4000-8000-000000000001', token2 = '00000000-0000-4000-8000-000000000002'
    const lock = async (token, action) => (await db.query('SELECT lv_app_worker_lock($1,$2) AS ok', [token, action])).rows[0].ok
    assert.equal(await lock(token1, 'acquire'), true); assert.equal(await lock(token2, 'acquire'), false)
    assert.equal(await lock(token2, 'renew'), false)
    const claim = async token => (await db.query('SELECT * FROM lv_app_claim($1)', [token])).rows
    assert.equal((await claim(token1)).length, 0)
    await db.exec("UPDATE lv_integration_events SET available_at=now()-interval '1 second' WHERE kind='inbound'")
    const claimed = await claim(token1); assert.equal(claimed.length, 2)
    assert.equal((await claim(token1)).length, 0)
    // Simular caída: otro token solo puede adquirir tras vencer el bloqueo.
    await db.exec("UPDATE lv_integration_events SET lease_until=now()-interval '1 second' WHERE kind='lock'")
    assert.equal(await lock(token2, 'acquire'), true); assert.equal(await lock(token1, 'renew'), false)
    assert.equal((await claim(token2)).length, 0)
    assert.equal((await db.query("SELECT count(*)::int AS n FROM lv_integration_events WHERE status='uncertain'")).rows[0].n, 2)
    assert.equal(await receive([{ externalId: 'three', contactId: 1, kommoId: 5 }]), 1)
    await db.exec("UPDATE lv_integration_events SET available_at=now()-interval '1 second' WHERE status='pending'")
    assert.equal((await claim(token2)).length, 0, 'unresolved conversation blocks subsequent events')
    await assert.rejects(() => db.exec(rollback(runtime)), /pendientes o inciertos/)
    await db.exec('ROLLBACK')
    assert.equal(await lock(token2, 'release'), true)
    for (const [kind, bot] of [['visit_propose', 0], ['visit_confirm', 0], ['visit_reschedule_confirm', 0], ['visit_2h', 18350]]) {
      await db.query('INSERT INTO lv_routes(project_id,kind,bot_id,detail_field_id,enabled) VALUES($1,$2,$3,0,true)', [scope.project, kind, bot])
    }
    await db.exec(migration(routes)); await db.exec(migration(routes))
    assert.equal((await db.query("SELECT detail_field_id FROM lv_routes WHERE kind='visit_2h'")).rows[0].detail_field_id, 513120)
    await db.exec(rollback(routes))
    assert.equal((await db.query("SELECT bot_id FROM lv_routes WHERE kind='visit_confirm'")).rows[0].bot_id, 0)
    await db.exec("UPDATE lv_routes SET bot_id=999 WHERE kind='visit_confirm'")
    await assert.rejects(() => db.exec(migration(routes)), /Configuración cambió/)
    await db.exec('ROLLBACK')
    // Una ruta cambiada aborta la transacción completa, incluida cualquier ruta anterior.
    assert.equal((await db.query("SELECT bot_id FROM lv_routes WHERE kind='visit_propose'")).rows[0].bot_id, 0)
    await db.exec("UPDATE lv_integration_events SET status='cancelled' WHERE kind<>'lock'")
    await db.exec(rollback(context)); await db.exec(rollback(runtime))
    assert.equal((await db.query("SELECT to_regclass('public.lv_integration_events') AS table")).rows[0].table, null)
  } finally { await db.close() }
})
