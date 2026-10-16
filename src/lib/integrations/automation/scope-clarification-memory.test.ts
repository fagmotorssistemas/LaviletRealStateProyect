import assert from 'node:assert/strict'
import test from 'node:test'
import { commercialSelectionQuery } from './commercial-journey'
import { filterCatalog } from './catalog-dialogue'
import { object, type Row } from './data'
import { propertyContext, rememberPropertyReply, resolvePropertyTurn } from './property-context'

const catalog: Row[] = [
  { id: 'p605', unit_number: '605', category: 'penthouse', bedrooms: 3, floor_number: 6,
    area_internal_m2: 140.53, is_published: true, status: 'disponible' },
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6,
    area_internal_m2: 142.09, is_published: true, status: 'disponible' },
]

function chosen(): Row {
  return { version: 2, phase: 'review_unit', selected_ids: ['p605'], offered_ids: ['p602', 'p605'],
    comparison_ids: ['p602', 'p605'], focused_ids: ['p605'],
    category_preference: { category: 'penthouse', confirmed: true, evidence: 'Me quedo con los penthouses' },
    exploration_state: { version: 'property-exploration-v1', authorized: true,
      evidence: 'Si, quiero revisar las opciones de tres dormitorios', accepted_filters: { bedrooms: 3 } },
    query: { group: 'residential', category: 'penthouse', operation: 'details', scope: 'selected',
      filters: { bedrooms: 3 } },
    original_query: { group: 'residential', operation: 'search', filters: { bedrooms: 5 } },
    pending_question: { id: 'reservation_invitation', act: 'invite_reservation', target_ids: ['p605'] },
    information_query: { query: { category: 'suite', operation: 'details' } },
    proposal_information: { active: true },
  }
}

const info = (context: Row): Row => ({ property_context: context,
  lead: { preferred_bedrooms: 5 }, hechos_confirmados: {
    property: { group: 'residential', category: 'penthouse', filters: { bedrooms: 5 },
      evidence: 'Me gustaria tener unas cinco habitaciones', confidence: 'high' },
  } })

test('scope clarification preserves the chosen 605 and accepted three-bedroom alternative over the historical five', () => {
  const before = chosen(), original = structuredClone(before)
  const saved = rememberPropertyReply(catalog, before,
    'La solicitud del 605 sigue pendiente de que el equipo se comunique con usted.',
    { source: 'scope_clarification', pending_question: {} })
  assert.deepEqual(saved.selected_ids, ['p605'])
  assert.deepEqual(saved.exploration_state, original.exploration_state)
  assert.deepEqual(saved.category_preference, original.category_preference)
  assert.deepEqual(saved.original_query, original.original_query)
  assert.equal(saved.phase, 'review_unit')
  assert.equal(object(commercialSelectionQuery(info(saved)).filters).bedrooms, 3)
  assert.deepEqual(before, original, 'Persisting a reply must not mutate its input')
})

for (const source of ['scope_clarification', 'business_out_of_scope', 'vehicle_out_of_scope']) {
  test(`${source} suspends transient references without starting another search or recording consent`, () => {
    const saved = rememberPropertyReply(catalog, chosen(), 'Permita que aclaremos su consulta.', {
      source, offered_unit_ids: ['p602'], selected_unit_ids: ['p602'],
      catalog_query: { operation: 'search', filters: { bedrooms: 5 } },
    })
    assert.deepEqual(saved.selected_ids, ['p605'], 'An unrelated reply cannot choose another home')
    assert.deepEqual(saved.offered_ids, [])
    assert.deepEqual(saved.comparison_ids, [])
    assert.deepEqual(saved.focused_ids, [])
    assert.deepEqual(saved.pending_question, {})
    assert.deepEqual(saved.reference_resolution, {})
    assert.equal(object(saved.query).operation, 'none')
    assert.equal(saved.information_query, undefined)
    assert.equal(saved.proposal_information, undefined)
    const hydrated = propertyContext(catalog, saved, [{ role: 'bot', content: saved.last_reply }])
    assert.deepEqual(hydrated.selected_ids, ['p605'])
    const current = 'Aun nadie se ha comunicado conmigo por la reserva'
    const resumed = resolvePropertyTurn(catalog, current, { _property_context: hydrated }, [], {
      primary_intent: 'answer_previous', primary_evidence: current, confidence: 'high',
      property: { operation: 'none', reference_kind: 'none', confidence: 'high', evidence: current, filters: {} },
    })
    assert.deepEqual(resumed.context.selected_ids, ['p605'])
    assert.deepEqual(resumed.matches.map(unit => unit.id), ['p605'])
    assert.equal(resumed.needsClarification, false)
    assert.equal(resumed.query.operation, 'none')
    assert.equal(object(commercialSelectionQuery(info(resumed.context)).filters).bedrooms, 3)
  })
}

test('an accepted alternative without a chosen unit survives an unrelated question without selecting anything', () => {
  const before = chosen()
  before.selected_ids = []
  before.phase = 'choose_category'
  before.query = { group: 'residential', operation: 'search', scope: 'catalog', filters: {} }
  const saved = rememberPropertyReply(catalog, before, 'Esa consulta corresponde a otro tema.', { source: 'business_out_of_scope' })
  assert.deepEqual(saved.selected_ids, [])
  assert.equal(object(commercialSelectionQuery(info(saved)).filters).bedrooms, 3,
    'Accepted exploration remains authoritative even when its query omitted the optional legacy filter')
  assert.equal(object(saved.query).operation, 'none')
})

test('an explicit client rejection remains effective after clarification; preserving context cannot resurrect a unit', () => {
  const rejected = resolvePropertyTurn(catalog, 'No quiero el penthouse 605', { _property_context: chosen() }, [], {})
  assert.equal(rejected.reason, 'unit_rejected')
  assert.deepEqual(rejected.context.selected_ids, [])
  const saved = rememberPropertyReply(catalog, rejected.context, 'Entendido.', { source: 'scope_clarification' })
  assert.deepEqual(saved.selected_ids, [])
  assert.deepEqual(saved.offered_ids, [])
})

test('a replacement selected by the client remains the current choice after an unrelated reply', () => {
  const current = 'Quiero el penthouse 602'
  const replaced = resolvePropertyTurn(catalog, current, { _property_context: chosen() }, [], {
    primary_intent: 'select_property', primary_evidence: current, confidence: 'high',
    property: { category: 'penthouse', operation: 'select', reference_kind: 'explicit',
      unit_numbers: ['602'], evidence: current, confidence: 'high', filters: {} },
  })
  assert.deepEqual(replaced.context.selected_ids, ['p602'])
  const saved = rememberPropertyReply(catalog, replaced.context, 'Aclararemos ese otro punto.', { source: 'scope_clarification' })
  assert.deepEqual(saved.selected_ids, ['p602'])
})

test('an affirmative after an unrelated reply cannot accept an old proposal that was never accepted', () => {
  const before = chosen()
  before.selected_ids = []
  delete before.exploration_state
  before.query = { group: 'residential', operation: 'search', scope: 'catalog', filters: { bedrooms: 5 } }
  before.pending_question = { id: 'property_requirements', act: 'explore_alternatives',
    candidate_ids: ['p602', 'p605'], proposed_query: { group: 'residential', operation: 'search', filters: { bedrooms: 3 } } }
  const saved = rememberPropertyReply(catalog, before, 'Primero, aclaremos su consulta.', { source: 'business_out_of_scope' })
  const resumed = resolvePropertyTurn(catalog, 'si', { _property_context: saved }, [], {})
  assert.deepEqual(resumed.context.selected_ids, [])
  assert.equal(resumed.context.exploration_state, undefined)
  assert.equal(object(resumed.query.filters).bedrooms, 5, 'Old proposal is not turned into a new accepted requirement')
})

test('missing availability is revalidated on return without losing or replacing the original decision', () => {
  const saved = rememberPropertyReply([], chosen(), 'Aclararemos ese punto.', { source: 'scope_clarification' })
  const current = 'Quisiera continuar con la reserva'
  const resumed = resolvePropertyTurn(catalog.filter(unit => unit.id !== 'p605'), current,
    { _property_context: saved }, [], { primary_intent: 'request_reservation', confidence: 'high',
      primary_evidence: current, property: { operation: 'none', reference_kind: 'none',
        confidence: 'high', evidence: current, filters: {} } })
  assert.deepEqual(resumed.context.selected_ids, ['p605'])
  assert.deepEqual(resumed.matches, [])
  assert.equal(resumed.needsClarification, true)
})

test('price and detail queries for a rehydrated 605 do not recover the five-bedroom requirement from before its choice', () => {
  for (const operation of ['none', 'details']) {
    const restored = chosen()
    delete restored.exploration_state
    restored.query = { group: 'residential', category: 'penthouse', scope: 'selected', operation, filters: {} }
    const planned = commercialSelectionQuery(info(restored))
    assert.equal(planned.filters.bedrooms, null)
    assert.deepEqual(filterCatalog(catalog, planned, ['p605']).map(unit => unit.id), ['p605'])
    assert.deepEqual(restored.selected_ids, ['p605'])
  }
})

test('chosen-unit scope still enforces explicit current restrictions and a genuine new search keeps its own defaults', () => {
  const constrained = chosen()
  constrained.query = { group: 'residential', category: 'penthouse', scope: 'selected', operation: 'details',
    filters: { bedrooms: 4 } }
  const explicit = commercialSelectionQuery(info(constrained))
  assert.equal(explicit.filters.bedrooms, 4)
  assert.deepEqual(filterCatalog(catalog, explicit, ['p605']), [], 'Choosing a unit does not waive an explicit current condition')
  constrained.query = { group: 'residential', category: 'penthouse', scope: 'selected', operation: 'details',
    filters: {}, requirements: [{ field: 'bedrooms', operator: 'eq', value: 4, strength: 'required', evidence: 'Necesito cuatro dormitorios' }] }
  assert.deepEqual(filterCatalog(catalog, commercialSelectionQuery(info(constrained)), ['p605']), [])

  const search = chosen()
  for (const scope of ['catalog', 'selected']) {
    search.query = { group: 'residential', category: 'penthouse', scope, operation: 'search', filters: {} }
    assert.equal(commercialSelectionQuery(info(search)).filters.bedrooms, 3, 'A new search uses the accepted alternative when no new condition is supplied')
  }
  search.selected_ids = []
  delete search.exploration_state
  assert.equal(commercialSelectionQuery(info(search)).filters.bedrooms, 5, 'Without a choice or accepted alternative, the known requirement remains available')
})
