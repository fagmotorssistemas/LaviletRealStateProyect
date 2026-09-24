import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync('supabase/migrations/20260924213000_hot_lead_capi_signal_staging.sql', 'utf8')
const TENANT = '10000000-0000-4000-8000-000000000001'
const PROJECT = '20000000-0000-4000-8000-000000000001'
const LEAD = '30000000-0000-4000-8000-000000000001'
const INTERNAL = '30000000-0000-4000-8000-000000000002'
const EVALUATION = '40000000-0000-4000-8000-000000000001'

async function fixture() {
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin;
    create table tenants(id uuid primary key); create table projects(id uuid primary key);
    create table leads(id uuid primary key, tenant_id uuid not null, project_id uuid not null,
      contact_id text, meta_ads_consent boolean, meta_wa_lead_submitted_event_id uuid);
    create table lead_interest_evaluations(id uuid primary key, lead_id uuid not null,
      source_message_id text not null, source_sent_at timestamptz not null,
      evaluated_at timestamptz not null, recognized_events jsonb not null, temperature text);
    create table lead_temperature_history(id uuid primary key default gen_random_uuid(), lead_id uuid,
      from_temperature text, to_temperature text, created_at timestamptz not null);
    create table crm_contact_classifications(id uuid primary key default gen_random_uuid(), tenant_id uuid,
      lead_id uuid, classification text, recorded_at timestamptz not null);
    create table lv_auto_config(tenant_id uuid, project_id uuid, test_lead_id uuid);
    create table lv_whatsapp_ctwa_attribution(id uuid primary key default gen_random_uuid(), tenant_id uuid,
      project_id uuid, contact_id text, ctwa_clid text, source_id text, external_message_id text,
      captured_at timestamptz not null);
    insert into tenants values('${TENANT}'); insert into projects values('${PROJECT}');
    insert into leads values
      ('${LEAD}','${TENANT}','${PROJECT}','contact-1',true,'50000000-0000-4000-8000-000000000001'),
      ('${INTERNAL}','${TENANT}','${PROJECT}','contact-2',true,null);
    insert into lv_whatsapp_ctwa_attribution(tenant_id,project_id,contact_id,ctwa_clid,source_id,external_message_id,captured_at)
      values('${TENANT}','${PROJECT}','contact-1','ctwa-first','ad-first','message-first','2026-09-24T10:00:00Z');
    insert into crm_contact_classifications(tenant_id,lead_id,classification,recorded_at)
      values('${TENANT}','${INTERNAL}','internal','2026-09-24T10:00:00Z');
  `)
  await db.exec(migration)
  return db
}

test('transiciÃ³n persistida crea una intenciÃ³n retenida con fecha y atribuciÃ³n originales', async () => {
  const db = await fixture()
  await db.exec(`
    insert into lead_interest_evaluations values('${EVALUATION}','${LEAD}','source-message','2026-09-24T11:00:00Z','2026-09-24T11:00:01Z','["asked_financing"]',null);
    insert into lead_temperature_history(lead_id,from_temperature,to_temperature,created_at)
      values('${LEAD}','tibio','caliente','2026-09-24T11:00:02Z');
    update lead_interest_evaluations set temperature='caliente' where id='${EVALUATION}';
  `)
  const result = await db.query<Record<string, unknown>>('select * from meta_crm_qualification_intents')
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0].status, 'held')
  assert.equal(result.rows[0].event_time, 1790247601)
  assert.equal(result.rows[0].ctwa_clid, 'ctwa-first')
  assert.equal(result.rows[0].ad_source_id, 'ad-first')
  assert.equal(result.rows[0].idempotency_key, `wa_crm_qualified:${LEAD}`)
  assert.deepEqual(result.rows[0].evidence_labels, ['financiamiento'])
  assert.equal(result.rows[0].initial_lead_submitted_event_id, '50000000-0000-4000-8000-000000000001')
  await db.close()
})

test('tibio evaluado crea intenciÃ³n una vez; cambio posterior a caliente no duplica', async () => {
  const db = await fixture()
  await db.exec(`insert into lead_interest_evaluations values('${EVALUATION}','${LEAD}','m1',now(),now(),'["declared_unit_type"]',null)`)
  assert.equal((await db.query('select id from meta_crm_qualification_intents')).rows.length, 0)
  await db.exec(`
    insert into lead_temperature_history(lead_id,from_temperature,to_temperature,created_at)
      values('${LEAD}','frio','tibio',clock_timestamp());
    update lead_interest_evaluations set temperature='tibio' where id='${EVALUATION}';
    insert into lead_temperature_history(lead_id,from_temperature,to_temperature,created_at)
      values('${LEAD}','tibio','caliente',clock_timestamp());
    update lead_interest_evaluations set temperature='caliente' where id='${EVALUATION}';
    update lead_interest_evaluations set temperature='caliente' where id='${EVALUATION}';
  `)
  assert.equal((await db.query('select id from meta_crm_qualification_intents')).rows.length, 1)
  await db.close()
})

test('interno queda excluido y la falta de atribuciÃ³n se registra', async () => {
  const db = await fixture()
  await db.exec(`
    insert into lead_interest_evaluations values('40000000-0000-4000-8000-000000000002','${INTERNAL}','m2',now(),now(),'["requested_visit"]',null);
    insert into lead_temperature_history(lead_id,from_temperature,to_temperature,created_at)
      values('${INTERNAL}','frio','caliente',clock_timestamp());
    update lead_interest_evaluations set temperature='caliente' where lead_id='${INTERNAL}';
  `)
  const result = await db.query<{ status: string; hold_reasons: string[] }>('select status,hold_reasons from meta_crm_qualification_intents')
  assert.equal(result.rows[0].status, 'excluded')
  assert.ok(result.rows[0].hold_reasons.includes('internal_contact'))
  assert.ok(result.rows[0].hold_reasons.includes('original_ctwa_attribution_required'))
  await db.close()
})
