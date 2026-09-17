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

  it('17170000 recover cierra hueco pre-intent con lookback y firma única', () => {
    const sql = readFileSync(
      join(root, '20260917170000_meta_schedule_recover_pre_intent.sql'),
      'utf8',
    )
    assert.match(sql, /recovered_pre_intent/)
    assert.match(sql, /p_lookback_days/)
    assert.match(sql, /lv_register_meta_schedule_intent/)
    assert.match(sql, /whatsapp_schedule_delivery_blocked/)
    assert.match(sql, /make_interval\(days/)
    assert.match(
      sql,
      /DROP FUNCTION IF EXISTS public\.lv_recover_missing_meta_schedule_outbox\(integer\)/,
    )
    assert.match(
      sql,
      /DROP FUNCTION IF EXISTS public\.lv_recover_missing_meta_schedule_outbox\(integer, integer\)/,
    )
    // Sin wrapper 1-arg: PostgREST no debe ver dos candidatos.
    assert.equal(
      (sql.match(
        /CREATE OR REPLACE FUNCTION public\.lv_recover_missing_meta_schedule_outbox\(/g,
      ) || []).length,
      1,
    )
  })
})
