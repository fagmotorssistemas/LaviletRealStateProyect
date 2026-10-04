/* eslint-disable @typescript-eslint/no-require-imports */
// Isolated PostgreSQL: no remote database or customer messages.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')
const migration = fs.readFileSync('supabase/migrations/20261004190000_financing_identity_intake.sql', 'utf8')

test('financial intake persists confirmed legal identity, accepts personal RUC as cedula and never requires RUC', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,project_id uuid,name text,phone text,financing boolean,updated_at timestamptz);
      CREATE TABLE project_financing_partners(tenant_id uuid,project_id uuid,public_summary text,financing_options jsonb,public_enabled boolean,test_only boolean,test_phone text,updated_at timestamptz);
      CREATE TABLE financing_partners(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),partner_name text,active boolean);
      CREATE TABLE financing_prequalifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,project_id uuid,lead_id uuid,status text,explicit_consent boolean DEFAULT false,consent_text text,consent_at timestamptz,consent_source_message_id text,updated_at timestamptz,selected_partner_name text,financing_partner_id uuid,applicant_type text,national_id text,employment_stability_months integer,job_title text,monthly_income numeric,ruc text);
      CREATE TABLE asesoria_financiamiento(tenant_id uuid,project_id uuid,lead_id uuid,prequalification_id uuid,mensaje_completo text,status text);
      INSERT INTO financing_partners(partner_name,active) VALUES ('Banco Pichincha',true),('Cooperativa JEP',true);
    `)
    await db.exec(migration)
    await db.exec(migration)
    const scope = (await db.query('SELECT gen_random_uuid() tenant,gen_random_uuid() project')).rows[0]
    await db.query(`INSERT INTO project_financing_partners VALUES($1,$2,'Opciones disponibles',$3,true,false,null,now())`,
      [scope.tenant, scope.project, JSON.stringify([{ name: 'Banco Pichincha' }, { name: 'Cooperativa JEP' }])])
    const turn = async (id, args = {}) => {
      const entries = Object.entries(args)
      return (await db.query(`SELECT process_financing_message_v3(p_lead_id => $1${entries.map(([k], i) => `,p_${k}=>$${i + 2}`).join('')}) result`,
        [id, ...entries.map(([, v]) => v)])).rows[0].result
    }
    for (const applicant of ['empleado', 'independiente']) {
      const id = (await db.query(`INSERT INTO leads(tenant_id,project_id,name) VALUES($1,$2,'Nombre WhatsApp Completo') RETURNING id`,
        [scope.tenant, scope.project])).rows[0].id
      assert.equal((await turn(id)).active, false)
      assert.equal((await turn(id, { asked_financing: true })).state, 'continuacion_pendiente')
      assert.equal((await turn(id, { financing_consent: true, financing_partner: 'Cooperativa JEP' })).state, 'identificacion_pendiente')
      const partial = await turn(id, { full_name: 'Ana' })
      assert.equal(partial.legal_name_confirmed, false)
      assert.equal(partial.state, 'identificacion_pendiente')
      assert.equal((await turn(id, { full_name: 'Ana Paz', name_complete: true })).state, 'cedula_pendiente')
      assert.equal((await turn(id, { national_id: '01010203120312031203' })).state, 'cedula_pendiente')
      assert.equal((await turn(id, { national_id: '0192030405001' })).state, 'cedula_pendiente')
      const document = await turn(id, { national_id: '0102030405001' })
      assert.equal(document.national_id, '0102030405')
      assert.equal(document.ruc, null)
      assert.equal(document.state, 'tipo_solicitante_pendiente')
      assert.equal((await turn(id, { national_id: '' })).state, 'cedula_pendiente')
      await turn(id, { national_id: '0102030405' })
      assert.equal((await turn(id, { applicant_type: applicant })).state, applicant === 'empleado' ? 'estabilidad_pendiente' : 'ingreso_pendiente')
      if (applicant === 'empleado') {
        assert.equal((await turn(id, { employment_stability_months: 6 })).state, 'cargo_pendiente')
        assert.equal((await turn(id, { job_title: 'Analista' })).state, 'ingreso_pendiente')
      }
      const ready = await turn(id, { monthly_income: 2500 })
      assert.equal(ready.ready_for_handoff, true)
      assert.equal(ready.state, 'lista_para_revision')
      await turn(id)
      assert.equal((await db.query('SELECT count(*)::int n FROM asesoria_financiamiento WHERE lead_id=$1', [id])).rows[0].n, 1)
    }
    const privileges = (await db.query(`SELECT has_function_privilege('anon','public.process_financing_message_v3(uuid,boolean,boolean,text,text,text,text,integer,text,numeric,text,text,text,boolean)','EXECUTE') AS allowed`)).rows[0]
    assert.equal(privileges.allowed, false)
  } finally { await db.close() }
})
