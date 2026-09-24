import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20260924213000_hot_lead_capi_signal_staging.sql', 'utf8')
const enableSql = readFileSync('supabase/migrations/20260924214000_enable_crm_qualified_lead_outbox.sql', 'utf8')

test('la seÃ±al nace de evaluaciÃ³n persistida tibia o caliente y no recalcula temperatura', () => {
  assert.match(sql, /ON public\.lead_interest_evaluations/i)
  assert.match(sql, /NEW\.temperature IN \('tibio', 'caliente'\)/i)
  assert.match(sql, /lead_temperature_history[\s\S]*to_temperature = NEW\.temperature[\s\S]*from_temperature IS DISTINCT FROM NEW\.temperature/i)
  assert.doesNotMatch(sql, /UPDATE public\.leads[\s\S]*temperature/i)
  assert.doesNotMatch(sql, /lead_scoring_rules|temperature_score/i)
})

test('la conexión QualifiedLead nace apagada, es atómica y no barre históricos', () => {
  assert.match(enableSql, /VALUES \('crm_qualification', false\)/i)
  assert.match(enableSql, /BEFORE INSERT ON public\.meta_crm_qualification_intents/i)
  assert.match(enableSql, /INSERT INTO public\.meta_capi_outbox[\s\S]*'QualifiedLead'/i)
  assert.match(enableSql, /NEW\.qualified_at < v_activation\.cutover_at/i)
  assert.doesNotMatch(enableSql, /INSERT INTO public\.meta_capi_outbox\s*\([^;]+\)\s*SELECT/i)
})

test('conserva fecha, mensaje, proyecto, contacto y atribuciÃ³n original', () => {
  for (const field of ['evaluation_id', 'temperature', 'recognized_events', 'evidence_labels', 'qualified_at', 'source_message_id', 'source_sent_at', 'tenant_id', 'project_id', 'contact_id', 'attribution_id', 'ctwa_clid', 'ad_source_id']) {
    assert.match(sql, new RegExp(`\\b${field}\\b`, 'i'))
  }
  assert.match(sql, /ORDER BY a\.captured_at ASC, a\.id ASC/i)
  assert.match(sql, /extract\(epoch FROM NEW\.evaluated_at\)/i)
})

test('etiqueta motivos registrados sin convertirlos en Schedule o Purchase', () => {
  assert.match(sql, /asked_financing'[\s\S]*'financiamiento'/i)
  assert.match(sql, /requested_visit'[\s\S]*'cita_solicitada'/i)
  assert.match(sql, /confirmed_visit'[\s\S]*'cita_confirmada'/i)
  assert.doesNotMatch(sql, /INSERT INTO public\.meta_capi_outbox/i)
  assert.doesNotMatch(sql, /'Schedule'|'Purchase'/i)
})

test('es idempotente, excluye internos y pruebas, y queda fuera del outbox', () => {
  assert.match(sql, /UNIQUE \(lead_id, signal_kind\)/i)
  assert.match(sql, /ON CONFLICT \(lead_id, signal_kind\) DO NOTHING/i)
  assert.match(sql, /internal_contact/i)
  assert.match(sql, /test_contact/i)
  assert.match(sql, /ads_consent_revoked/i)
  assert.match(sql, /backend_event_contract_pending/i)
  assert.doesNotMatch(sql, /INSERT INTO public\.meta_capi_outbox/i)
  assert.match(sql, /initial_lead_submitted_event_id, proposed_event_name,[\s\S]*meta_wa_lead_submitted_event_id, NULL,/i)
})
