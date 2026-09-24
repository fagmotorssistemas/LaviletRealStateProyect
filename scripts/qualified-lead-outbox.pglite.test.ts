import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const staging = readFileSync(
  'supabase/migrations/20260924213000_hot_lead_capi_signal_staging.sql',
  'utf8',
)
const enable = readFileSync(
  'supabase/migrations/20260924214000_enable_crm_qualified_lead_outbox.sql',
  'utf8',
)
const TENANT = '10000000-0000-4000-8000-000000000001'
const PROJECT = '20000000-0000-4000-8000-000000000001'

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
    create table meta_capi_outbox(
      id uuid primary key default gen_random_uuid(), idempotency_key text not null unique,
      event_id uuid not null, event_name text not null,
      event_time bigint not null, payload jsonb not null default '{}'::jsonb,
      status text not null default 'pending', delivery_lane text not null default 'live',
      lead_id uuid, visitor_key text, ads_consent_required boolean not null default true,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
      forwarded_at timestamptz, last_error text,
      constraint meta_capi_outbox_event_name_check check(event_name in
        ('ViewContent','Lead','Schedule','LeadSubmitted','AddToWishlist','Purchase'))
    );
    insert into tenants values('${TENANT}'); insert into projects values('${PROJECT}');
  `)
  await db.exec(staging)
  await db.exec(enable)
  return db
}

async function seedLead(db: PGlite, suffix: string, consent: boolean | null = true) {
  const lead = `30000000-0000-4000-8000-0000000000${suffix}`
  const evaluation = `40000000-0000-4000-8000-0000000000${suffix}`
  const consentSql = consent == null ? 'null' : String(consent)
  await db.exec(`
    insert into leads values('${lead}','${TENANT}','${PROJECT}','contact-${suffix}',${consentSql},null);
    insert into lv_whatsapp_ctwa_attribution(tenant_id,project_id,contact_id,ctwa_clid,source_id,external_message_id,captured_at)
      values('${TENANT}','${PROJECT}','contact-${suffix}','ctwa-${suffix}','ad-${suffix}','message-${suffix}','2026-09-24T10:00:00Z');
    insert into lead_interest_evaluations values('${evaluation}','${lead}','source-${suffix}',
      '2026-09-24T11:00:00Z','2026-09-24T11:00:01Z',
      '["asked_financing","requested_visit"]',null);
    insert into lead_temperature_history(lead_id,from_temperature,to_temperature,created_at)
      values('${lead}','frio','tibio','2026-09-24T11:00:02Z');
    update lead_interest_evaluations set temperature='tibio' where id='${evaluation}';
  `)
  return { lead, evaluation }
}

test('flag apagado retiene la intención y no crea outbox', async () => {
  const db = await fixture()
  await seedLead(db, '01')
  const intent = await db.query<{
    status: string
    proposed_event_name: string
    event_time: number
  }>('select status, proposed_event_name, event_time from meta_crm_qualification_intents')
  assert.deepEqual(intent.rows[0], {
    status: 'held',
    proposed_event_name: 'QualifiedLead',
    event_time: 1790247601,
  })
  assert.equal((await db.query('select id from meta_capi_outbox')).rows.length, 0)
  await db.close()
})

test('corte activo encola QualifiedLead atómicamente con evidencia y fecha originales', async () => {
  const db = await fixture()
  await db.exec(`update meta_capi_signal_activation set enabled=true,
    cutover_at='2026-09-24T11:00:00Z', delivery_lane='test',
    whatsapp_business_account_id='waba-test', messaging_dataset_id='dataset-test'
    where signal_kind='crm_qualification'`)
  const { lead } = await seedLead(db, '02')
  const rows = await db.query<Record<string, unknown>>('select * from meta_capi_outbox')
  assert.equal(rows.rows.length, 1)
  assert.equal(rows.rows[0].event_name, 'QualifiedLead')
  assert.equal(rows.rows[0].event_time, 1790247601)
  assert.equal(rows.rows[0].idempotency_key, `wa_crm_qualified:${lead}`)
  assert.equal(rows.rows[0].delivery_lane, 'test')
  const payload = rows.rows[0].payload as Record<string, unknown>
  assert.equal(payload.action_source, 'business_messaging')
  assert.equal(payload.messaging_channel, 'whatsapp')
  assert.equal(payload.temperature, 'tibio')
  assert.deepEqual(payload.evidence_labels, ['cita_solicitada', 'financiamiento'])
  assert.equal(
    (await db.query<{ status: string }>('select status from meta_crm_qualification_intents'))
      .rows[0].status,
    'enqueued',
  )

  await db.exec(`
    insert into lead_temperature_history(lead_id,from_temperature,to_temperature,created_at)
      values('${lead}','tibio','caliente','2026-09-24T12:00:00Z');
    update lead_interest_evaluations set temperature='caliente'
      where lead_id='${lead}';
  `)
  assert.equal((await db.query('select id from meta_capi_outbox')).rows.length, 1)
  await db.close()
})

test('activar no libera históricos retenidos y un hecho anterior al corte sigue bloqueado', async () => {
  const db = await fixture()
  await seedLead(db, '03')
  await db.exec(`update meta_capi_signal_activation set enabled=true,
    cutover_at='2026-09-25T00:00:00Z', delivery_lane='live',
    whatsapp_business_account_id='waba-live', messaging_dataset_id='dataset-live'
    where signal_kind='crm_qualification'`)
  assert.equal((await db.query('select id from meta_capi_outbox')).rows.length, 0)
  await seedLead(db, '04')
  assert.equal((await db.query('select id from meta_capi_outbox')).rows.length, 0)
  const reasons = await db.query<{ hold_reasons: string[] }>(
    `select hold_reasons from meta_crm_qualification_intents where lead_id='30000000-0000-4000-8000-000000000004'`,
  )
  assert.ok(reasons.rows[0].hold_reasons.includes('before_activation_cutover'))
  await db.close()
})
