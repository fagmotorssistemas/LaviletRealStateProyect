import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('waLeadSubmitted migrations + docs', () => {
  it('migración local incluye LeadSubmitted, evidencia y no website', () => {
    const sql = readFileSync(
      join(
        process.cwd(),
        'supabase/migrations/20260918120000_meta_wa_lead_submitted.sql',
      ),
      'utf8',
    )
    assert.match(sql, /LeadSubmitted/)
    assert.match(sql, /wa_lead_submitted:/)
    assert.match(sql, /lv_register_wa_lead_submitted_intent/)
    assert.match(sql, /meta_capi_conversion_log/)
    assert.match(sql, /meta_ads_consent_evidence_message/)
    assert.match(sql, /p_evidence_message/)
    assert.doesNotMatch(sql, /action_source',\s*'website/)
  })

  it('doc separa dataset mensajería de WABA y cita CTWA bloqueo', () => {
    const md = readFileSync(
      join(process.cwd(), 'docs/META_WA_LEAD_SUBMITTED.md'),
      'utf8',
    )
    assert.match(md, /LeadSubmitted/)
    assert.match(
      md,
      /developers\.facebook\.com\/docs\/marketing-api\/conversions-api\/business-messaging/,
    )
    assert.match(md, /ctwa_clid/)
    assert.match(md, /No reutilizar/)
    assert.match(md, /dataset ≠ WABA/)
    assert.match(md, /META_MESSAGING_DATASET_ID/)
    assert.match(md, /META_WABA_ID/)
    assert.match(md, /Marketing → CAPI/)
    assert.match(md, /bloqueo externo|CTWA/)
  })
})
