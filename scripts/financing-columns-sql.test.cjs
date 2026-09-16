// Isolated PostgreSQL; no production credentials, leads or messages.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { PGlite } = require('../tmp/integration-sql-tests/node_modules/@electric-sql/pglite')
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260916110000_financing_partner_columns.sql'), 'utf8')

test('partner selection reproduces 42703 before fix and completes both intake paths after fix', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      CREATE TABLE leads(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,project_id uuid,name text,phone text,financing boolean,updated_at timestamptz);
      CREATE TABLE project_financing_partners(tenant_id uuid,project_id uuid,public_summary text,financing_options jsonb,public_enabled boolean,test_only boolean,test_phone text,updated_at timestamptz);
      CREATE TABLE financing_partners(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),partner_name text,active boolean);
      CREATE TABLE financing_prequalifications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,project_id uuid,lead_id uuid,status text,explicit_consent boolean DEFAULT false,consent_text text,consent_at timestamptz,consent_source_message_id text,updated_at timestamptz,selected_partner_name text,financing_partner_id uuid,applicant_type text,national_id text,employment_stability_months integer,job_title text,monthly_income numeric,ruc text);
      CREATE TABLE asesoria_financiamiento(tenant_id uuid,project_id uuid,lead_id uuid,prequalification_id uuid,mensaje_completo text,status text);
      INSERT INTO financing_partners(partner_name,active) VALUES ('Banco Pichincha',true),('Cooperativa JEP',true);
    `)
    const scope = (await db.query('SELECT gen_random_uuid() tenant,gen_random_uuid() project')).rows[0]
    await db.query(`INSERT INTO project_financing_partners VALUES($1,$2,'Opciones disponibles',$3,true,false,null,now())`, [scope.tenant, scope.project, JSON.stringify([{name:'Banco Pichincha'},{name:'Cooperativa JEP'}])])
    const makeLead = async () => (await db.query('INSERT INTO leads(tenant_id,project_id) VALUES($1,$2) RETURNING id',[scope.tenant,scope.project])).rows[0].id
    const turn = async (id, args = {}) => {
      const entries = Object.entries(args)
      return (await db.query(`SELECT process_financing_message_v2(p_lead_id => $1${entries.map(([k],i)=>`, p_${k} => $${i+2}`).join('')}) result`, [id,...entries.map(([,v])=>v)])).rows[0].result
    }
    // Original failing names, on the same schema as the corrected function.
    await db.exec(migration.replaceAll('fp.partner_name','fp.name').replaceAll('fp.active','fp.is_active'))
    const broken = await makeLead()
    await turn(broken,{asked_financing:true,financing_consent:true})
    await assert.rejects(turn(broken,{financing_partner:'Banco Pichincha'}), e => e.code === '42703' && /fp.name/.test(e.message))
    await db.exec(migration)
    await db.exec(migration) // safe to apply again
    assert.equal(migration,fs.readFileSync(path.join(__dirname,'../operations/activar_correccion_financiamiento.sql'),'utf8'))
    for (const [partner,type] of [['Banco Pichincha','dependiente'],['Cooperativa JEP','independiente']]) {
      const id = await makeLead()
      assert.equal((await turn(id,{asked_financing:true})).state,'continuacion_pendiente')
      assert.equal((await turn(id,{financing_consent:true})).state,'entidad_pendiente')
      const selected = await turn(id,{financing_partner:partner})
      assert.equal(selected.state,'identificacion_pendiente')
      assert.equal(selected.selected_partner_name,partner)
      const linked = (await db.query('SELECT p.partner_name FROM financing_prequalifications f JOIN financing_partners p ON p.id=f.financing_partner_id WHERE f.lead_id=$1',[id])).rows[0]
      assert.equal(linked.partner_name,partner)
      assert.equal((await turn(id,{full_name:'Persona Prueba'})).state,'cedula_pendiente')
      assert.equal((await turn(id,{national_id:'0000000000'})).state,'tipo_solicitante_pendiente')
      const typed = await turn(id,{applicant_type:type})
      if(type === 'dependiente') {
        assert.equal(typed.state,'estabilidad_pendiente')
        assert.equal((await turn(id,{employment_stability_months:24})).state,'cargo_pendiente')
        assert.equal((await turn(id,{job_title:'Analista'})).state,'ingreso_pendiente')
        assert.equal((await turn(id,{monthly_income:2500})).ready_for_handoff,true)
      } else {
        assert.equal(typed.state,'ingreso_pendiente')
        assert.equal((await turn(id,{monthly_income:2500})).state,'ruc_pendiente')
        assert.equal((await turn(id,{ruc:'0000000000001'})).ready_for_handoff,true)
      }
      await turn(id)
      assert.equal((await db.query('SELECT count(*)::int n FROM asesoria_financiamiento WHERE lead_id=$1',[id])).rows[0].n,1)
    }
  } finally { await db.close() }
})
