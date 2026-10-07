/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs')
const { PGlite } = require('@electric-sql/pglite')

test('a disabled lender cannot collect data or reach handoff, while a new explicit choice preserves prior progress', async () => {
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
    await db.exec(fs.readFileSync('supabase/migrations/20261004190000_financing_identity_intake.sql', 'utf8'))
    const migration = fs.readFileSync('supabase/migrations/20261007013000_financing_active_lender_intake.sql', 'utf8')
    await db.exec(migration)
    await db.exec(migration)
    const scope = (await db.query('SELECT gen_random_uuid() tenant,gen_random_uuid() project')).rows[0]
    const lead = (await db.query(`INSERT INTO leads(tenant_id,project_id,name,phone) VALUES($1,$2,'Ana','0991234567') RETURNING id`, [scope.tenant, scope.project])).rows[0].id
    await db.query(`INSERT INTO project_financing_partners VALUES($1,$2,'Pichincha',$3,true,false,null,now()),($1,$2,'JEP',$4,true,true,'0990000000',now())`,
      [scope.tenant, scope.project, JSON.stringify([{ name: 'Banco Pichincha' }]), JSON.stringify([{ name: 'Cooperativa JEP' }])])
    await db.query(`INSERT INTO financing_prequalifications(tenant_id,project_id,lead_id,status,explicit_consent,selected_partner_name,legal_name,legal_name_confirmed,national_id,applicant_type,monthly_income)
      VALUES($1,$2,$3,'recolectando',true,'Cooperativa JEP','Ana Paz',true,'0102030405','independiente',null)`, [scope.tenant, scope.project, lead])
    const disabled = (await db.query(`SELECT process_financing_message_v3(p_lead_id=>$1,p_monthly_income=>2500) result`, [lead])).rows[0].result
    assert.equal(disabled.selected_partner_name, null)
    assert.equal(disabled.state, 'entidad_pendiente')
    assert.equal(disabled.ready_for_handoff, false)
    assert.equal(disabled.monthly_income, null)
    assert.equal(disabled.national_id, '0102030405')
    assert.deepEqual(disabled.financing_options, [{ name: 'Banco Pichincha' }])
    assert.equal((await db.query('SELECT count(*)::int n FROM asesoria_financiamiento')).rows[0].n, 0)
    const selected = (await db.query(`SELECT process_financing_message_v3(p_lead_id=>$1,p_financing_partner=>'Banco Pichincha',p_monthly_income=>2500) result`, [lead])).rows[0].result
    assert.equal(selected.selected_partner_name, 'Banco Pichincha')
    assert.equal(selected.full_name, 'Ana Paz')
    assert.equal(selected.ready_for_handoff, true)
    assert.equal((await db.query('SELECT count(*)::int n FROM asesoria_financiamiento')).rows[0].n, 1)
    await db.query(`UPDATE project_financing_partners SET public_enabled=false WHERE public_summary='Pichincha'`)
    const unavailable = (await db.query(`SELECT process_financing_message_v3(p_lead_id=>$1) result`, [lead])).rows[0].result
    assert.equal(unavailable.available, false)
    assert.equal(unavailable.selected_partner_name, null)
    assert.equal(unavailable.ready_for_handoff, false)
    assert.equal((await db.query('SELECT count(*)::int n FROM asesoria_financiamiento')).rows[0].n, 1)
    // All eligible agreements are included, instead of silently choosing the newest row.
    await db.query(`UPDATE project_financing_partners SET public_enabled=true,test_only=false`)
    const both = (await db.query(`SELECT process_financing_message_v3(p_lead_id=>$1) result`, [lead])).rows[0].result
    assert.deepEqual(both.financing_options.map(o => o.name).sort(), ['Banco Pichincha', 'Cooperativa JEP'])
    assert.equal(both.selected_partner_name, null)
  } finally { await db.close() }
})
