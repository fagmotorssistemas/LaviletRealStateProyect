/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
require('./test-typescript.cjs')
const { normalizeTurnSemantics, pendingQuestionFromReply } = require('../src/lib/integrations/automation/turn-semantics.ts')
const { resolvePropertyTurn, rememberPropertyReply, unitsInPropertyReply } = require('../src/lib/integrations/automation/property-context.ts')
const { unitPriceQuote } = require('../src/lib/integrations/automation/price-reply.ts')
const { continueUnitAlternative } = require('../src/lib/integrations/automation/unit-alternatives.ts')
const { preferredPropertyCategory, propertySelectionReply } = require('../src/lib/integrations/automation/property-selection.ts')
const { responsePlan } = require('../src/lib/integrations/automation/response-plan.ts')
const { catalogDialogueReply } = require('../src/lib/integrations/automation/catalog-dialogue.ts')

const catalog = [
  { id:'u202',unit_number:'202',category:'departamento',floor:'Segunda planta alta',floor_number:2,bedrooms:3,area_internal_m2:120.83,published_commercial_price:250000 },
  { id:'u302',unit_number:'302',category:'departamento',floor:'Tercera planta alta',floor_number:3,bedrooms:3,area_internal_m2:120.83,published_commercial_price:270000 },
  { id:'u602',unit_number:'602',category:'penthouse',floor:'Sexta planta alta',floor_number:6,bedrooms:3,area_internal_m2:142.09,published_commercial_price:550000 },
  { id:'u605',unit_number:'605',category:'penthouse',floor:'Sexta planta alta',floor_number:6,bedrooms:3,area_internal_m2:140.53,published_commercial_price:540000 },
]
const apartments = [{role:'bot',content:'El departamento 202 está en la segunda planta y el 302 en la tercera. Ambos tienen 3 dormitorios.'}]

test('typed household and suitability quantities survive every downstream lexical parser without changing known bedroom preferences', () => {
  const saved = { offered_ids: ['u602', 'u605'], selected_ids: [], query: { category: 'penthouse', filters: { bedrooms: 3 }, scope: 'offered' } }
  const current = '¿Me alcanzarán 3 dormitorios para una familia de 6?'
  const interpreted = normalizeTurnSemantics({ turn_semantics: {
    primary_intent: 'select_property', primary_evidence: current, confidence: 'high',
    housing_quantities: [
      { dimension: 'bedrooms', values: [3], role: 'evaluation', count_basis: 'total', evidence: '3 dormitorios', confidence: 'high' },
      { dimension: 'people', values: [6], role: 'context', count_basis: 'total', evidence: 'familia de 6', confidence: 'high' },
    ],
    property: { operation: 'details', category: 'penthouse', reference_kind: 'followup', query_scope: 'offered',
      filters: { bedrooms: 3 }, filter_evidence: { bedrooms: '3 dormitorios' }, evidence: current, confidence: 'high' },
  } }, current, {})
  const result = resolvePropertyTurn(catalog, current, { _property_context: saved }, [], interpreted)
  assert.equal(result.query.filters.bedrooms, 3)
  assert.equal(result.context.filter_resolution.current.bedrooms, null)
  assert.equal(result.query.operation, 'details')
  assert.deepEqual(result.matches.map(unit => unit.id), ['u602', 'u605'])

  const priceCurrent = '¿Cuánto cuestan los que vimos? ¿Alcanzarían 2 dormitorios para seis personas?'
  const quoteSemantics = { ...interpreted, housing_quantities: [
    { dimension: 'bedrooms', values: [2], role: 'evaluation', count_basis: 'total', evidence: '2 dormitorios', confidence: 'high' },
  ], property: { ...interpreted.property, filters: { bedrooms: null } } }
  // Without a resolved query, the independent price parser must still preserve
  // typed evaluation rather than manufacture a different current constraint.
  const quote = unitPriceQuote({ catalogo: catalog, semantica_turno: quoteSemantics, politica_comercial: { precios_autorizados: true },
    property_context: { ...saved, query: { category: 'penthouse', filters: { bedrooms: 3 }, scope: 'offered' } } }, priceCurrent, {})
  assert.ok(quote)
  assert.deepEqual(quote.units.map(unit => unit.id), ['u602', 'u605'])
})

test('contextual comparisons resolve arbitrary offered units even when the extractor repeats their attributes', () => {
  for (const [category, numbers, bedrooms, floor] of [
    ['penthouse', ['602', '605'], 3, 6], ['departamento', ['801', '803'], 2, 8], ['suite', ['901', '903'], 1, 9], ['local', ['LC-11', 'LC-12'], 0, 0],
  ]) for (const current of ['pero y cual es la diferencia entre estos dos?', '¿Qué cambia de una opción a la otra?', 'Compáreme las alternativas que vimos']) {
    const units = numbers.map((number, i) => ({ id: `id-${number}`, unit_number: number, category, bedrooms, floor_number: floor, area_internal_m2: 80 + i }))
    const saved = { offered_ids: units.map(unit => unit.id), comparison_ids: [], query: { category, filters: { bedrooms } },
      pending_question: { id: 'unit_choice', act: 'explore_quoted_options', candidate_ids: units.map(unit => unit.id), target_ids: [] } }
    const result = resolvePropertyTurn(units, current, { _property_context: saved }, [], semantics(current,
      { category, operation: 'compare', reference_kind: 'comparison', query_scope: 'comparison', unit_numbers: numbers, filters: { bedrooms, floor_number: floor, bedrooms_required: false } }))
    assert.equal(result.reason, 'comparison_followup', current)
    assert.deepEqual(result.context.comparison_ids, units.map(unit => unit.id))
    assert.equal(result.query.filters.bedrooms, bedrooms)
    assert.equal(result.context.filter_resolution.current.bedrooms, null)
    assert.equal(result.query.filters.floor_number, null)
    assert.equal(result.context.filter_resolution.inherited.floor_number, floor)
    assert.equal(result.context.reference_resolution.source, 'pending_question')
    const reply = catalogDialogueReply({ catalogo: units, referencia_unidad: result, property_context: result.context })
    assert.equal(reply.audit.catalog_coverage.status, 'answered')
    assert.equal(reply.audit.alternative_presentation, undefined)
    assert.doesNotMatch(reply.reply, /no contamos|alternativas disponibles/i)
    assert.match(reply.reply, /¿/)
  }
})

test('new current constraints refine a comparison without expanding or silently dropping missing referents', () => {
  const units = [...catalog, { ...catalog[0], id: 'u402', unit_number: '402', floor_number: 4 }]
  const saved = { offered_ids: ['u202', 'u302', 'u402'], query: { category: 'departamento', filters: { bedrooms: 3 } } }
  const current = 'compare los de la planta 3'
  const result = resolvePropertyTurn(units, current, { _property_context: saved }, [], semantics(current,
    { category: 'departamento', operation: 'compare', reference_kind: 'comparison', query_scope: 'offered', filters: { floor_number: 3 } }))
  assert.equal(result.query.filters.floor_number, 3)
  assert.deepEqual(result.matches.map(unit => unit.id), ['u302'])
  assert.equal(result.needsClarification, true)
  for (const offered of [[], ['u202', 'deleted-unit'], ['u202']]) {
    const unresolved = resolvePropertyTurn(units, 'compare esas opciones', { _property_context: { offered_ids: offered } }, [],
      semantics('compare esas opciones', { operation: 'compare', reference_kind: 'comparison', query_scope: 'comparison' }))
    assert.equal(unresolved.needsClarification, true)
    const response = catalogDialogueReply({ catalogo: units, referencia_unidad: unresolved, property_context: unresolved.context })
    assert.equal(response.audit.catalog_coverage.status, 'clarification')
    assert.doesNotMatch(response.reply, /no contamos|disponibles|no hay/i)
  }
})

test('contextual details and rankings preserve subjects without treating inherited attributes as new searches', () => {
  const saved = { selected_ids: ['u605'], offered_ids: ['u602', 'u605'], query: { category: 'penthouse', filters: { bedrooms: 3 } } }
  const details = resolvePropertyTurn(catalog, 'cuénteme más de esa opción', { _property_context: saved }, [],
    semantics('cuénteme más de esa opción', { operation: 'details', category: 'penthouse', reference_kind: 'followup', query_scope: 'selected', filters: { bedrooms: 3, floor_number: 6 } }))
  assert.deepEqual(details.matches.map(unit => unit.id), ['u605'])
  assert.equal(details.query.operation, 'details')
  const ranked = resolvePropertyTurn(catalog, 'cuál es el más amplio de estos?', { _property_context: saved }, [],
    semantics('cuál es el más amplio de estos?', { operation: 'rank', selector: 'largest', reference_kind: 'relative', query_scope: 'offered', filters: { bedrooms: 3, floor_number: 6 } }))
  const answer = catalogDialogueReply({ catalogo: catalog, referencia_unidad: ranked, property_context: ranked.context })
  assert.deepEqual(answer.audit.catalog_ranking.unit_ids, ['u602'])
  assert.deepEqual(ranked.context.selected_ids, ['u605'])
})

test('new searches do not inherit a previous reference failure and semantic refinements override old bedroom sets', () => {
  const current = 'compare solo los de dos habitaciones'
  const saved = { offered_ids: ['u202', 'u302', 'a304', 'a404'], query: { group: 'residential', filters: { bedrooms_any: [2, 3] } } }
  const ref = resolvePropertyTurn(alternativeCatalog, current, { _property_context: saved }, [], semantics(current,
    { operation: 'compare', reference_kind: 'comparison', query_scope: 'offered', filters: { bedrooms: 2 }, filter_evidence: { bedrooms: 'dos habitaciones' } }))
  assert.deepEqual(ref.matches.map(unit => unit.id), ['a304', 'a404'])
  assert.equal(ref.query.filters.bedrooms, 2)
  const search = resolvePropertyTurn(catalog, 'departamentos de 8 dormitorios', { _property_context: { reference_resolution: { status: 'clarification' } } }, [],
    semantics('departamentos de 8 dormitorios', { category: 'departamento', operation: 'search', query_scope: 'catalog', filters: { bedrooms: 8 } }))
  assert.equal(search.context.reference_resolution.status, undefined)
  const response = catalogDialogueReply({ catalogo: catalog, referencia_unidad: search, property_context: search.context })
  assert.equal(response.audit.catalog_coverage.status, 'no_results')
  assert.match(response.reply, /no contamos/)
})
const penthouses = [{role:'bot',content:'Estas son las opciones: el penthouse 602 (142,09 m²); el penthouse 605 (140,53 m²). ¿Cuál de estas opciones le gustaría conocer?'}]

const alternativeCatalog = [...catalog,
  { id: 'p601', unit_number: '601', category: 'penthouse', bedrooms: 2, floor_number: 6 },
  { id: 'a304', unit_number: '304', category: 'departamento', bedrooms: 2, floor_number: 3 },
  { id: 'a404', unit_number: '404', category: 'departamento', bedrooms: 2, floor_number: 4 },
  { id: 's301', unit_number: '301', category: 'suite', bedrooms: 1, floor_number: 3 },
  { id: 'retired', unit_number: '101', category: 'suite', bedrooms: 1, status: 'vendido' },
]

test('fewer bedrooms releases the prior requirement across residential categories without choosing a replacement', () => {
  const saved = { selected_ids: ['u605'], offered_ids: ['u602', 'u605'], query: { group: 'residential', category: 'penthouse', filters: { bedrooms: 3, bedrooms_required: true } } }
  const current = 'mejor quiero algo con menos cuartos'
  const result = resolvePropertyTurn(alternativeCatalog, current, { _property_context: saved }, [], semantics(current, { category: 'penthouse', operation: 'search', filters: { bedrooms: 3 } }))
  assert.equal(result.reason, 'requested_fewer_bedrooms')
  assert.equal(result.query.category, null)
  assert.deepEqual(result.query.filters.bedrooms_any.sort(), [1, 2])
  assert.deepEqual(result.matches.map(unit => unit.id), ['p601', 'a304', 'a404', 's301'])
  assert.deepEqual(result.context.selected_ids, ['u605'])
  assert.equal(result.context.query_transition.before.filters.bedrooms, 3)
  assert.equal(result.context.query_transition.after.filters.bedrooms_required, null)
})

test('fewer bedroom interpretation works for other prior counts and exact requests exclude one bedroom suites', () => {
  const saved = { selected_ids: ['u605'], query: { group: 'residential', category: 'penthouse' } }
  const current = 'quiero algo de 2 cuartos'
  const exact = resolvePropertyTurn(alternativeCatalog, current, { _property_context: saved }, [], semantics(current, { operation: 'search', filters: { bedrooms: 2 } }))
  assert.equal(exact.query.filters.bedrooms, 2)
  assert.ok(exact.matches.length > 0 && exact.matches.every(unit => unit.bedrooms === 2))
  const fewer = resolvePropertyTurn(alternativeCatalog, 'prefiero menos dormitorios', { _property_context: { query: { group: 'residential', filters: { bedrooms: 4 } } } }, [], {})
  assert.ok(fewer.matches.some(unit => unit.bedrooms === 3))
  const unknown = resolvePropertyTurn(alternativeCatalog, 'prefiero menos dormitorios', { _property_context: { query: { group: 'residential' } } }, [], {})
  assert.equal(unknown.reason, 'fewer_requires_bedroom_count')
  assert.equal(unknown.needsClarification, true)
})

test('a simultaneous lower price and fewer bedroom request retains both constraints', () => {
  const saved = { selected_ids: ['u605'], query: { group: 'residential', category: 'penthouse', filters: { bedrooms: 3 } } }
  for (const current of ['algo más económico de 2 cuartos', 'más barato con menos dormitorios']) {
    const result = resolvePropertyTurn(alternativeCatalog, current, { _property_context: saved }, [], semantics(current, { operation: 'search', filters: { bedrooms: 2 } }))
    assert.equal(result.reason, 'requested_cheaper_options', current)
    assert.equal(result.context.preference_transition.kind, 'cheaper', current)
    assert.equal(result.context.preference_transition.fewer_bedrooms, true, current)
    assert.equal(result.needsClarification, false, current)
    assert.deepEqual(result.context.preference_transition.source_selected_ids, ['u605'], current)
    assert.ok(result.matches.length > 0 && result.matches.every(unit => unit.bedrooms < 3), current)
    if (current.includes('2 cuartos')) {
      assert.equal(result.query.filters.bedrooms, 2)
      assert.ok(result.matches.every(unit => unit.bedrooms === 2))
    } else assert.deepEqual(result.query.filters.bedrooms_any.sort(), [1, 2])
  }
  const unknown = resolvePropertyTurn(alternativeCatalog, 'más barato con menos dormitorios', { _property_context: { query: { group: 'residential' } } }, [], {})
  assert.equal(unknown.reason, 'cheaper_requires_bedroom_count')
  assert.equal(unknown.needsClarification, true)
  assert.deepEqual(unknown.matches, [])
})

test('cheaper without a new bedroom count asks to preserve it and yes applies only the verified proposed candidates', () => {
  const previous = { selected_ids: ['u605'], offered_ids: ['u602', 'u605'], query: { group: 'residential', category: 'penthouse', filters: { bedrooms: 3 } } }
  const current = 'tiene algo más económico?'
  const asked = resolvePropertyTurn(alternativeCatalog, current, { _property_context: previous }, [], semantics(current, { operation: 'search' }))
  assert.equal(asked.reason, 'cheaper_requires_bedrooms_confirmation')
  assert.equal(asked.query.filters.bedrooms, 3)
  assert.deepEqual(asked.context.selected_ids, ['u605'])
  const pending = { id: 'property_bedrooms', act: 'confirm_bedrooms', question: asked.clarification,
    candidate_ids: ['u202', 'u302'], proposed_query: { group: 'residential', category: null, filters: { bedrooms: 3 }, scope: 'offered' } }
  const state = rememberPropertyReply(alternativeCatalog, asked.context, asked.clarification, { pending_question: pending })
  const accepted = resolvePropertyTurn(alternativeCatalog, 'sí', { _property_context: state }, [], {})
  assert.equal(accepted.reason, 'accepted_bedroom_confirmation')
  assert.equal(accepted.context.query_transition.reason, 'accepted_bedroom_confirmation')
  assert.deepEqual(accepted.matches.map(unit => unit.id), ['u202', 'u302'])
  assert.equal(accepted.query.filters.bedrooms, 3)
  assert.deepEqual(accepted.context.selected_ids, ['u605'])
  const explicitCount = resolvePropertyTurn(alternativeCatalog, 'sí, de 3 dormitorios', { _property_context: state }, [], {})
  assert.deepEqual(explicitCount.matches.map(unit => unit.id), ['u202', 'u302'])
  const denied = resolvePropertyTurn(alternativeCatalog, 'no', { _property_context: state }, [], {})
  assert.equal(denied.reason, 'bedroom_confirmation_declined')
  assert.equal(denied.query.filters.bedrooms, 3)
  assert.deepEqual(denied.matches, [])
  const countQuestion = '¿Cuántos dormitorios le gustaría que tenga la vivienda?'
  const awaitingCount = rememberPropertyReply(alternativeCatalog, denied.context, countQuestion, {
    pending_question: { id: 'property_bedrooms', act: 'other', question: countQuestion } })
  const newCount = resolvePropertyTurn(alternativeCatalog, '2 dormitorios', { _property_context: awaitingCount }, [], {})
  assert.equal(newCount.reason, 'requested_cheaper_options')
  assert.equal(newCount.context.preference_transition.kind, 'cheaper')
  assert.equal(newCount.query.filters.bedrooms, 2)
  assert.deepEqual(newCount.context.preference_transition.source_selected_ids, ['u605'])
  assert.ok(newCount.matches.length > 0 && newCount.matches.every(unit => unit.bedrooms === 2))
})

test('category then floor refine the offered alternative set and selecting one replaces the prior unit', () => {
  const current = 'quiero menos cuartos'
  const first = resolvePropertyTurn(alternativeCatalog, current, { _property_context: { selected_ids: ['u605'], query: { category: 'penthouse', group: 'residential' } } }, [], {})
  let state = rememberPropertyReply(alternativeCatalog, first.context, 'Tenemos otras categorías. ¿Con cuál desea continuar?', {
    offered_unit_ids: first.matches.map(unit => unit.id), catalog_query: { ...first.query, scope: 'offered' },
    pending_question: { id: 'property_category', act: 'choose_category', candidate_ids: first.matches.map(unit => unit.id) } })
  const apartments = resolvePropertyTurn(alternativeCatalog, 'los departamentos', { _property_context: state }, [], semantics('los departamentos', { category: 'departamento', operation: 'search' }))
  assert.deepEqual(apartments.matches.map(unit => unit.id), ['a304', 'a404'])
  assert.deepEqual(apartments.context.selected_ids, ['u605'])
  state = rememberPropertyReply(alternativeCatalog, apartments.context, '¿Qué planta prefiere?', {
    offered_unit_ids: ['a304', 'a404'], catalog_query: apartments.query,
    pending_question: { id: 'property_floor', act: 'choose_floor', candidate_ids: ['a304', 'a404'] } })
  const floor = resolvePropertyTurn(alternativeCatalog, 'la tercera', { _property_context: state }, [], {})
  assert.deepEqual(floor.matches.map(unit => unit.id), ['a304'])
  assert.deepEqual(floor.context.selected_ids, ['u605'])
  state = rememberPropertyReply(alternativeCatalog, floor.context, 'Departamento 304. ¿Le interesa?', {
    offered_unit_ids: ['a304'], catalog_query: floor.query,
    pending_question: { id: 'unit_choice', act: 'choose_unit', candidate_ids: ['a304'] } })
  const chosen = resolvePropertyTurn(alternativeCatalog, 'el 304 por favor', { _property_context: state }, [], {})
  assert.deepEqual(chosen.context.selected_ids, ['a304'])
  assert.deepEqual(chosen.context.preference_transition, {})
})

test('accepting quoted details preserves the full set and asking its differences compares without selecting', () => {
  const pending = { id: 'unit_choice', act: 'explore_quoted_options', question: '¿Le gustaría obtener más detalles de alguna de estas opciones?', candidate_ids: ['u602', 'u605'] }
  const state = { query: { group: 'residential', category: 'penthouse', filters: { bedrooms: 3 } }, offered_ids: ['u602', 'u605'], pending_question: pending }
  const details = resolvePropertyTurn(catalog, 'si está bien', { _property_context: state }, [], {})
  assert.equal(details.reason, 'accepted_quoted_options')
  assert.deepEqual(details.matches.map(unit => unit.id), ['u602', 'u605'])
  assert.deepEqual(details.context.selected_ids, [])
  const comparison = resolvePropertyTurn(catalog, 'si está bien y cuál es la diferencia?', { _property_context: state }, [], {})
  assert.equal(comparison.reason, 'comparison_followup')
  assert.equal(comparison.query.operation, 'compare')
  assert.deepEqual(comparison.context.comparison_ids, ['u602', 'u605'])
  assert.deepEqual(comparison.context.selected_ids, [])
})

test('explicit choices resolve once before inherited filters and affirmative question branches', () => {
  const { unitModelDelivery } = require('../src/lib/integrations/automation/unit-model.ts')
  for (const current of ['el 605 por favor', 'pero si ya le dije la 605', 'prefiero el 605']) {
    const state = { offered_ids: ['u602','u605'], query: {category:'penthouse',operation:'search',filters:{bedrooms:5}},
      pending_question:{id:'unit_choice',act:'choose_unit',candidate_ids:['u602','u605']} }
    const semantic = semantics(current, {operation:'select',category:'penthouse',reference_kind:'explicit',unit_numbers:['605'],filters:{bedrooms:3,floor_number:6}})
    semantic.answer_to_previous = {question_id:'unit_choice',kind:'affirmative',confidence:'high',evidence:current}
    const selected = resolvePropertyTurn(catalog,current,{_property_context:state},penthouses,semantic)
    assert.deepEqual(selected.context.selected_ids,['u605'])
    assert.deepEqual(selected.context.focused_ids,['u605'])
    assert.equal(selected.needsClarification,false)
    assert.equal(selected.query.operation,'select')
    assert.equal(selected.query.filters.bedrooms,null)
    const base = catalogDialogueReply(info(selected,penthouses))
    assert.match(base.reply,/605/)
    assert.doesNotMatch(base.reply,/602|Cuál de estas/)
    assert.match(unitModelDelivery(selected,current,penthouses).url,/unidad=605/)
    assert.equal(unitModelDelivery(selected,current,penthouses,['u605']),null)
  }
})
test('accepted alternatives survive a price interruption and a category choice', () => {
  const { unitAlternative } = require('../src/lib/integrations/automation/unit-alternatives.ts')
  const offer = unitAlternative({ catalogo: catalog }, 'no tiene nada de 5 dormitorios?')
  assert.equal(offer.pending_question.act, 'explore_alternatives')
  let saved = { query: { group: 'residential', filters: { bedrooms: 5 } }, pending_question: offer.pending_question }
  const yes = 'si claro. gracias'
  const accepted = resolvePropertyTurn(catalog, yes, { _property_context: saved }, [], semantics(yes, { operation: 'none' }))
  assert.equal(accepted.query.filters.bedrooms, 3)
  assert.equal(accepted.context.original_query.filters.bedrooms, 5)
  saved = rememberPropertyReply(catalog, accepted.context, 'Opciones de tres dormitorios. ¿Qué categoría prefiere?', {
    offered_unit_ids: accepted.matches.map(unit => unit.id), pending_question: { id: 'property_category', act: 'choose_category', question: '¿Qué categoría prefiere?' } })
  const price = resolvePropertyTurn(catalog, '¿y los precios?', { _property_context: saved }, [], semantics('¿y los precios?', { operation: 'none' }))
  const selected = resolvePropertyTurn(catalog, 'me interesan los penthouses', { _property_context: price.context }, [], semantics('me interesan los penthouses', { category: 'penthouse', operation: 'search' }))
  assert.equal(selected.query.filters.bedrooms, 3)
  assert.equal(selected.query.category, 'penthouse')
  const answer = catalogDialogueReply({ catalogo: catalog, referencia_unidad: selected, property_context: selected.context }, 'me interesan los penthouses')
  assert.doesNotMatch(answer.reply, /5 dormitorios|no contamos/)
  assert.match(answer.reply, /3 dormitorios/)
})
test('legacy alternative choice recovers the active search without erasing the original need', () => {
  const saved = { journey: 'residential_alternatives', phase: 'compare_categories', query: { group: 'residential', filters: { bedrooms: 5 } },
    pending_question: { id: 'property_category', act: 'choose_category', question: '¿Departamentos o penthouses?' } }
  const current = 'me interesan los penthouses'
  const result = resolvePropertyTurn(catalog, current, { _property_context: saved }, [], semantics(current, { category: 'penthouse', operation: 'search' }))
  assert.equal(result.query.filters.bedrooms, 3)
  assert.deepEqual(result.matches.map(unit => unit.id), ['u602', 'u605'])
  const firm = resolvePropertyTurn(catalog, current, { _property_context: { ...saved, query: { ...saved.query, filters: { bedrooms: 5, bedrooms_required: true } } } }, [], semantics(current, { category: 'penthouse', operation: 'search' }))
  assert.equal(firm.query.filters.bedrooms, 5)
})
test('generic information continues the selected unit instead of searching the full catalogue', () => {
  const current = 'quiero informacion'
  const result = resolvePropertyTurn(catalog, current, { _property_context: { selected_ids: ['u602'], query: { category: 'penthouse' } } }, [],
    semantics(current, { operation: 'details', reference_kind: 'followup', query_scope: 'selected' }))
  assert.equal(result.query.operation, 'details')
  assert.deepEqual(result.matches.map(unit => unit.id), ['u602'])
})
function semantics(current, property) {
  return normalizeTurnSemantics({turn_semantics:{primary_intent:'select_property',primary_evidence:current,confidence:'high',property:{...property,evidence:current,confidence:'high'}}},current,{})
}
function info(reference, history, overrides={}) {
  return {catalogo:catalog,referencia_unidad:reference,property_context:reference.context,historial:history,
    lead:{preferred_category:'departamento'},politica_comercial:{precios_autorizados:true,precios_aproximados:true},...overrides}
}

test('accepting an alternative query advances from five to exploring three without changing the original need', () => {
  const available = [...catalog, { id: 'u304', unit_number: '304', category: 'departamento', bedrooms: 2, floor_number: 3, area_internal_m2: 109.69 }]
  const first = resolvePropertyTurn(available, 'Busco vivienda de cinco cuartos', {}, [], semantics('Busco vivienda de cinco cuartos', { operation: 'search' }))
  const offer = 'No tenemos cinco dormitorios. ¿Le gustaría revisar las alternativas de tres dormitorios?'
  const pending = { id: 'property_category', act: 'explore_alternatives', question: '¿Le gustaría revisar las alternativas de tres dormitorios?',
    candidate_ids: catalog.map(unit => unit.id), target_ids: [], proposed_query: { group: 'residential', category: null, operation: 'search', scope: 'catalog', filters: { bedrooms: 3 } } }
  const stored = rememberPropertyReply(available, first.context, offer, { catalog_query: first.query, original_query: first.query, pending_question: pending })
  assert.equal(stored.query.filters.bedrooms, 5)
  assert.equal(stored.original_query.filters.bedrooms, 5)
  for (const operation of ['none', 'search', 'select']) {
    const current = 'si esta bien'
    const semantic = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'answer_previous', primary_evidence: current, confidence: 'high',
      property: { operation, reference_kind: 'followup', evidence: current, confidence: 'high' },
      answer_to_previous: { question_id: 'property_category', kind: 'affirmative', evidence: current, confidence: 'high' } } }, current, stored.pending_question)
    const accepted = resolvePropertyTurn(available, current, { _property_context: stored }, [{ role: 'bot', content: offer }], semantic)
    assert.equal(accepted.reason, 'accepted_alternative_query', operation)
    assert.equal(accepted.query.operation, 'search', operation)
    assert.equal(accepted.query.filters.bedrooms, 3, operation)
    assert.equal(accepted.context.original_query.filters.bedrooms, 5, operation)
    assert.equal(accepted.explicit, false, operation)
    assert.deepEqual(accepted.context.selected_ids, [], operation)
    assert.ok(accepted.matches.every(unit => unit.bedrooms === 3), operation)
    const answer = catalogDialogueReply({ ...info(accepted, []), catalogo: available, semantica_turno: semantic }, current)
    assert.doesNotMatch(answer.reply, /no contamos.*5 dormitorios/i)
    const memory = rememberPropertyReply(available, accepted.context, answer.reply, answer.audit)
    const choice = 'Me interesan los departamentos porque los penthouses son caros'
    const chosenCategory = resolvePropertyTurn(available, choice, { _property_context: memory }, [{ role: 'bot', content: answer.reply }],
      semantics(choice, { category: 'departamento', excluded_categories: ['penthouse'], operation: 'select' }))
    const apartments = catalogDialogueReply({ ...info(chosenCategory, []), catalogo: available }, choice)
    assert.equal(chosenCategory.query.filters.bedrooms, 3, operation)
    assert.equal(chosenCategory.context.original_query.filters.bedrooms, 5, operation)
    assert.ok(apartments.audit.catalog_results.units.every(unit => unit.category === 'departamento' && unit.bedrooms === 3), operation)
    assert.doesNotMatch(apartments.reply, /304|2 dormitorios/)
    assert.deepEqual(chosenCategory.context.selected_ids, [], operation)
  }
})

test('an affirmative to an ambiguous set never picks its first unit or invents a relaxed query', () => {
  const pending = { id: 'unit_choice', act: 'choose_unit', question: '¿Cuál le interesa?', candidate_ids: ['u202', 'u302'], target_ids: [] }
  const previous = { _property_context: { last_reply: pending.question, pending_question: pending, offered_ids: ['u202', 'u302'], selected_ids: [] } }
  const reference = resolvePropertyTurn(catalog, 'sí está bien', previous, [{ role: 'bot', content: pending.question }], {})
  assert.equal(reference.needsClarification, true)
  assert.equal(reference.reason, 'unresolved_choice')
  assert.equal(reference.explicit, false)
  assert.deepEqual(reference.context.selected_ids, [])
  const malformed = { ...pending, id: 'property_category', act: 'explore_alternatives' }
  const noProposal = resolvePropertyTurn(catalog, 'sí está bien', { _property_context: { ...previous._property_context, pending_question: malformed } }, [], {})
  assert.notEqual(noProposal.reason, 'accepted_alternative_query')
  assert.deepEqual(noProposal.context.selected_ids, [])
  const categoryChoice = { id: 'property_category', act: 'choose_category', question: '¿Departamentos o penthouses?', candidate_ids: ['u202', 'u602'] }
  const context = { last_reply: categoryChoice.question, pending_question: categoryChoice, query: { group: 'residential', category: null, filters: { bedrooms: 3 } } }
  const ambiguous = resolvePropertyTurn(catalog, 'sí está bien', { _property_context: context }, [],
    semantics('sí está bien', { category: 'departamento', operation: 'select' }))
  assert.equal(ambiguous.query.category, null)
  assert.equal(ambiguous.query.operation, 'none')
  assert.equal(ambiguous.reason, 'unresolved_choice')
  assert.deepEqual(ambiguous.context.selected_ids, [])
})

test('residential category refinements retain constraints and a change to commercial use clears them', () => {
  const previous = { _property_context: { query: { group: 'residential', category: null, filters: { bedrooms: 3, floor_number: 3, min_area_m2: 100 } },
    original_query: { group: 'residential', filters: { bedrooms: 5 } } } }
  const current = 'Prefiero departamentos'
  const apartment = resolvePropertyTurn(catalog, current, previous, [], semantics(current, { category: 'departamento', operation: 'select' }))
  assert.equal(apartment.query.filters.bedrooms, 3)
  assert.equal(apartment.query.filters.floor_number, 3)
  assert.equal(apartment.query.filters.min_area_m2, 100)
  const commercial = resolvePropertyTurn(catalog, 'Busco un local', previous, [], semantics('Busco un local', { category: 'local', operation: 'search' }))
  assert.equal(commercial.query.filters.bedrooms, null)
  assert.equal(commercial.query.filters.floor_number, null)
  assert.deepEqual(commercial.context.original_query, {})
})

test('the exact legacy no-match offer can be accepted using its verified alternative IDs', () => {
  const question = '¿Le gustaría revisar las alternativas disponibles?'
  const previous = { _pending_question: { id: 'property_category', act: 'choose_category', question, candidate_ids: ['u202', 'u302', 'u602'] },
    _property_context: { query: { group: 'residential', category: null, filters: { bedrooms: 5 }, operation: 'search' } } }
  const accepted = resolvePropertyTurn(catalog, 'si esta bien', previous, [], semantics('si esta bien', { operation: 'search' }))
  assert.equal(accepted.reason, 'accepted_alternative_query')
  assert.equal(accepted.query.filters.bedrooms, 3)
  assert.equal(accepted.context.original_query.filters.bedrooms, 5)
  assert.deepEqual(accepted.context.selected_ids, [])
  for (const pending of [
    { ...previous._pending_question, question: '¿Departamentos o penthouses?' },
    { ...previous._pending_question, candidate_ids: ['u202', 'retired'] },
    { ...previous._pending_question, candidate_ids: [] },
  ]) {
    const result = resolvePropertyTurn(catalog, 'si esta bien', { ...previous, _pending_question: pending }, [], {})
    assert.notEqual(result.reason, 'accepted_alternative_query')
    assert.equal(result.query.filters.bedrooms, 5)
  }
  const refused = resolvePropertyTurn(catalog, 'No, necesito cinco dormitorios', previous, [], semantics('No, necesito cinco dormitorios', { operation: 'search' }))
  assert.notEqual(refused.reason, 'accepted_alternative_query')
  assert.equal(refused.query.filters.bedrooms, 5)
})

test('literal evidence validates property semantics and cannot silently accept foreign or contradictory categories',()=>{
  const current='Prefiero los departamentos porque los penthouses deben ser caros'
  const valid=semantics(current,{category:'departamento',excluded_categories:['penthouse'],reference_kind:'none'})
  assert.equal(valid.property.category,'departamento')
  assert.equal(preferredPropertyCategory(current,valid),'departamento')
  const invalid=normalizeTurnSemantics({turn_semantics:{property:{category:'penthouse',evidence:'quiero penthouses',confidence:'high'}}},current,{})
  assert.equal(invalid.property.category,null)
  assert.equal(invalid.property.confidence,'low')
  assert.equal(semantics(current,{category:'penthouse',excluded_categories:['penthouse']}).property.category,null)
})

test('choosing apartments clears old penthouse references without treating an objection as budget',()=>{
  const current='bueno, me interesa mas los departamentos por que los penthouse deben ser muy caros.'
  const semantic=semantics(current,{category:'departamento',excluded_categories:['penthouse'],reference_kind:'none'})
  const reference=resolvePropertyTurn(catalog,current,{_unit_reference:{ids:['u602']},_property_context:{selected_ids:['u602']}},penthouses,semantic)
  assert.equal(reference.reason,'category_change')
  assert.deepEqual(reference.matches,[])
  assert.equal(reference.context.preference_category,'departamento')
  assert.deepEqual(reference.context.selected_ids,[])
  assert.equal(semantic.budget.status,'not_discussed')
  const journey=continueUnitAlternative(info(reference,[{role:'bot',content:'¿Desea revisar primero los departamentos o los penthouses?'}],{semantica_turno:semantic}),current)
  assert.match(journey.reply,/planta/i)
  assert.doesNotMatch(journey.reply,/penthouse 602|142,09|360/)
})

test('relative largest follows the actually shown penthouse list despite old apartment preference',()=>{
  const current='me interesa mas el mas grande'
  for (const semantic of [{},semantics(current,{reference_kind:'relative',selector:'largest'})]) {
    const reference=resolvePropertyTurn(catalog,current,{_unit_reference:{ids:['u202']},_property_context:{selected_ids:['u202']}},penthouses,semantic)
    assert.equal(reference.reason,'relative_selection')
    assert.deepEqual(reference.matches.map(unit=>unit.id),['u602'])
    assert.deepEqual(reference.context.selected_ids,['u602'])
    const reply=propertySelectionReply(info(reference,penthouses,{semantica_turno:semantic}),current)
    assert.match(reply.reply,/602/)
    assert.doesNotMatch(reply.reply,/departamento 202|departamento 302/)
  }
})

test('ties and missing areas require clarification; no arbitrary UUID is selected',()=>{
  const tied=resolvePropertyTurn(catalog,'el más grande',{},apartments,{})
  assert.equal(tied.needsClarification,true)
  assert.equal(tied.explicit,false)
  assert.match(tied.clarification,/202.*302/)
  const unknown=resolvePropertyTurn(catalog.map(unit=>unit.id==='u602'?{...unit,area_internal_m2:null}:unit),'el más grande',{},penthouses,{})
  assert.equal(unknown.needsClarification,true)
  assert.equal(unknown.explicit,false)
})

test('relative order uses displayed order rather than inventory ordering',()=>{
  const history=[{role:'bot',content:'El penthouse 605 y el penthouse 602. ¿Cuál de estas opciones le gustaría conocer?'}]
  assert.deepEqual(unitsInPropertyReply(catalog,history[0].content).map(unit=>unit.id),['u605','u602'])
  assert.equal(resolvePropertyTurn(catalog,'la primera',{},history,{}).matches[0].id,'u605')
})

test('a complete comparison survives the delivered answer and quotes both verified prices in every commercial mode',()=>{
  for (const mode of ['lanzamiento','preventa']) {
    const first=resolvePropertyTurn(catalog,'y cual es la diferencia entre el 202 y el 302?',{},[],{})
    assert.deepEqual(first.matches.map(unit=>unit.id),['u202','u302'])
    const stored=rememberPropertyReply(catalog,first.context,apartments[0].content,{})
    const summary={_property_context:stored,_unit_reference:first.memory}
    for (const current of ['y en precio?','¿Y el precio?','¿Cuánto cuestan?']) {
      const followup=resolvePropertyTurn(catalog,current,summary,apartments,{})
      assert.equal(followup.reason,'comparison_followup')
      const quote=unitPriceQuote(info(followup,apartments,{modo_comercial:mode}),current,summary)
      assert.match(quote.reply,/202.*250[.,]000.*302.*270[.,]000/)
      assert.equal(quote.comparison.difference,20000)
      assert.equal(responsePlan(quote.reply,{source:'unit_price',verified_price_only:true}).locked,false)
    }
  }
})

test('negations and incidental comparisons cannot override an explicit category or choose a rejected unit',()=>{
  const current='prefiero departamentos, el penthouse es más grande'
  const reference=resolvePropertyTurn(catalog,current,{},penthouses,semantics(current,{category:'departamento',reference_kind:'none'}))
  assert.equal(reference.reason,'category_change')
  for(const current of ['no quiero el más grande','el departamento 202 no me interesa','no quiero el departamento 202']) {
    const result=resolvePropertyTurn(catalog,current,{},penthouses,{})
    assert.equal(result.explicit,false,current)
    assert.ok(!result.context.selected_ids?.length,current)
  }
})

test('actual new suggestions supersede an old comparison even when a writer generated them',()=>{
  const stored=rememberPropertyReply(catalog,{comparison_ids:['u202','u302'],selected_ids:['u202']},penthouses[0].content,{})
  assert.deepEqual(stored.comparison_ids,[])
  assert.deepEqual(stored.selected_ids,[])
  assert.equal(resolvePropertyTurn(catalog,'y en precio?',{_property_context:stored},penthouses,{}).needsClarification,true)
})

test('semantic explicit numbers work outside legacy patterns and residential naming follows catalog',()=>{
  for(const current of ['202 vs 302','compara las opciones 202 y 302']) {
    const result=resolvePropertyTurn(catalog,current,{},[],semantics(current,{reference_kind:'comparison',unit_numbers:['202','302']}))
    assert.deepEqual(result.matches.map(unit=>unit.id),['u202','u302'])
  }
  const current='me interesa el departamento 602'
  const result=resolvePropertyTurn(catalog,current,{},[],semantics(current,{category:'departamento',reference_kind:'explicit',unit_numbers:['602']}))
  assert.deepEqual(result.matches.map(unit=>unit.id),['u602'])
  const padded=[{id:'s1',unit_number:'001',category:'suite'},{id:'l1',unit_number:'LC-01',category:'local'}]
  for(const [current,number,id] of [['suite 1','1','s1'],['local LC-1','LC-1','l1']]) {
    const reference=resolvePropertyTurn(padded,current,{},[],semantics(current,{reference_kind:'explicit',unit_numbers:[number]}))
    assert.deepEqual(reference.matches.map(unit=>unit.id),[id])
    assert.equal(reference.needsClarification,false)
  }
})

test('unavailable comparison member is reported instead of silently quoting the remaining unit',()=>{
  const summary={_property_context:{comparison_ids:['u202','u302'],last_reply:apartments[0].content}}
  const reference=resolvePropertyTurn(catalog.filter(unit=>unit.id!=='u302'),'y en precio?',summary,apartments,{})
  assert.equal(reference.needsClarification,true)
  assert.match(reference.clarification,/ya no aparece/)
  assert.equal(resolvePropertyTurn(catalog,'compara el 202 y el 999',{},[],{}).needsClarification,true)
})

test('generic question after an offer does not silently select it, including a singleton',()=>{
  for (const history of [penthouses,[{role:'bot',content:'Tenemos el penthouse 602. ¿Cuál de estas opciones le gustaría conocer?'}]]) {
    const reference=resolvePropertyTurn(catalog,'y en precio?',{},history,{})
    assert.equal(reference.needsClarification,true)
    assert.equal(reference.explicit,false)
  }
})

test('affirmative confirms only one offered option and never selects among several',()=>{
  const history=[{role:'bot',content:'En esta planta tenemos el departamento 202. ¿Le gustaría conocer esta opción?'}]
  const reference=resolvePropertyTurn(catalog,'sí por favor',{},history,{})
  assert.equal(reference.reason,'confirmed_single_option')
  assert.deepEqual(reference.matches.map(unit=>unit.id),['u202'])
  assert.match(propertySelectionReply(info(reference,history),'sí por favor').reply,/tour\?unidad=202/)
  assert.equal(resolvePropertyTurn(catalog,'sí por favor',{},penthouses,{}).needsClarification,true)
})

test('semantic explicit selection must be grounded in this turn and available catalog',()=>{
  const current='No el departamento 202, quiero el penthouse 602'
  const reference=resolvePropertyTurn(catalog,current,{},[],semantics(current,{category:'penthouse',reference_kind:'explicit',unit_numbers:['602']}))
  assert.deepEqual(reference.matches.map(unit=>unit.id),['u602'])
  const bad=resolvePropertyTurn(catalog,'quiero la unidad 999',{},[],semantics('quiero la unidad 999',{reference_kind:'explicit',unit_numbers:['602']}))
  assert.equal(bad.needsClarification,true)
  assert.deepEqual(bad.matches,[])
})

test('switch to another subject clears active references and actual reply stores offers separately from selections',()=>{
  const selected={selected_ids:['u602'],comparison_ids:['u202','u302']}
  const memory=rememberPropertyReply(catalog,selected,'Si se refiere a las papas, no gestionamos la venta de alimentos.',{source:'business_out_of_scope'})
  assert.deepEqual(memory.selected_ids,[])
  assert.deepEqual(memory.comparison_ids,[])
  const offered=rememberPropertyReply(catalog,{},penthouses[0].content,{source:'unit_alternative_journey',alternative_phase:'choose_unit',offered_unit_ids:['u602','u605']})
  assert.deepEqual(offered.offered_ids,['u602','u605'])
  assert.equal(offered.selected_ids,undefined)
  assert.equal(offered.journey,'residential_alternatives')
  assert.equal(pendingQuestionFromReply(penthouses[0].content).id,'unit_choice')
  assert.equal(pendingQuestionFromReply('¿Desea revisar primero los departamentos o los penthouses?').id,'property_category')
})

test('catalog ranking without numbered offers returns verified maxima without selecting', () => {
  const current = 'cual es la opcion mas grande?'
  const semantic = semantics(current, { operation: 'rank', reference_kind: 'relative', selector: 'largest', query_scope: 'catalog' })
  const reference = resolvePropertyTurn(catalog, current, {}, [{ role: 'bot', content: 'Tenemos opciones en varias plantas.' }], semantic)
  assert.equal(reference.reason, 'catalog_rank')
  assert.equal(reference.needsClarification, false)
  assert.deepEqual(reference.matches.map(unit => unit.id), ['u602'])
  assert.deepEqual(reference.context.selected_ids, [])
  assert.equal(reference.explicit, false)
})

test('ties answer a ranking query while an ambiguous selection still needs a choice', () => {
  const current = 'cual es el departamento mas grande?'
  const reference = resolvePropertyTurn(catalog, current, {}, [], semantics(current, { category: 'departamento', operation: 'rank', reference_kind: 'relative', selector: 'largest' }))
  assert.equal(reference.reason, 'ranking_tie')
  assert.equal(reference.needsClarification, false)
  assert.deepEqual(reference.matches.map(unit => unit.id), ['u202', 'u302'])
  assert.deepEqual(reference.context.selected_ids, [])
  assert.equal(resolvePropertyTurn(catalog, 'prefiero el mas grande', {}, apartments, {}).needsClarification, true)
})

test('normalized floor search outranks an incorrectly inferred historical unit number', () => {
  const current = 'entiendo quiero la opcion de la 5ta planta'
  const fifth = [...catalog, { ...catalog[0], id: 'u502', unit_number: '502', floor_number: 5 }]
  const reference = resolvePropertyTurn(fifth, current, {}, [], semantics(current, { category: 'departamento', reference_kind: 'explicit', unit_numbers: ['502'] }))
  assert.equal(reference.needsClarification, false)
  assert.equal(reference.reason, 'catalog_search')
  assert.equal(reference.query.filters.floor_number, 5)
  assert.deepEqual(reference.matches.map(unit => unit.id), ['u502'])
  assert.deepEqual(reference.context.selected_ids, [])
})

test('an affirmative follows the structured focus even after two alternatives were shown', () => {
  const fifth = [{ ...catalog[0], id: 'u502', unit_number: '502', floor_number: 5 }, { ...catalog[0], id: 'u504', unit_number: '504', floor_number: 5, area_internal_m2: 87 }]
  const reply = 'Dos alternativas, con una recomendación concreta. ¿Desea más detalles?'
  const pending = { id: 'unit_choice', act: 'show_unit_details', question: '¿Desea más detalles?', target_ids: ['u502'], candidate_ids: ['u502', 'u504'] }
  const stored = rememberPropertyReply(fifth, {}, reply, { offered_unit_ids: ['u502', 'u504'], focused_unit_ids: ['u502'], pending_question: pending })
  assert.equal(stored.version, 2)
  assert.deepEqual(stored.offered_ids, ['u502', 'u504'])
  assert.deepEqual(stored.focused_ids, ['u502'])
  const current = 'si prefiero esa opcion'
  for (const property of [{ reference_kind: 'explicit', unit_numbers: ['502'], category: 'departamento' }, { reference_kind: 'followup', unit_numbers: ['502'] }, {}]) {
    const reference = resolvePropertyTurn(fifth, current, { _property_context: stored }, [{ role: 'bot', content: reply }], semantics(current, property))
    assert.equal(reference.reason, 'confirmed_question_target')
    assert.equal(reference.needsClarification, false)
    assert.deepEqual(reference.matches.map(unit => unit.id), ['u502'])
    assert.deepEqual(reference.context.selected_ids, ['u502'])
  }
})

test('new structured metadata is authoritative over paraphrased output and stale rankings are not replayed', () => {
  const reply = 'Podemos empezar por la opción que acabamos de revisar.'
  const stored = rememberPropertyReply(catalog, { query: { operation: 'rank', selector: 'largest', category: 'departamento', filters: { bedrooms: 3 } } }, reply,
    { offered_unit_ids: ['u202'], focused_unit_ids: ['u202'], pending_question: { id: 'unit_choice', act: 'confirm_unit', question: '', target_ids: ['u202'], candidate_ids: ['u202'] } })
  const result = resolvePropertyTurn(catalog, 'gracias', { _property_context: stored }, [{ role: 'bot', content: reply }], {})
  assert.equal(result.query.operation, 'none')
  assert.equal(result.query.selector, null)
  assert.equal(result.query.filters.bedrooms, 3)
  assert.deepEqual(result.context.focused_ids, ['u202'])
  assert.deepEqual(result.context.selected_ids, [])
})

test('a retired focused option is never replaced by another available candidate', () => {
  const pending = { id: 'unit_choice', act: 'show_unit_details', question: '¿Desea verla?', target_ids: ['u502'], candidate_ids: ['u502', 'u504'] }
  const summary = { _property_context: { version: 2, last_reply: '¿Desea verla?', offered_ids: ['u502', 'u504'], focused_ids: ['u502'], pending_question: pending } }
  const result = resolvePropertyTurn([{ id: 'u504', category: 'departamento', unit_number: '504' }], 'si prefiero esa opcion', summary, [{ role: 'bot', content: '¿Desea verla?' }], {})
  assert.equal(result.reason, 'question_target_unavailable')
  assert.equal(result.needsClarification, true)
  assert.deepEqual(result.matches, [])
})

test('a selected target uses catalogue category rather than filters from an older search', () => {
  const current = 'me interesa mas el mas grande'
  const reference = resolvePropertyTurn(catalog, current, { _property_context: {
    preference_category: 'departamento', query: { category: 'departamento', group: 'residential', filters: { floor_number: 2, bedrooms: 2 } },
  } }, penthouses, semantics(current, { reference_kind: 'relative', selector: 'largest', operation: 'select' }))
  assert.deepEqual(reference.matches.map(unit => unit.id), ['u602'])
  assert.equal(reference.query.category, 'penthouse')
  assert.equal(reference.query.filters.floor_number, null)
  assert.equal(reference.query.filters.bedrooms, null)
})

test('an explicit comparison replaces an older search category without becoming a selection', () => {
  const current = 'compara el 202 y el 302'
  const reference = resolvePropertyTurn(catalog, current, { _property_context: {
    preference_category: 'penthouse', query: { category: 'penthouse', filters: { floor_number: 6 } },
  } }, [], semantics(current, { operation: 'compare', reference_kind: 'comparison', unit_numbers: ['202', '302'] }))
  assert.equal(reference.query.category, 'departamento')
  assert.equal(reference.query.filters.floor_number, null)
  assert.equal(reference.query.scope, 'comparison')
  assert.deepEqual(reference.context.selected_ids, [])
  assert.deepEqual(reference.context.comparison_ids, ['u202', 'u302'])
})

test('extractor operations survive incidental ranking, comparison and generic information wording', () => {
  const state = { selected_ids: ['u605'], offered_ids: ['u602', 'u605'], query: { category: 'penthouse', filters: { bedrooms: 3 } } }
  for (const current of ['Ya sé cuál es la más grande, ahora quiero detalles de esa opción', 'Ya vi la diferencia, cuénteme más de la elegida']) {
    const ref = resolvePropertyTurn(catalog, current, { _property_context: state }, [], semantics(current,
      { operation: 'details', reference_kind: 'followup', query_scope: 'selected' }))
    assert.equal(ref.query.operation, 'details', current)
    assert.deepEqual(ref.matches.map(unit => unit.id), ['u605'])
    assert.equal(ref.context.operation_resolution.source, 'extractor')
    assert.equal(ref.context.operation_resolution.applied, 'details')
  }
  const current = 'quiero información de las opciones nuevamente'
  const search = resolvePropertyTurn(catalog, current, { _property_context: state }, [], semantics(current,
    { operation: 'search', category: 'penthouse', query_scope: 'catalog' }))
  assert.equal(search.query.operation, 'search')
  assert.equal(search.query.scope, 'catalog')
  const comparison = resolvePropertyTurn(catalog, 'quiero información', { _property_context: state }, [], semantics('quiero información',
    { operation: 'compare', reference_kind: 'comparison', query_scope: 'offered', unit_numbers: ['602', '605'] }))
  assert.equal(comparison.query.operation, 'compare')
  assert.deepEqual(comparison.matches.map(unit => unit.id), ['u602', 'u605'])
})

test('a model rank over explicit units is not silently changed into a comparison or a new selection', () => {
  const current = 'entre el 602 y el 605, cuál es el más grande?'
  const ref = resolvePropertyTurn(catalog, current, {}, [], semantics(current,
    { operation: 'rank', reference_kind: 'comparison', unit_numbers: ['602', '605'], selector: 'largest', query_scope: 'offered' }))
  assert.equal(ref.query.operation, 'rank')
  assert.deepEqual(ref.context.selected_ids, [])
  const response = catalogDialogueReply({ catalogo: catalog, referencia_unidad: ref, property_context: ref.context }, current)
  assert.deepEqual(response.audit.catalog_ranking.unit_ids, ['u602'])
})

test('the normalized current filter is not replaced a second time by a stale number mentioned in the same message', () => {
  const current = 'Ya no quiero 3 cuartos, prefiero 2 dormitorios'
  const ref = resolvePropertyTurn(alternativeCatalog, current, {}, [], semantics(current, { operation: 'search', category: 'departamento',
    filters: { bedrooms: 2 }, filter_evidence: { bedrooms: 'prefiero 2 dormitorios' } }))
  assert.equal(ref.query.filters.bedrooms, 2)
  assert.deepEqual(ref.matches.map(unit => unit.id), ['p601', 'a304', 'a404'])
  assert.equal(ref.context.filter_resolution.ignored_lexical_filters.bedrooms, 3)
})
