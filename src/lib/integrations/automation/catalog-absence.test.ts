import test from 'node:test'
import assert from 'node:assert/strict'
import { canRecoverAbsence, verifiedAbsenceReply } from './catalog-absence'
import { reviewDecision } from '@/components/inmobiliaria/automation/workflow/reviewDecision'

const audit = { source: 'catalog_search', verified_catalog: true,
  catalog_query: { scope: 'catalog', operation: 'search', group: 'residential', filters: { bedrooms: 5, bedrooms_required: true } },
  catalog_results: { complete: true, units: [], unknown_unit_ids: [] } }
const requests = [{ status: 'answered', fact_key: 'bedrooms' }]
const intent = { requests: [{ domain: 'property' }] }
test('complete empty search produces an exact answer with every filter, without model prose', () => {
  assert.equal(verifiedAbsenceReply(audit), 'Actualmente no contamos con viviendas disponibles de 5 dormitorios.')
  assert.equal(canRecoverAbsence(audit, requests, intent), true)
  const constrained = { ...audit, catalog_query: { ...audit.catalog_query, filters: { bedrooms: 5, floor_number: 2, min_area_m2: 120.83, max_area_m2: 142.09 } } }
  assert.match(verifiedAbsenceReply(constrained)!, /5 dormitorios y en la planta 2 y con al menos 120.83 m² interiores y con un máximo de 142.09 m² interiores/)
})
test('incomplete, unknown, excluded, positive or unsupported searches never authorize recovery', () => {
  for (const catalog_results of [{ ...audit.catalog_results, complete: false }, { ...audit.catalog_results, unknown_unit_ids: ['u1'] }, { ...audit.catalog_results, units: [{ id: 'u1' }] }])
    assert.equal(verifiedAbsenceReply({ ...audit, catalog_results }), null)
  assert.equal(verifiedAbsenceReply({ ...audit, catalog_excluded_categories: ['penthouse'] }), null)
  assert.equal(verifiedAbsenceReply({ ...audit, catalog_query: { ...audit.catalog_query, filters: { bedrooms: 5, price: 100000 } } }), null)
  assert.equal(canRecoverAbsence({ ...audit, profile_introduction: { stage: 'request' } }, requests, intent), false)
  assert.equal(canRecoverAbsence(audit, requests, { ...intent, requested_action: 'reserve' }), false)
  assert.equal(canRecoverAbsence(audit, requests, { ...intent, profile_pending: true }), false)
  assert.equal(canRecoverAbsence(audit, requests, { requests: [{ domain: 'property' }, { domain: 'policy' }] }), false)
  assert.equal(canRecoverAbsence(audit, [{ status: 'answered', fact_key: 'price' }], intent), false)
})
test('UI distinguishes a verified replacement from approval of the rejected AI draft', () => {
  const decision = reviewDecision({ status: 'recovered_catalog_result', recovery: { strategy: 'verified_empty_search' } })
  assert.match(decision.title, /Borrador descartado/)
  assert.match(decision.explanation, /No aprobó el borrador/)
  assert.equal(decision.recoveryPending, false)
})
