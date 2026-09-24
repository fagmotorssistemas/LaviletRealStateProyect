import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeOptimizationVolume } from './optimizationVolume'

test('separa capturados, aceptados y atribuidos sin mezclar eventos', () => {
  const rows = [
    {
      eventType: 'crm_qualification',
      eventId: 'q1',
      capturedAt: '2026-09-24T10:00:00Z',
      metaAccepted: true,
      metaAttributionVerified: true,
      metaAttributed: true,
      verifiedAdSetId: 'adset-1',
      deliveryEvidenceComplete: true,
    },
    {
      eventType: 'crm_qualification',
      eventId: 'q2',
      capturedAt: '2026-09-24T11:00:00Z',
      metaAccepted: false,
      metaAttributionVerified: false,
      metaAttributed: false,
      verifiedAdSetId: null,
      deliveryEvidenceComplete: false,
    },
    {
      eventType: 'Schedule',
      eventId: 's1',
      capturedAt: '2026-09-24T12:00:00Z',
      metaAccepted: true,
      metaAttributionVerified: true,
      metaAttributed: false,
      verifiedAdSetId: 'adset-1',
      deliveryEvidenceComplete: true,
    },
    {
      eventType: 'Schedule',
      eventId: 's1',
      capturedAt: '2026-09-24T12:00:00Z',
      metaAccepted: true,
      metaAttributionVerified: true,
      metaAttributed: false,
      verifiedAdSetId: 'adset-1',
      deliveryEvidenceComplete: true,
    },
  ]
  const result = summarizeOptimizationVolume(rows, '2026-09-24T13:00:00Z')
  assert.deepEqual(
    result.map((row) => row.eventType),
    ['crm_qualification', 'Schedule'],
  )
  assert.deepEqual(result[0], {
    eventType: 'crm_qualification',
    captured: 2,
    metaAccepted: 1,
    metaAttributed: 1,
    channel: 'unknown',
    dataset: 'unknown',
    deliveryLane: 'unknown',
    eligibleDetected: 2,
    retained: 0,
    pending: 0,
    backendAccepted: 0,
    metaRejected: 0,
    transportFailed: 0,
    exclusionReasons: {},
    capturedGap: 48,
    acceptedGap: 49,
    attributedGap: 49,
    incompleteDeliveryEvidence: 1,
    incompleteAttributionCoverage: 1,
    byVerifiedAdSet: [{ adSetId: 'adset-1', captured: 1, metaAccepted: 1, metaAttributed: 1 }],
  })
  assert.equal(result[1].captured, 1)
  assert.equal(result[1].metaAttributed, 0)
})

test('no limita la entrega a 50 y separa canal, dataset, carril y causas', () => {
  const rows = Array.from({ length: 55 }, (_, index) => ({
    eventType: 'QualifiedLead',
    eventId: `q-${index}`,
    capturedAt: '2026-09-24T12:00:00Z',
    metaAccepted: index < 52,
    metaAttributionVerified: false,
    metaAttributed: false,
    verifiedAdSetId: null,
    deliveryEvidenceComplete: true,
    channel: 'whatsapp',
    dataset: 'messaging-1',
    deliveryLane: 'live' as const,
    status: index === 54 ? 'held' : 'forwarded',
    deliveryOutcome:
      index === 53 ? 'meta_rejected' : index === 54 ? 'transport_failed' : 'meta_accepted',
    eligible: true,
    exclusionReasons: index === 54 ? ['identity_missing'] : [],
  }))
  const result = summarizeOptimizationVolume(rows, '2026-09-24T13:00:00Z')[0]
  assert.equal(result.captured, 55)
  assert.equal(result.metaAccepted, 52)
  assert.equal(result.acceptedGap, 0)
  assert.equal(result.metaRejected, 1)
  assert.equal(result.transportFailed, 1)
  assert.equal(result.retained, 1)
  assert.deepEqual(result.exclusionReasons, { identity_missing: 1 })
})

test('excluye filas fuera de siete días y mantiene brecha por cada evento', () => {
  const result = summarizeOptimizationVolume(
    [
      {
        eventType: 'Purchase',
        eventId: 'old',
        capturedAt: '2026-09-10T00:00:00Z',
        metaAccepted: true,
        metaAttributionVerified: true,
        metaAttributed: true,
        verifiedAdSetId: 'a',
        deliveryEvidenceComplete: true,
      },
      {
        eventType: 'Purchase',
        eventId: 'new',
        capturedAt: '2026-09-24T00:00:00Z',
        metaAccepted: false,
        metaAttributionVerified: false,
        metaAttributed: false,
        verifiedAdSetId: null,
        deliveryEvidenceComplete: true,
      },
    ],
    '2026-09-24T13:00:00Z',
  )
  assert.equal(result[0].captured, 1)
  assert.equal(result[0].capturedGap, 49)
  assert.equal(result[0].acceptedGap, 50)
})
