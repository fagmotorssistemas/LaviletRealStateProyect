// PostgreSQL en memoria: first-touch CTWA con dos mensajes distintos del mismo contacto.
// No lee .env ni toca Production.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PGlite } = require('@electric-sql/pglite')

const scope = {
  tenant: 'a1b2c3d4-0001-4000-8000-000000000001',
  project: 'b1b2c3d4-0001-4000-8000-000000000001',
}

test('lv_app_preserve_ctwa: mensajes distintos del mismo contacto conservan la primera captura', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      CREATE TABLE public.tenants (id uuid PRIMARY KEY);
      CREATE TABLE public.projects (id uuid PRIMARY KEY, tenant_id uuid REFERENCES public.tenants(id));
    `)
    await db.query('INSERT INTO tenants(id) VALUES($1)', [scope.tenant])
    await db.query('INSERT INTO projects(id, tenant_id) VALUES($1,$2)', [scope.project, scope.tenant])

    const sql = fs.readFileSync(
      path.join(__dirname, '../supabase/migrations/20260916220000_whatsapp_ctwa_attribution.sql'),
      'utf8',
    )
    await db.exec(sql)

    const preserve = async (contactId, kommoId, clid, messageId, fieldPath) => {
      const res = await db.query(
        `SELECT lv_app_preserve_ctwa($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) AS result`,
        [
          scope.tenant,
          scope.project,
          String(contactId),
          kommoId,
          clid,
          fieldPath,
          null,
          null,
          'ad',
          messageId,
        ],
      )
      return res.rows[0].result
    }

    const first = await preserve(456, 123, 'Aff-FIRST', 'msg-1', 'path-a')
    assert.equal(first.action, 'inserted')
    assert.equal(first.ctwa_clid, 'Aff-FIRST')

    // Segundo mensaje, otro clid: no reemplaza (first-touch por contacto).
    const second = await preserve(456, 123, 'Aff-SECOND', 'msg-2', 'path-b')
    assert.equal(second.action, 'preserved_existing')
    assert.equal(second.ctwa_clid, 'Aff-FIRST')
    assert.equal(second.external_message_id, 'msg-1')

    // Reintento del primer mensaje: duplicate_retry, misma captura.
    const retry = await preserve(456, 123, 'Aff-FIRST', 'msg-1', 'path-a')
    assert.equal(retry.action, 'duplicate_retry')
    assert.equal(retry.ctwa_clid, 'Aff-FIRST')

    const rows = await db.query(
      'SELECT ctwa_clid, external_message_id FROM lv_whatsapp_ctwa_attribution WHERE contact_id=$1',
      ['456'],
    )
    assert.equal(rows.rows.length, 1)
    assert.equal(rows.rows[0].ctwa_clid, 'Aff-FIRST')
    assert.equal(rows.rows[0].external_message_id, 'msg-1')

    const get = await db.query('SELECT lv_app_get_ctwa($1,$2) AS result', [scope.project, '456'])
    assert.equal(get.rows[0].result.found, true)
    assert.equal(get.rows[0].result.ctwa_clid, 'Aff-FIRST')
  } finally {
    await db.close()
  }
})
