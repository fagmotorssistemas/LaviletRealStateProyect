import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { resolveEffectiveAdsConsent } from './effectiveAdsConsent'

describe('resolveEffectiveAdsConsent', () => {
  it('contacto no aplica: sin cookie de ads no emite', () => {
    assert.equal(
      resolveEffectiveAdsConsent({ cookieAllowsAds: false, ledgerAdsConsent: null }),
      false,
    )
    assert.equal(
      resolveEffectiveAdsConsent({ cookieAllowsAds: false, ledgerAdsConsent: true }),
      false,
    )
  })

  it('cookie full sin ledger permite ads', () => {
    assert.equal(
      resolveEffectiveAdsConsent({ cookieAllowsAds: true, ledgerAdsConsent: null }),
      true,
    )
  })

  it('revocación vigente en ledger anula cookie full stale', () => {
    assert.equal(
      resolveEffectiveAdsConsent({ cookieAllowsAds: true, ledgerAdsConsent: false }),
      false,
    )
  })

  it('cookie full + ledger true permite ads', () => {
    assert.equal(
      resolveEffectiveAdsConsent({ cookieAllowsAds: true, ledgerAdsConsent: true }),
      true,
    )
  })
})
