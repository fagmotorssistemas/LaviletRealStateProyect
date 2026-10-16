import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

test('commercial profile migration enforces scoped audited writes and preserves score without false reservations', async () => {
  const db = new PGlite()
  const lead = '10000000-0000-4000-8000-000000000001'
  const other = '10000000-0000-4000-8000-000000000002'
  const advisor = '20000000-0000-4000-8000-000000000001'
  const foreign = '20000000-0000-4000-8000-000000000002'
  const colleague = '20000000-0000-4000-8000-000000000003'
  const tenant = '30000000-0000-4000-8000-000000000001'
  const tenant2 = '30000000-0000-4000-8000-000000000002'
  const project = '40000000-0000-4000-8000-000000000001'
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
      grant usage on schema auth to authenticated,service_role;
      create table tenants(id uuid primary key);
      create table profiles(id uuid primary key,role text,is_active boolean);
      create table leads(id uuid primary key,tenant_id uuid,project_id uuid,assigned_to uuid,stage text,
        stage_reason text,stage_updated_at timestamptz,updated_at timestamptz,
        temperature text default 'frio',temperature_score int default 0,temperature_updated_at timestamptz);
      create table project_salespeople(salesperson_id uuid,tenant_id uuid,project_id uuid);
      create table unit_sales_closings(id uuid,lead_id uuid,unit_id uuid,sale_at timestamptz);
      create table lead_reservation_requests(id uuid,lead_id uuid,unit_ids jsonb,evidence text);
      create table lead_stage_history(lead_id uuid,from_stage text,to_stage text,reason text,created_at timestamptz);
      create table lead_scoring_rules(event_type text,points int,reason text,repeatable boolean,active boolean);
      create table project_automation_config(project_id uuid,temperature_warm_min int,temperature_hot_min int);
      create table lead_score_events(lead_id uuid,event_type text,points int,reason text,source_message_id text,idempotency_key text,unique(lead_id,idempotency_key));
      create table lead_temperature_history(lead_id uuid,from_temperature text,to_temperature text,score int,reason text,created_at timestamptz);
      create function set_lead_stage(old_lead uuid,old_destination text,old_reason text) returns void language sql as $$select$$;
      insert into tenants values('${tenant}'),('${tenant2}');
      insert into profiles values('${advisor}','asesor',true),('${foreign}','asesor',true),('${colleague}','asesor',true);
      insert into leads(id,tenant_id,project_id,assigned_to,stage) values('${lead}','${tenant}','${project}','${advisor}','contacto_inicial'),('${other}','${tenant2}','${project}','${foreign}','contacto_inicial');
      insert into project_salespeople values('${advisor}','${tenant}','${project}'),('${foreign}','${tenant2}','${project}'),('${colleague}','${tenant}','${project}');
      insert into lead_scoring_rules values('asked_reservation',25,'consulta reserva',false,true),('first_response',100,'participación',false,true);
      insert into project_automation_config values('${project}',25,60);
      grant select on leads to authenticated;
      select set_config('request.jwt.claim.sub','${advisor}',false),set_config('request.jwt.claim.role','authenticated',false);
    `)
    await db.exec(readFileSync('supabase/migrations/20261015210000_lead_commercial_pipeline.sql', 'utf8'))
    const save = (id: string, active: boolean, evidence: string | null, status = 'open', reason: string | null = null) =>
      db.query(`select public.save_lead_commercial_profile($1,$2,'Compra futura','Próximo año',$3,true,null,'Responder consulta',null,$4,$5)`, [id, active, evidence, status, reason])
    await db.exec('set role authenticated')
    await assert.rejects(save(other, false, null), /LEAD_PROFILE_FORBIDDEN/)
    await assert.rejects(save(lead, true, null), /nutrition_proof/)
    await save(lead, true, 'Comprar el próximo año; sí, podemos seguir en contacto')
    const saved = await db.query<{ nutrition_active: boolean }>('select nutrition_active from lead_commercial_profiles')
    assert.equal(saved.rows[0].nutrition_active, true)
    const audit = await db.query<{ actor_id: string }>('select actor_id from lead_commercial_profile_history')
    assert.equal(audit.rows[0].actor_id, advisor)
    await db.exec(`select set_config('request.jwt.claim.sub','${colleague}',false)`)
    assert.equal((await db.query('select * from lead_commercial_profiles')).rows.length, 1)
    await assert.rejects(save(lead, false, null), /LEAD_PROFILE_OWNER_REQUIRED/)
    await db.exec(`select set_config('request.jwt.claim.sub','${advisor}',false)`)
    await assert.rejects(db.exec('update lead_commercial_profiles set contact_consent=false'), /permission denied/)
    await db.exec(`select set_config('request.jwt.claim.sub','${foreign}',false)`)
    assert.equal((await db.query('select * from lead_commercial_profiles')).rows.length, 0)
    await db.exec(`select set_config('request.jwt.claim.sub','${advisor}',false); reset role;
      select set_config('request.jwt.claim.role','service_role',false);`)
    const score = () => db.query<{ temperature_score: number; handoff_required: boolean }>(
      `select * from apply_lead_events($1,'["asked_reservation"]','m1')`, [lead])
    assert.equal((await score()).rows[0].temperature_score, 25)
    assert.equal((await score()).rows[0].temperature_score, 25)
    assert.equal((await db.query<{ stage: string }>('select stage from leads where id=$1', [lead])).rows[0].stage, 'preventa')
    await db.query(`select set_lead_stage($1,'reserva_venta','solo consulta')`, [lead])
    assert.equal((await db.query<{ stage: string }>('select stage from leads where id=$1', [lead])).rows[0].stage, 'preventa')
    await db.query(`select * from apply_lead_events($1,'["first_response"]','m2')`, [other])
    assert.equal((await db.query<{ stage: string }>('select stage from leads where id=$1', [other])).rows[0].stage, 'contacto_inicial')
    await db.exec(`insert into lead_reservation_requests values(gen_random_uuid(),'${lead}','["unit"]','quiero iniciar reserva')`)
    await db.query(`select set_lead_stage($1,'reserva_venta','solicitud operacional')`, [lead])
    assert.equal((await db.query<{ stage: string }>('select stage from leads where id=$1', [lead])).rows[0].stage, 'reserva_venta')
    await db.exec(`insert into unit_sales_closings values(gen_random_uuid(),'${lead}',gen_random_uuid(),now()); set role authenticated;
      select set_config('request.jwt.claim.role','authenticated',false)`)
    await assert.rejects(save(lead, false, null, 'lost', 'no responde'), /SALE_ALREADY_RECORDED/)
    for (const role of ['anon', 'authenticated']) {
      assert.equal((await db.query<{ allowed: boolean }>(`select has_function_privilege($1,'apply_lead_events(uuid,jsonb,text)','execute') allowed`, [role])).rows[0].allowed, false)
    }
    await assert.rejects(db.query(`select record_lead_commercial_stage_observation($1,'nuevo','registrado','[]',null)`, [lead]), /permission denied/)
    await db.exec(`reset role; select set_config('request.jwt.claim.role','service_role',false)`)
    const observe = (stage: string) => db.query<{ observation: { from_stage: string | null; to_stage: string; source_at: string; observed_at: string } }>(
      `select record_lead_commercial_stage_observation($1,$2,'Evidencia proyectada','[{"source":"lead_score_events"}]','2026-01-01') observation`, [other, stage])
    const first = (await observe('interes_comercial')).rows[0].observation
    assert.equal(first.from_stage, null)
    assert.ok(Date.parse(first.observed_at) > Date.parse(first.source_at))
    await observe('interes_comercial')
    assert.equal((await db.query('select * from lead_commercial_stage_observations')).rows.length, 1)
    const changed = (await observe('proceso_reserva')).rows[0].observation
    assert.equal(changed.from_stage, 'interes_comercial'); assert.equal(changed.to_stage, 'proceso_reserva')
    await assert.rejects(observe('reserva_venta'), /INVALID_COMMERCIAL_STAGE/)
    const batch = [{ lead_id: lead, stage: 'venta_cerrada', reason: 'Venta registrada', evidence: [{ source: 'unit_sales_closings' }], source_at: null }]
    await db.query('select record_lead_commercial_stage_observations($1)', [JSON.stringify(batch)])
    await db.query('select record_lead_commercial_stage_observations($1)', [JSON.stringify(batch)])
    assert.equal((await db.query('select * from lead_commercial_stage_observations')).rows.length, 3)
    await assert.rejects(db.query('select record_lead_commercial_stage_observations($1)', ['{}']), /INVALID_PIPELINE_OBSERVATIONS/)
    await assert.rejects(db.query('select record_lead_commercial_stage_observations($1)', [JSON.stringify([{ ...batch[0], actor_id: advisor }])]), /INVALID_PIPELINE_OBSERVATION/)
    await assert.rejects(db.query('select record_lead_commercial_stage_observations($1)', [JSON.stringify(Array.from({ length: 201 }, () => batch[0]))]), /BATCH_TOO_LARGE/)
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.role','authenticated',false)`)
    assert.equal((await db.query('select * from lead_commercial_stage_observations')).rows.length, 1)
    await assert.rejects(db.query('select record_lead_commercial_stage_observations($1)', ['[]']), /permission denied/)
  } finally { await db.close() }
})
