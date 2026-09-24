import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20260924213000_hot_lead_capi_signal_staging.sql', 'utf8')

test('la señal nace de evaluación persistida caliente y no recalcula temperatura', () => {
  assert.match(sql, /ON public\.lead_interest_evaluations/i)
  assert.match(sql, /NEW\.temperature = 'caliente'/i)
  assert.match(sql, /lead_temperature_history[\s\S]*to_temperature = 'caliente'[\s\S]*from_temperature IS DISTINCT FROM 'caliente'/i)
  assert.doesNotMatch(sql, /UPDATE public\.leads[\s\S]*temperature/i)
  assert.doesNotMatch(sql, /lead_scoring_rules|temperature_score/i)
})

test('conserva fecha, mensaje, proyecto, contacto y atribución original', () => {
  for (const field of ['evaluation_id', 'qualified_at', 'source_message_id', 'source_sent_at', 'tenant_id', 'project_id', 'contact_id', 'attribution_id', 'ctwa_clid', 'ad_source_id']) {
    assert.match(sql, new RegExp(`\\b${field}\\b`, 'i'))
  }
  assert.match(sql, /ORDER BY a\.captured_at ASC, a\.id ASC/i)
  assert.match(sql, /extract\(epoch FROM NEW\.evaluated_at\)/i)
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
