import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { computeCrmCostPerLead } from '@/lib/meta/adsMarketingClient'
import { rollupAttributedAdsByCampaign } from '@/lib/meta/adsCampaignRollup'
import { emptyTemp } from '@/services/marketingFunnel.logic'

describe('rollupAttributedAdsByCampaign', () => {
  it('no inventa campaña desde source_id / ad_id', () => {
    const out = rollupAttributedAdsByCampaign([
      {
        adId: '52625518901665',
        campaignId: null,
        campaignName: null,
        resolutionStatus: 'resolved',
        leadsUnique: 3,
        temperature: { ...emptyTemp(), tibio: 3 },
        adSpend: 90,
        currency: 'USD',
        metaReportedResults: 5,
        spendStale: false,
        spendFetchedAt: null,
        costPerLead: 30,
      },
    ])
    assert.equal(out.length, 0)
  })

  it('agrega leads y gasto con moneda única; CPL CRM', () => {
    const out = rollupAttributedAdsByCampaign([
      {
        adId: 'ad1',
        campaignId: 'camp1',
        campaignName: 'Camp A',
        resolutionStatus: 'resolved',
        leadsUnique: 2,
        temperature: { ...emptyTemp(), frio: 1, tibio: 1 },
        adSpend: 40,
        currency: 'USD',
        metaReportedResults: 3,
        spendStale: false,
        spendFetchedAt: '2026-09-22T12:00:00.000Z',
        costPerLead: 20,
      },
      {
        adId: 'ad2',
        campaignId: 'camp1',
        campaignName: 'Camp A',
        resolutionStatus: 'resolved',
        leadsUnique: 2,
        temperature: { ...emptyTemp(), caliente: 2 },
        adSpend: 60,
        currency: 'USD',
        metaReportedResults: 1,
        spendStale: false,
        spendFetchedAt: '2026-09-22T12:01:00.000Z',
        costPerLead: 30,
      },
    ])
    assert.equal(out.length, 1)
    assert.equal(out[0]?.campaignId, 'camp1')
    assert.equal(out[0]?.adCount, 2)
    assert.equal(out[0]?.leadsUnique, 4)
    assert.equal(out[0]?.adSpend, 100)
    assert.equal(out[0]?.adSpendSum, 100)
    assert.equal(out[0]?.campaignInsightsSpend, null)
    assert.equal(out[0]?.spendDelta, null)
    assert.equal(out[0]?.spendCoherent, null)
    assert.equal(out[0]?.spendComparisonPeriod, null)
    assert.equal(out[0]?.spendComparisonCurrency, null)
    assert.equal(out[0]?.currency, 'USD')
    assert.equal(out[0]?.costPerLead, computeCrmCostPerLead(100, 4))
    assert.equal(out[0]?.metaReportedResults, 4)
    assert.equal(out[0]?.temperature.frio, 1)
    assert.equal(out[0]?.temperature.tibio, 1)
    assert.equal(out[0]?.temperature.caliente, 2)
  })

  it('no suma monedas distintas → gasto y CPL No disponible (null)', () => {
    const out = rollupAttributedAdsByCampaign([
      {
        adId: 'ad1',
        campaignId: 'campX',
        campaignName: 'X',
        resolutionStatus: 'resolved',
        leadsUnique: 2,
        temperature: emptyTemp(),
        adSpend: 10,
        currency: 'USD',
        metaReportedResults: null,
        spendStale: false,
        spendFetchedAt: null,
        costPerLead: 5,
      },
      {
        adId: 'ad2',
        campaignId: 'campX',
        campaignName: 'X',
        resolutionStatus: 'resolved',
        leadsUnique: 2,
        temperature: emptyTemp(),
        adSpend: 20,
        currency: 'EUR',
        metaReportedResults: null,
        spendStale: false,
        spendFetchedAt: null,
        costPerLead: 10,
      },
    ])
    assert.equal(out[0]?.adSpend, null)
    assert.equal(out[0]?.costPerLead, null)
    assert.match(out[0]?.note || '', /Monedas distintas/)
  })

  it('omite missing_ads_token', () => {
    const out = rollupAttributedAdsByCampaign([
      {
        adId: 'ad1',
        campaignId: 'camp1',
        campaignName: 'A',
        resolutionStatus: 'missing_ads_token',
        leadsUnique: 5,
        temperature: emptyTemp(),
        adSpend: null,
        currency: null,
        metaReportedResults: null,
        spendStale: false,
        spendFetchedAt: null,
        costPerLead: null,
      },
    ])
    assert.equal(out.length, 0)
  })
})
