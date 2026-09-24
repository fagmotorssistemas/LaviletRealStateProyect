import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  classifyDeliveryOutcome,
  classifyOutboxStatus,
  deliveryOutcomeMatchesFilter,
} from './metaCapiDeliveryOutcome'
import { computeCrmCostPerLead } from './adsMarketingClient'

describe('classifyDeliveryOutcome', () => {
  it('meta_accepted desde conversion_log con evidencia', () => {
    const r = classifyDeliveryOutcome({
      outboxStatus: 'forwarded',
      lastError: null,
      conversion: {
        stage: 'meta_accepted',
        reason: null,
        createdAt: '2026-09-22T15:08:36Z',
        fbtraceId: 'A79vzqiFABxvXuEfsMgWVEz',
        eventsReceived: 1,
        httpStatus: 200,
        datasetId: '123',
      },
      nest: null,
    })
    assert.equal(r.outcome, 'meta_accepted')
    assert.equal(r.graphEvidence?.source, 'conversion_log')
    assert.equal(r.graphEvidence?.eventsReceived, 1)
  })

  it('no marca aceptado sin evidencia Graph', () => {
    const r = classifyDeliveryOutcome({
      outboxStatus: 'forwarded',
      lastError: null,
      conversion: null,
      nest: null,
    })
    assert.equal(r.outcome, 'nest_received')
    assert.match(r.receptionLabel, /no implica aceptación Meta/i)
  })

  it('forwarded + not_configured = blocked', () => {
    const r = classifyDeliveryOutcome({
      outboxStatus: 'pending',
      lastError: 'not_configured',
      conversion: null,
      nest: null,
    })
    assert.equal(r.outcome, 'blocked')
    assert.equal(r.reason, 'not_configured')
  })

  it('meta_rejected conserva el estado final del backend', () => {
    const r = classifyDeliveryOutcome({
      outboxStatus: 'forwarded',
      lastError: null,
      conversion: {
        stage: 'meta_rejected',
        reason: 'graph_http_or_error',
        createdAt: '2026-09-22T15:08:36Z',
        fbtraceId: null,
        eventsReceived: 0,
        httpStatus: 400,
        datasetId: null,
      },
      nest: null,
    })
    assert.equal(r.outcome, 'meta_rejected')
  })

  it('filtro legacy delivered_backend coincide con nest_received', () => {
    assert.equal(
      deliveryOutcomeMatchesFilter('nest_received', 'delivered_backend'),
      true,
    )
    assert.equal(
      deliveryOutcomeMatchesFilter('meta_accepted', 'nest_received'),
      false,
    )
  })
})

describe('classifyOutboxStatus compat', () => {
  it('forwarded sin evidencia → delivered_backend (legacy)', () => {
    const c = classifyOutboxStatus('forwarded', null)
    assert.equal(c.bucket, 'delivered_backend')
  })

  it('pending + not_configured = blocked_config', () => {
    assert.equal(
      classifyOutboxStatus('pending', 'not_configured').bucket,
      'blocked_config',
    )
  })
})

describe('computeCrmCostPerLead', () => {
  it('CPL = spend / leadsUnique; sin denominador → null', () => {
    assert.equal(computeCrmCostPerLead(100, 4), 25)
    assert.equal(computeCrmCostPerLead(100, 0), null)
    assert.equal(computeCrmCostPerLead(null, 4), null)
  })
})
