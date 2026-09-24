/**
 * Outcomes Nest sync: accepted / unverified / rejected.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { classifyDeliveryOutcome } from './metaCapiDeliveryOutcome'

describe('classifyDeliveryOutcome nest sync stages', () => {
  for (const [deliveryOutcome, expected] of [
    ['backend_accepted', 'backend_accepted'],
    ['transport_failed', 'transport_failed'],
    ['meta_rejected', 'meta_rejected'],
    ['meta_unverified', 'meta_unverified'],
    ['cancelled', 'cancelled'],
  ] as const) {
    it(`respeta delivery_outcome=${deliveryOutcome}`, () => {
      const result = classifyDeliveryOutcome({
        outboxStatus: 'forwarded', lastError: null, conversion: null,
        nest: {
          found: true, status: 'pending', attemptCount: 1, lastError: null,
          deliveryLane: 'test', datasetId: null, sentAt: null, apiAccepted: false,
          acceptanceTier: null, eventsReceived: null, fbtraceId: null,
          httpStatus: null, lookupOk: true, deliveryOutcome,
        },
      })
      assert.equal(result.outcome, expected)
      assert.equal(result.graphEvidence, null)
    })
  }
  it('distingue fallo de transporte de rechazo real de Meta', () => {
    const result = classifyDeliveryOutcome({
      outboxStatus: 'forwarded',
      lastError: null,
      conversion: {
        stage: 'transport_failed', reason: 'timeout', createdAt: '2026-09-24T00:00:00Z',
        fbtraceId: null, eventsReceived: null, httpStatus: null, datasetId: null,
      },
      nest: null,
    })
    assert.equal(result.outcome, 'transport_failed')
    assert.equal(result.label, 'Fallo de transporte')
    assert.match(result.receptionLabel, /no existe una respuesta comprobada de Meta/)
  })
  it('meta_accepted desde conversion_log', () => {
    const r = classifyDeliveryOutcome({
      outboxStatus: 'forwarded',
      lastError: null,
      conversion: {
        stage: 'meta_accepted',
        reason: null,
        createdAt: '2026-09-22T00:00:00Z',
        fbtraceId: 'fb',
        eventsReceived: 1,
        httpStatus: 200,
        datasetId: 'ds',
      },
      nest: null,
    })
    assert.equal(r.outcome, 'meta_accepted')
  })

  it('nest_lookup_unverified conserva nest_received', () => {
    const r = classifyDeliveryOutcome({
      outboxStatus: 'forwarded',
      lastError: null,
      conversion: {
        stage: 'nest_lookup_unverified',
        reason: 'insufficient_evidence',
        createdAt: '2026-09-22T00:00:00Z',
        fbtraceId: null,
        eventsReceived: null,
        httpStatus: null,
        datasetId: null,
      },
      nest: null,
    })
    assert.equal(r.outcome, 'nest_received')
    assert.match(r.receptionLabel, /no verificada/i)
  })

  it('AddToWishlist review_hold histórico no se trata como enviado', () => {
    const r = classifyDeliveryOutcome({
      outboxStatus: 'review_hold',
      lastError: 'nest_backend_pending',
      conversion: null,
      nest: null,
      eventName: 'AddToWishlist',
    })
    assert.equal(r.outcome, 'pending_backend_support')
  })

  it('not_configured + pending = blocked (prueba local)', () => {
    const r = classifyDeliveryOutcome({
      outboxStatus: 'pending',
      lastError: 'not_configured',
      conversion: null,
      nest: null,
      eventName: 'ViewContent',
    })
    assert.equal(r.outcome, 'blocked')
    assert.equal(r.reason, 'not_configured')
  })
})
