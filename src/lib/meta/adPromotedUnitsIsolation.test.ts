import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { isAdAccountMatch } from '@/lib/meta/adsMarketingClient'

describe('meta_ad_promoted_units isolation', () => {
  it('requires the configured Ads account', () => {
    assert.equal(isAdAccountMatch('act_123', '123'), true)
    assert.equal(isAdAccountMatch('123', 'act_123'), true)
    assert.equal(isAdAccountMatch('act_999', 'act_123'), false)
    assert.equal(isAdAccountMatch(null, 'act_123'), false)
  })

  it('keeps the promoted-unit table service_role-only', () => {
    const migration = readFileSync(
      'supabase/migrations/20260923150000_lockdown_meta_ad_promoted_units.sql',
      'utf8',
    )
    assert.match(migration, /REVOKE ALL ON TABLE public\.meta_ad_promoted_units FROM anon, authenticated/)
    assert.match(migration, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.meta_ad_promoted_units TO service_role/)
    assert.doesNotMatch(migration, /CREATE POLICY[\s\S]+meta_ad_promoted_units_/)
  })
})