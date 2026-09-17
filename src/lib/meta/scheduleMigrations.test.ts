/**
 * Migraciones Schedule: secuencia conserva needs_review.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(process.cwd(), 'supabase', 'migrations')

describe('migraciones meta schedule status check', () => {
  it('17152000 review_hold incluye needs_review (no lo elimina)', () => {
    const sql = readFileSync(
      join(root, '20260917152000_meta_capi_outbox_review_hold.sql'),
      'utf8',
    )
    assert.match(sql, /needs_review/)
    assert.match(sql, /review_hold/)
    assert.match(
      sql,
      /CHECK \(status IN \(\s*'pending',\s*'forwarded',\s*'cancelled',\s*'dead',\s*'needs_review',\s*'review_hold'\s*\)\)/s,
    )
  })

  it('17160000 recover revalida canal y no asume website en vacío', () => {
    const sql = readFileSync(
      join(root, '20260917160000_meta_schedule_recovery.sql'),
      'utf8',
    )
    assert.match(sql, /lv_register_meta_schedule_intent/)
    assert.match(sql, /lv_recover_missing_meta_schedule_outbox/)
    assert.match(sql, /needs_review/)
    assert.match(sql, /channel_pending_evidence/)
    assert.match(sql, /whatsapp_schedule_delivery_blocked/)
    assert.doesNotMatch(
      sql,
      /IF v_payload = '\{\}'::jsonb THEN\s+v_payload := jsonb_build_object\(\s+'action_source', 'website'/s,
    )
  })
})
