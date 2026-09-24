import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CRM_CAPI_SIGNAL_MATRIX,
  distinctCommercialFacts,
  qualificationEvidenceLabels,
} from './crmCapiSignalMatrix'

test('la matriz confirma QualifiedLead y no convierte financiamiento en Schedule', () => {
  const qualification = CRM_CAPI_SIGNAL_MATRIX.find((row) => row.kind === 'crm_qualification')!
  assert.equal(qualification.metaEventName, 'QualifiedLead')
  assert.equal(qualification.enabled, false)
  assert.deepEqual(qualificationEvidenceLabels(['asked_financing']), ['financiamiento'])
  const schedule = CRM_CAPI_SIGNAL_MATRIX.find((row) => row.kind === 'appointment_confirmed')!
  assert.match(schedule.evidence, /confirmado.*confirmed_by_client/i)
})

test('evalúa los siete eventos por su hecho original sin filtrar navegación por temperatura', () => {
  assert.deepEqual(
    [...new Set(CRM_CAPI_SIGNAL_MATRIX.map((row) => row.metaEventName))].sort(),
    [
      'AddToWishlist',
      'Lead',
      'LeadSubmitted',
      'Purchase',
      'QualifiedLead',
      'Schedule',
      'ViewContent',
    ].sort(),
  )
  assert.equal(CRM_CAPI_SIGNAL_MATRIX.find((row) => row.kind === 'unit_viewed')?.enabled, true)
  assert.match(
    CRM_CAPI_SIGNAL_MATRIX.find((row) => row.kind === 'sale_closed')!.evidence,
    /cierre real/i,
  )
})

test('dos citas y un financiamiento seguido de cita conservan cuatro hechos sin duplicar reintentos', () => {
  const facts = [
    {
      kind: 'appointment_confirmed' as const,
      sourceId: 'appointment-a',
      leadId: 'lead-a',
      occurredAt: '2026-09-24T10:00:00Z',
    },
    {
      kind: 'appointment_confirmed' as const,
      sourceId: 'appointment-b',
      leadId: 'lead-b',
      occurredAt: '2026-09-24T10:05:00Z',
    },
    {
      kind: 'crm_qualification' as const,
      sourceId: 'evaluation-c',
      leadId: 'lead-c',
      occurredAt: '2026-09-24T10:10:00Z',
    },
    {
      kind: 'appointment_confirmed' as const,
      sourceId: 'appointment-c',
      leadId: 'lead-c',
      occurredAt: '2026-09-24T11:00:00Z',
    },
  ]
  const withRetries = [...facts, facts[0], facts[2], facts[3]]
  const unique = distinctCommercialFacts(withRetries)
  assert.equal(unique.length, 4)
  assert.deepEqual(
    unique.map((fact) => fact.kind),
    [
      'appointment_confirmed',
      'appointment_confirmed',
      'crm_qualification',
      'appointment_confirmed',
    ],
  )
})

test('Purchase mantiene identidad de venta y no representa clasificación', () => {
  const sale = CRM_CAPI_SIGNAL_MATRIX.find((row) => row.kind === 'sale_closed')!
  assert.equal(sale.metaEventName, 'Purchase')
  assert.equal(sale.idempotency, 'purchase:{sale_id}')
  assert.equal(sale.actionSource, 'system_generated')
})
