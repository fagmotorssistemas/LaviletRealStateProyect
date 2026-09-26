/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
require('./test-typescript.cjs')
const { catalogQuery, filterCatalog, rankCatalog, compareCatalog, catalogDialogueReply, validateCatalogReply } = require('../src/lib/integrations/automation/catalog-dialogue.ts')
const { propertySelectionReply } = require('../src/lib/integrations/automation/property-selection.ts')
const { responsePlan } = require('../src/lib/integrations/automation/response-plan.ts')
const { commercialReply } = require('../src/lib/integrations/automation/sdr.ts')
const { normalizeTurnSemantics } = require('../src/lib/integrations/automation/turn-semantics.ts')
const { resolvePropertyTurn, rememberPropertyReply } = require('../src/lib/integrations/automation/property-context.ts')

const unit = (code, category, bedrooms, area, exterior, floor) => ({
  id: `unit-${code}`, unit_number: code, category, bedrooms, area_internal_m2: area, area_exterior_m2: exterior,
  floor_number: floor, floor: `${floor}.ª planta`, status: 'disponible', is_published: true,
})
const catalogue = [
  unit('210', 'suite', 1, 63, 9, 2),
  ...['202', '302', '402', '502'].map(code => unit(code, 'departamento', 3, 120.83, 27.03, Number(code[0]))),
  ...['304', '404', '504'].map(code => unit(code, 'departamento', 2, 109.69, 34.59, Number(code[0]))),
  unit('602', 'penthouse', 3, 142.09, 70, 6),
]
const query = (operation, overrides = {}) => catalogQuery({ operation, group: 'residential', scope: 'catalog', ...overrides })
const info = (query, extra = {}) => ({
  catalogo: catalogue, lead: {}, historial: [], property_context: {},
  referencia_unidad: { reason: 'catalog_query', query, matches: [], needsClarification: false }, ...extra,
})

test('area attributes and mathematical bounds are independent of prose spelling', () => {
  const units=[{id:'p602',unit_number:'602',category:'penthouse',bedrooms:3,area_internal_m2:142.09,area_exterior_m2:25.3},
    {id:'p605',unit_number:'605',category:'penthouse',bedrooms:3,area_internal_m2:140.53,area_exterior_m2:23.01}]
  const audit={verified_catalog:true,catalog_results:{units}}
  for(const reply of [
    'Penthouse 605: 140,53 m² interiores y 23,01 m² de área exterior.',
    'Penthouse 605: superficie exterior de 23,01 m².',
    'Penthouses 602 y 605: superficies superiores a 140 m² interiores.',
    'Penthouses 602 y 605: entre 140 y 143 m² interiores.',
    'Penthouses 602 y 605: menos de 143 m² interiores.',
  ]) assert.equal(validateCatalogReply(reply,audit).valid,true,reply)
  for(const reply of [
    'Penthouse 605: 23,01 m² interiores.',
    'Penthouse 605: superficie exterior de 140,53 m².',
    'Penthouses 602 y 605: superficies superiores a 141 m² interiores.',
    'Penthouses de 3 dormitorios: más de 141 m² interiores.',
    'Penthouses 602 y 605: entre 141 y 143 m² interiores.',
    'Penthouses 602 y 605: menos de 140 m² interiores.',
  ]) assert.equal(validateCatalogReply(reply,audit).valid,false,reply)
  const natural='El penthouse 605 dispone de un balcón de 23,01 m².'
  const reviewed={...audit,semantic_review:{status:'checked',factual_values:[{unit_id:'p605',field:'area_exterior_m2',value:23.01,fragment:natural}]}}
  assert.equal(validateCatalogReply(natural,reviewed).valid,true)
  const falseInterior='El penthouse 605 dispone de 23,01 m² interiores.'
  assert.equal(validateCatalogReply(falseInterior,{...reviewed,semantic_review:{status:'checked',factual_values:[
    {...reviewed.semantic_review.factual_values[0],fragment:falseInterior}]}}).valid,false)
})

test('bedroom alternatives query every requested count, including word forms, without inventing a denial', () => {
  const {propertyFiltersFromText}=require('../src/lib/integrations/automation/turn-semantics.ts')
  for(const current of ['no tiene opciones de 5 dormitorios o de 6?', 'me interesa una opcion de cinco o seis cuartos']) {
    const filters=propertyFiltersFromText(current)
    assert.deepEqual(filters.bedrooms_any,[5,6]);assert.equal(filters.bedrooms,null)
    const noMatches=catalogDialogueReply(info(query('search',{filters})))
    assert.match(noMatches.reply,/5 o 6 dormitorios/)
    assert.deepEqual(noMatches.audit.catalog_query.filters.bedrooms_any,[5,6])
    assert.deepEqual(noMatches.audit.catalog_results.units,[])
    assert.ok(noMatches.audit.alternative_results.units.every(u=>u.bedrooms===3))
    const available=unit('701','penthouse',5,180,20,7)
    const result=catalogDialogueReply(info(query('search',{filters}),{catalogo:[...catalogue,available]}))
    assert.deepEqual(result.audit.catalog_results.unit_ids,['unit-701'])
    assert.doesNotMatch(result.reply,/no contamos/)
  }
  for(const current of ['precios de 500 o 600 mil','entre 5 y 6 dormitorios','no quiero 5 o 6 dormitorios'])
    assert.equal(propertyFiltersFromText(current).bedrooms_any,undefined)
})

test('accepting alternatives after a disjunctive query does not restore unavailable bedroom counts', () => {
  const first=catalogDialogueReply(info(query('search',{filters:{bedrooms_any:[5,6]}})))
  const summary={_property_context:{query:first.audit.catalog_query,pending_question:first.audit.pending_question,offered_ids:first.audit.alternative_results.unit_ids}}
  const current='me interesan los penthouses'
  const semantics=normalizeTurnSemantics({turn_semantics:{primary_intent:'select_property',primary_evidence:current,confidence:'high',property:{category:'penthouse',group:'residential',operation:'search',reference_kind:'none',filters:{},evidence:current,confidence:'high'}}},current)
  const turn=resolvePropertyTurn(catalogue,current,summary,[],semantics)
  assert.equal(turn.query.filters.bedrooms_any,undefined)
  assert.equal(turn.query.filters.bedrooms,3)
  assert.ok(turn.matches.length>0)
  const next=catalogDialogueReply(info(turn.query,{property_context:turn.context,referencia_unidad:turn}))
  assert.doesNotMatch(next.reply,/no contamos|5 o 6/)
})

test('semantic alternatives survive normalization and lookup even without the lexical spelling pattern', () => {
  const current='Me sirven cuatro, seis u ocho habitaciones'
  const semantics=normalizeTurnSemantics({turn_semantics:{primary_intent:'select_property',primary_evidence:current,confidence:'high',property:{group:'residential',operation:'search',filters:{bedrooms_any:[4,6,8]},evidence:current,confidence:'high'}}},current)
  assert.deepEqual(semantics.property.filters.bedrooms_any,[4,6,8])
  const turn=resolvePropertyTurn(catalogue,current,{},[],semantics)
  assert.deepEqual(turn.query.filters.bedrooms_any,[4,6,8])
})

test('relative most expensive selection ranks published prices, retains ties and refuses incomplete prices', () => {
  const catalogo = [ { ...catalogue[1], published_commercial_price: 310000 }, { ...catalogue.at(-1), published_commercial_price: 550000 } ]
  const selected = query('select', { selector: 'most_expensive' })
  const result = catalogDialogueReply(info(selected, { catalogo, politica_comercial: { precios_autorizados: true } }))
  assert.match(result.reply, /602/)
  assert.match(result.reply, /550/)
  assert.ok(!result.reply.includes('202'))
  assert.equal(result.audit.catalog_ranking.unit_ids.length, 1)
  const missing = catalogDialogueReply(info(selected, { catalogo: [{ ...catalogo[0], published_commercial_price: null }, catalogo[1]], politica_comercial: { precios_autorizados: true } }))
  assert.match(missing.reply, /No tengo precios/)
  const tied = rankCatalog(catalogo.map(unit => ({ ...unit, published_commercial_price: 550000 })), 'most_expensive', true)
  assert.equal(tied.units.length, 2)
})

test('Carlos broad largest query relaxes unavailable preference but preserves hard and explicit filters', () => {
  const current = 'entonces cuál es la vivienda más espaciosa que tiene?'
  const semantics = { property: { confidence: 'high', group: 'residential', category: null, operation: 'search', reference_kind: 'relative', selector: 'largest', query_scope: 'catalog', filters: {} } }
  const summary = { _property_context: { query: query('search', { category: 'departamento', filters: { bedrooms: 5, bedrooms_required: false } }) } }
  const ref = resolvePropertyTurn(catalogue, current, summary, [], semantics)
  assert.equal(ref.query.filters.bedrooms, null)
  assert.equal(ref.query.operation, 'rank')
  const answer = catalogDialogueReply({ catalogo: catalogue, referencia_unidad: ref, property_context: ref.context }, current)
  assert.match(answer.reply, /142,09/)
  assert.match(answer.reply, /120,83/)
  assert.doesNotMatch(answer.reply, /no contamos|5 dormitorios/)
  assert.equal(validateCatalogReply(answer.reply, answer.audit).valid, true)
  assert.equal(ref.context.original_query.filters.bedrooms, 5)
  summary._property_context.query.filters.bedrooms_required = true
  assert.equal(resolvePropertyTurn(catalogue, current, summary, [], semantics).query.filters.bedrooms, 5)
  summary._property_context.query.filters.bedrooms_required = false
  assert.equal(resolvePropertyTurn(catalogue, 'cuál es la vivienda más espaciosa de 5 dormitorios?', summary, [], semantics).query.filters.bedrooms, 5)
  summary._property_context.query.filters.bedrooms = 3
  assert.equal(resolvePropertyTurn(catalogue, current, summary, [], semantics).query.filters.bedrooms, 3)
})

test('semantic empty-query denial accepts synonyms without bypassing other catalogue facts', () => {
  const answer = catalogDialogueReply(info(query('search', { category: 'departamento', filters: { bedrooms: 5 } })), 'Quiero 5 dormitorios')
  for (const denial of ['La Vilet no cuenta con departamentos disponibles de 5 dormitorios.', 'Ningún departamento disponible tiene 5 dormitorios.', 'La Vilet no cuenta con departamentos de cinco dormitorios.']) {
    const reply = answer.reply.replace(/^.*?\. /, denial + ' ')
    const claims = [{ fragment: denial, subject: 'departamentos de 5 dormitorios', polarity: 'negation', verdict: 'supported', evidence_source: 'catalog_no_results', evidence: 'Consulta completa sin coincidencias' }]
    const audit = { ...answer.audit, semantic_review: { status: 'checked', query: answer.audit.catalog_query, claims } }
    assert.equal(validateCatalogReply(reply, audit).valid, true)
    assert.equal(validateCatalogReply(reply.replace('120,83', '999,99'), audit).valid, false)
    assert.equal(validateCatalogReply(reply, { ...audit, semantic_review: { ...audit.semantic_review, status: 'rejected' } }).valid, false)
    assert.equal(validateCatalogReply(reply, { ...audit, catalog_results: { ...audit.catalog_results, complete: false } }).valid, false)
    const affirmative = reply.replace(denial, 'Tenemos departamentos de 5 dormitorios.')
    assert.equal(validateCatalogReply(affirmative, audit).valid, false)
  }
})

test('recorded 502 search inconsistency resolves the offered choice and protects its showroom', () => {
  const pending = { id: 'unit_choice', act: 'choose_unit', question: '¿Cuál de estas opciones le gustaría conocer?', candidate_ids: ['unit-202', 'unit-302', 'unit-402', 'unit-502'], target_ids: [] }
  const summary = { _pending_question: pending, _property_context: { offered_ids: pending.candidate_ids, pending_question: pending } }
  const semantics = { primary_intent: 'select_property', property: { confidence: 'high', group: 'residential', category: 'departamento', operation: 'search', reference_kind: 'explicit', unit_numbers: ['502'], query_scope: 'offered', filters: { bedrooms: 3, floor_number: 5 } } }
  const current = 'revisemos la opcion 502 entocnes'
  const ref = resolvePropertyTurn(catalogue, current, summary, [], semantics)
  assert.equal(ref.reason, 'explicit_pending_choice')
  assert.equal(ref.query.operation, 'select')
  assert.deepEqual(ref.matches.map(unit => unit.unit_number), ['502'])
  const answer = catalogDialogueReply({ catalogo: catalogue, referencia_unidad: ref, property_context: ref.context }, current)
  assert.match(answer.reply, /https:\/\/www.lavilett.com\/tour\?unidad=502/)
  assert.doesNotMatch(answer.reply, /gustaría ver los detalles/)
  assert.equal(validateCatalogReply(answer.reply, answer.audit).valid, true)
  assert.equal(validateCatalogReply(answer.reply.replace(/https:\/\/\S+/, ''), answer.audit).reason, 'unit_tour_omitted')
  for (const text of ['cuanto cuesta el 502', 'compare el 502 y 202', 'no quiero el 502', 'revisemos el 502 pero no envie el recorrido', 'revisemos la opcion 999']) {
    assert.notEqual(resolvePropertyTurn(catalogue, text, summary, [], semantics).reason, 'explicit_pending_choice', text)
  }
})

test('send details accepts the focused unit while an explicit brochure remains a brochure', () => {
  const { wantsBrochure } = require('../src/lib/integrations/automation/project-material.ts')
  const question = '¿Le gustaría ver los detalles de departamento 502?'
  const pending = { id: 'unit_choice', act: 'show_unit_details', question, target_ids: ['unit-502'], candidate_ids: ['unit-502'] }
  const history = [{ role: 'bot', content: question }]
  const summary = { _pending_question: pending, _property_context: { pending_question: pending, focused_ids: ['unit-502'] } }
  const current = 'si envieme los detalles'
  assert.equal(wantsBrochure(current, history), false)
  assert.equal(wantsBrochure('si envieme el brochure', history), true)
  assert.equal(wantsBrochure(current, []), true)
  const ref = resolvePropertyTurn(catalogue, current, summary, history, {})
  const answer = catalogDialogueReply({ catalogo: catalogue, referencia_unidad: ref, property_context: ref.context }, current)
  assert.equal(ref.query.operation, 'select')
  assert.match(answer.reply, /tour\?unidad=502/)
})

test('broad housing presents one-bedroom suites and apartments without inventing a category choice', () => {
  const q = query('search')
  for (const current of ['me interesa vivienda', 'busco algo para vivir', 'vivienda']) {
    const answer = propertySelectionReply(info(q, { lead: { preferred_category: 'departamento' } }), current)
    assert.match(answer.reply, /suites de 1 dormitorio/)
    assert.match(answer.reply, /departamentos de 2 o 3 dormitorios/)
    assert.match(answer.reply, /penthouses de 3 dormitorios/)
    assert.deepEqual(answer.audit.selected_unit_ids, [])
    assert.equal(answer.audit.pending_question.act, 'choose_category')
    assert.doesNotMatch(answer.reply, /presupuesto/)
  }
})

test('largest apartment is a catalogue inquiry even before any list was offered', async () => {
  const q = query('rank', { category: 'departamento', selector: 'largest' })
  const input = info(q)
  input.referencia_unidad.needsClarification = true // The old reference guard cannot hijack an informational rank.
  input.referencia_unidad.clarification = 'Indique una unidad'
  const answer = await commercialReply(input, 'cuál es el más grande?', {}, async () => {})
  assert.equal(answer.audit.source, 'catalog_rank')
  assert.match(answer.reply, /120[.,]83 m²/)
  assert.deepEqual(answer.audit.catalog_ranking.unit_ids, ['unit-202', 'unit-302', 'unit-402', 'unit-502'])
  assert.deepEqual(answer.audit.selected_unit_ids, [])
  assert.doesNotMatch(answer.reply, /Indique una unidad|142[.,]09|109[.,]69|tour/)
})

test('three-bedroom comparison never mixes the area of two-bedroom apartments', () => {
  const q = query('compare', { category: 'departamento', filters: { bedrooms: 3 } })
  const answer = catalogDialogueReply(info(q), 'los de tres habitaciones son del mismo tamaño?')
  assert.match(answer.reply, /misma superficie interior: 120[.,]83 m²/)
  assert.match(answer.reply, /27[.,]03 m² exteriores/)
  assert.doesNotMatch(answer.reply, /109[.,]69|34[.,]59|304|404|504|602/)
  assert.deepEqual(answer.audit.catalog_comparison.interior, { complete: true, same: true, min: 120.83, max: 120.83 })
  assert.ok(answer.audit.catalog_results.units.every(unit => unit.bedrooms === 3 && unit.category === 'departamento'))
})

test('a normalized fifth-floor answer focuses 502, and acceptance acts on that focus rather than the old list', () => {
  const floorQuery = query('search', { category: 'departamento', filters: { floor_number: 5, bedrooms: 3 } })
  const offered = catalogDialogueReply(info(floorQuery), '5ta planta')
  assert.deepEqual(offered.audit.offered_unit_ids, ['unit-502'])
  assert.deepEqual(offered.audit.focused_unit_ids, ['unit-502'])
  assert.deepEqual(offered.audit.selected_unit_ids, [])
  assert.equal(offered.audit.pending_question.act, 'show_unit_details')
  assert.deepEqual(offered.audit.pending_question.target_ids, ['unit-502'])
  const accepted = catalogDialogueReply(info(query('details', { category: 'departamento', scope: 'selected' }), {
    property_context: { offered_ids: ['unit-202', 'unit-302', 'unit-402', 'unit-502'], focused_ids: ['unit-502'], pending_question: offered.audit.pending_question },
  }), 'sí, está bien')
  assert.match(accepted.reply, /departamento 502/i)
  assert.match(accepted.reply, /tour\?unidad=502/)
  assert.doesNotMatch(accepted.reply, /departamento 202|departamento 302|departamento 402|cuál de estas/i)
})

test('a new explicit unit replaces the previous focus', () => {
  const q = query('select', { category: 'departamento' })
  const answer = catalogDialogueReply(info(q, {
    property_context: { focused_ids: ['unit-502'], pending_question: { target_ids: ['unit-502'] } },
    referencia_unidad: { query: q, reason: 'semantic_explicit', explicit: true, matches: [catalogue.find(unit => unit.unit_number === '202')] },
  }), 'prefiero el 202')
  assert.deepEqual(answer.audit.selected_unit_ids, ['unit-202'])
  assert.match(answer.reply, /unidad=202/)
  assert.doesNotMatch(answer.reply, /502/)
})

test('unknown measurements and unavailable units cannot win a ranking', () => {
  const q = query('rank', { category: 'departamento', selector: 'largest' })
  const filtered = filterCatalog([...catalogue, { ...unit('999', 'departamento', 3, 900, 0, 9), status: 'vendido' }], q)
  assert.equal(filtered.some(unit => unit.unit_number === '999'), false)
  const ranked = rankCatalog([...filtered, unit('998', 'departamento', 3, null, 0, 9)], 'largest')
  assert.equal(ranked.complete, false)
  assert.deepEqual(ranked.units, [])
  assert.deepEqual(ranked.unknown_unit_ids, ['unit-998'])
})

test('comparison reports missing area rather than inventing a complete range', () => {
  const compared = compareCatalog([catalogue[1], { ...catalogue[2], area_internal_m2: null }])
  assert.equal(compared.interior.complete, false)
  assert.equal(compared.interior.same, false)
  assert.equal(compared.interior.min, null)
})

test('an unavailable requested number of bedrooms is preserved and not silently reduced', () => {
  const answer = catalogDialogueReply(info(query('search', { category: 'departamento', filters: { bedrooms: 5 } })), 'no tienen opciones de5habiataciones')
  assert.match(answer.reply, /no contamos con departamentos disponibles de 5 dormitorios/)
  assert.equal(answer.audit.catalog_query.filters.bedrooms, 5)
  assert.equal(answer.audit.original_query.filters.bedrooms, 5)
  assert.equal(answer.audit.pending_question.act, 'explore_alternatives')
  assert.equal(answer.audit.pending_question.proposed_query.filters.bedrooms, 3)
  assert.equal(answer.audit.original_query.category, 'departamento')
  assert.equal(answer.audit.pending_question.proposed_query.category, null)
  assert.deepEqual(answer.audit.pending_question.candidate_ids, ['unit-202', 'unit-302', 'unit-402', 'unit-502', 'unit-602'])
  assert.deepEqual(answer.audit.selected_unit_ids, [])
  const required = catalogDialogueReply(info(query('search', { category: 'departamento', filters: { bedrooms: 5, bedrooms_required: true } })))
  assert.doesNotMatch(required.reply, /alternativas|penthouses|gustaría/)
})

test('seven mixed apartments are compared by shared characteristics with their floor differences', () => {
  const answer = catalogDialogueReply(info(query('compare', { category: 'departamento' })), 'y cual es diferencia entre cada uno?')
  assert.match(answer.reply, /Se diferencian en los dormitorios, la superficie interior y la superficie exterior/)
  assert.match(answer.reply, /Departamentos 202, 302, 402 y 502: 3 dormitorios, 120,83 m² interiores, 27,03 m² exteriores/)
  assert.match(answer.reply, /Departamentos 304, 404 y 504: 2 dormitorios, 109,69 m² interiores, 34,59 m² exteriores/)
  assert.match(answer.reply, /La planta cambia:/)
  assert.match(answer.reply, /departamento 202 en 2\.ª planta/)
  assert.match(answer.reply, /departamentos 502 y 504 en 5\.ª planta/)
  assert.equal((answer.reply.match(/120,83/g) || []).length, 1)
  assert.equal((answer.reply.match(/109,69/g) || []).length, 1)
  assert.equal(answer.audit.catalog_comparison.groups.length, 2)
  assert.deepEqual(answer.audit.catalog_comparison.groups[0].unit_ids, ['unit-202', 'unit-302', 'unit-402', 'unit-502'])
  assert.deepEqual(answer.audit.catalog_coverage.known_fields, ['bedrooms', 'area_internal_m2', 'area_exterior_m2', 'floor_number'])
  assert.equal(answer.audit.catalog_coverage.status, 'answered')
  assert.equal(answer.audit.coverage_complete, false) // Other requests, such as pet policy, still need review.
  assert.equal(validateCatalogReply(answer.reply, answer.audit).valid, true)
})

test('equal interior and exterior areas do not hide the different floors', () => {
  const answer = catalogDialogueReply(info(query('compare', { category: 'departamento', filters: { bedrooms: 3 } })), 'que diferencia hay entre los de tres dormitorios?')
  assert.match(answer.reply, /misma superficie interior: 120,83 m²/)
  assert.match(answer.reply, /La planta cambia:/)
  for (const code of ['202', '302', '402', '502']) assert.match(answer.reply, new RegExp(`departamento ${code} en ${code[0]}\\.ª planta`))
  assert.deepEqual(answer.audit.catalog_comparison.differences, [{ field: 'floor_number', values: [2, 3, 4, 5] }])
  assert.equal(validateCatalogReply(answer.reply, answer.audit).valid, true)
})

test('category choices describe characteristics instead of giving only unit numbers', () => {
  for (const operation of ['search', 'select']) {
    const answer = catalogDialogueReply(info(query(operation, { category: 'departamento' })), 'departamentos')
    assert.match(answer.reply, /3 dormitorios, 120,83 m² interiores/)
    assert.match(answer.reply, /2 dormitorios, 109,69 m² interiores/)
    assert.match(answer.reply, /La planta cambia:/)
    assert.equal(answer.audit.offered_unit_ids.length, 7)
    assert.deepEqual(answer.audit.selected_unit_ids, [])
    assert.equal(validateCatalogReply(answer.reply, answer.audit).valid, true)
  }
})

test('collective references bind every unit to its bedroom count and surface', () => {
  const answer = catalogDialogueReply(info(query('compare', { category: 'departamento' })))
  const correct = 'Los departamentos 202, 302, 402 y 502 tienen 3 dormitorios, 120,83 m² interiores y 27,03 m² exteriores; los departamentos 304, 404 y 504 tienen 2 dormitorios, 109,69 m² interiores y 34,59 m² exteriores.'
  assert.equal(validateCatalogReply(correct, answer.audit).valid, true)
  for (const wrong of [
    'Los departamentos 202, 302, 402 y 502 tienen 2 dormitorios, 109,69 m² interiores y 34,59 m² exteriores; los departamentos 304, 404 y 504 tienen 3 dormitorios, 120,83 m² interiores y 27,03 m² exteriores.',
    'Los departamentos 202, 302 y 304 tienen 3 dormitorios y 120,83 m² interiores.',
    'Los departamentos 202 y 304 tienen 120,83 m² interiores.',
    'Los 202, 302, 402 y 502 tienen 2 dormitorios y 109,69 m² interiores.',
    'Las suites 202, 302 y 402 tienen 3 dormitorios.',
    'Los departamentos 202 y 999 tienen 3 dormitorios.',
    'Los departamentos 202 y 302 están en quinta planta alta.',
  ]) assert.equal(validateCatalogReply(wrong, answer.audit).valid, false, wrong)
  assert.equal(validateCatalogReply('Los departamentos 502 y 504 están en quinta planta alta.', answer.audit).valid, true)
  const withBathrooms = catalogDialogueReply(info(query('compare', { category: 'departamento' }), {
    catalogo: catalogue.map(value => ({ ...value, bathrooms_full: value.bedrooms === 3 ? 3 : 2 })),
  }))
  assert.equal(validateCatalogReply('Los departamentos 202 y 304 tienen 3 baños completos.', withBathrooms.audit).valid, false)
})

test('derived dimensions require explicit verified derivations, even if a number occurs elsewhere', () => {
  const answer = catalogDialogueReply(info(query('compare', { category: 'departamento' })))
  for (const wrong of [
    'Los departamentos de 3 dormitorios tienen 11,14 m² interiores más.',
    'Los departamentos de 3 dormitorios tienen 120,83 m² interiores más.',
  ]) assert.equal(validateCatalogReply(wrong, answer.audit).valid, false, wrong)
})

test('comparison coverage marks only complete known fields and accepts a verified ground floor', () => {
  const local = [unit('001', 'local', null, 80, null, 0), unit('002', 'local', null, 80, null, 0)]
  const answer = catalogDialogueReply(info(query('compare', { group: 'commercial', category: 'local' }), { catalogo: local }))
  assert.deepEqual(answer.audit.catalog_coverage.known_fields, ['area_internal_m2', 'floor_number'])
  assert.equal(answer.audit.catalog_comparison.exterior.complete, false)
  assert.match(answer.reply, /superficie exterior está pendiente de verificación/)
})

test('catalogue facts stay protected while additional requests remain eligible for coverage', () => {
  const answer = catalogDialogueReply(info(query('compare', { category: 'departamento', filters: { bedrooms: 3 } })), 'son iguales y admiten mascotas?')
  const plan = responsePlan(answer.reply, answer.audit)
  assert.equal(plan.locked, false)
  assert.equal(plan.protected_facts.length, 4)
  assert.deepEqual(plan.covered_requests, ['catalog_compare'])
  assert.equal(responsePlan('¿Qué unidad?', { source: 'property_reference_clarification' }).locked, false)
  assert.equal(responsePlan('Tenemos departamentos.', { source: 'property_category_selected' }).locked, false)
})

test('the current operation cannot be revived from saved filters or execute during a financing turn', () => {
  assert.equal(catalogDialogueReply(info(query('none', { category: 'departamento', filters: { bedrooms: 3 } }))), null)
  assert.equal(catalogDialogueReply(info(query('compare'), { semantica_turno: { primary_intent: 'ask_financing' } })), null)
})

test('rewrites cannot attach a two-bedroom area to the three-bedroom result', () => {
  const answer = catalogDialogueReply(info(query('compare', { category: 'departamento', filters: { bedrooms: 3 } })))
  assert.deepEqual(validateCatalogReply(answer.reply, answer.audit), { valid: true })
  for (const reply of [
    'Los departamentos de 3 dormitorios tienen de 109,69 a 120,83 m² interiores.',
    'El departamento 502 tiene 109.69 m² interiores.',
    'El departamento 502 tiene 2 dormitorios y 120,83 m² interiores.',
    'El penthouse 502 tiene 120,83 m² interiores.',
    'El departamento 504 tiene 120,83 m² interiores.',
    'El departamento 502 tiene 109,69 m² interiores, ¿le gustaría conocerlo?',
  ]) assert.equal(validateCatalogReply(reply, answer.audit).valid, false, reply)
})

test('catalogue validation leaves unrelated verified answers and questions available', () => {
  const answer = catalogDialogueReply(info(query('compare', { category: 'departamento', filters: { bedrooms: 3 } })))
  for (const additional of [
    ' También podemos revisar financiamiento con Banco Pichincha o Cooperativa JEP.',
    ' El precio referencial es de USD 250.000. Las condiciones para mascotas deben verificarse.',
    ' ¿Necesita cinco dormitorios?',
  ]) assert.equal(validateCatalogReply(answer.reply + additional, answer.audit).valid, true, additional)
})

test('a mixed catalogue answer still checks each category-bedroom relationship independently', () => {
  const answer = catalogDialogueReply(info(query('search')))
  assert.equal(validateCatalogReply(answer.reply, answer.audit).valid, true)
  assert.equal(validateCatalogReply('Los departamentos de 3 dormitorios tienen 109,69 m² interiores.', answer.audit).valid, false)
  assert.equal(validateCatalogReply('El departamento 202 tiene 109,69 m² interiores y el departamento 304 tiene 120,83 m² interiores.', answer.audit).valid, false)
})

test('a rewrite cannot remove or broaden the question that focuses a specific unit', () => {
  const answer = catalogDialogueReply(info(query('search', { category: 'departamento', filters: { floor_number: 5, bedrooms: 3 } })))
  assert.equal(validateCatalogReply(answer.reply, answer.audit).valid, true)
  assert.equal(validateCatalogReply(answer.reply.replace(answer.audit.pending_question.question, '¿Cuál de todas las opciones prefiere?'), answer.audit).valid, false)
  assert.equal(validateCatalogReply(answer.reply.replace(answer.audit.pending_question.question, ''), answer.audit).valid, false)
})

test('a fresh conversation carries housing, catalogue ranking, three-bedroom comparison, fifth floor and 502 acceptance through real memory', () => {
  let summary = {}, history = [], pending = {}
  const run = (current, property, primary = 'project_information', answer = {}) => {
    const semantics = normalizeTurnSemantics({ turn_semantics: {
      primary_intent: primary, primary_evidence: current, confidence: 'high',
      property: { ...property, evidence: current, confidence: 'high' },
      answer_to_previous: answer,
    } }, current, pending)
    const reference = resolvePropertyTurn(catalogue, current, summary, history, semantics)
    const result = catalogDialogueReply({ catalogo: catalogue, semantica_turno: semantics, referencia_unidad: reference, property_context: reference.context, historial: history }, current)
    assert.ok(result, current)
    assert.equal(validateCatalogReply(result.reply, result.audit).valid, true, result.reply)
    summary = { _property_context: rememberPropertyReply(catalogue, reference.context, result.reply, result.audit), _unit_reference: reference.memory }
    pending = result.audit.pending_question
    history = [...history, { role: 'cliente', content: current }, { role: 'bot', content: result.reply }]
    return result
  }
  const broad = run('me interesa vivienda', { category: 'departamento', operation: 'select' }, 'select_property')
  assert.match(broad.reply, /suites de 1 dormitorio/)
  const largest = run('cuál es el departamento más grande?', { category: 'departamento', operation: 'rank', selector: 'largest', query_scope: 'catalog' })
  assert.deepEqual(largest.audit.selected_unit_ids, [])
  assert.equal(largest.audit.catalog_ranking.unit_ids.length, 4)
  const comparison = run('los de 3 dormitorios tienen el mismo tamaño?', { category: 'departamento', operation: 'compare', filters: { bedrooms: 3 }, query_scope: 'catalog' })
  assert.match(comparison.reply, /misma superficie interior: 120[.,]83/)
  assert.doesNotMatch(comparison.reply, /109[.,]69/)
  const floor = run('5ta planta', { operation: 'search', filters: { floor_number: 5 } }, 'answer_previous')
  assert.deepEqual(floor.audit.focused_unit_ids, ['unit-502'])
  const accepted = run('sí, está bien', { operation: 'none' }, 'answer_previous', { question_id: 'unit_choice', kind: 'affirmative', evidence: 'sí, está bien', confidence: 'high' })
  assert.match(accepted.reply, /unidad=502/)
  assert.doesNotMatch(accepted.reply, /unidad=202|cuál de estas/i)
})

test('five bedrooms, accepting available alternatives and refining the category preserves the accepted three-bedroom search', () => {
  let summary = {}, pending = {}, history = []
  const run = (current, property, primary = 'project_information', answer = {}) => {
    const semantics = normalizeTurnSemantics({ turn_semantics: {
      primary_intent: primary, primary_evidence: current, confidence: 'high',
      property: { ...property, evidence: current, confidence: 'high' }, answer_to_previous: answer,
    } }, current, pending)
    const reference = resolvePropertyTurn(catalogue, current, summary, history, semantics)
    const result = catalogDialogueReply({ catalogo: catalogue, semantica_turno: semantics, referencia_unidad: reference, property_context: reference.context, historial: history }, current)
    assert.ok(result, current)
    assert.equal(validateCatalogReply(result.reply, result.audit).valid, true, result.reply)
    summary = { _property_context: rememberPropertyReply(catalogue, reference.context, result.reply, result.audit), _unit_reference: reference.memory }
    pending = result.audit.pending_question
    history = [...history, { role: 'cliente', content: current }, { role: 'bot', content: result.reply }]
    return result
  }
  const requested = run('busco vivienda de cinco habitaciones', { group: 'residential', operation: 'search', filters: { bedrooms: 5 } })
  assert.match(requested.reply, /departamentos de 3 dormitorios, con hasta 120[.,]83 m² interiores/i)
  assert.match(requested.reply, /penthouses de 3 dormitorios, con hasta 142[.,]09 m² interiores/i)
  assert.equal(requested.audit.original_query.filters.bedrooms, 5)
  assert.equal(pending.proposed_query.filters.bedrooms, 3)
  const accepted = run('si esta bien', { operation: 'none' }, 'answer_previous', { question_id: 'property_category', kind: 'affirmative', evidence: 'si esta bien', confidence: 'high' })
  assert.equal(accepted.audit.catalog_query.filters.bedrooms, 3)
  assert.deepEqual(accepted.audit.selected_unit_ids, [])
  assert.ok(accepted.audit.catalog_results.units.every(value => value.bedrooms === 3))
  assert.match(accepted.reply, /120[.,]83 m² interiores/)
  assert.match(accepted.reply, /142[.,]09 m² interiores/)
  assert.match(accepted.reply, /primero departamentos o penthouses/)
  assert.doesNotMatch(accepted.reply, /202|302|402|502|602|baños|exteriores|planta/i)
  assert.equal(accepted.audit.pending_question.act, 'choose_category')
  const narrowed = run('departamentos', { category: 'departamento', operation: 'select' }, 'select_property')
  assert.equal(narrowed.audit.catalog_query.filters.bedrooms, 3)
  assert.equal(narrowed.audit.catalog_results.units.length, 4)
  assert.ok(narrowed.audit.catalog_results.units.every(value => value.category === 'departamento' && value.bedrooms === 3))
  assert.deepEqual(narrowed.audit.selected_unit_ids, [])
  assert.equal(summary._property_context.original_query.filters.bedrooms, 5)
})

test('approved bedroom alternatives preserve category maxima through validation and respect exclusions and exact requirements', () => {
  const q = query('search', { category: 'departamento', filters: { bedrooms: 5 } })
  const result = catalogDialogueReply(info(q))
  assert.match(result.reply, /120[.,]83 m² interiores/)
  assert.match(result.reply, /142[.,]09 m² interiores/)
  assert.equal(validateCatalogReply(result.reply, result.audit).valid, true)
  assert.equal(validateCatalogReply('No contamos con departamentos de 5 dormitorios. Hay alternativas de 3 dormitorios.', result.audit).reason, 'alternative_area_omitted')
  assert.equal(validateCatalogReply(result.reply + ' Suites de 1 dormitorio.', result.audit).valid, false)
  assert.equal(validateCatalogReply(result.reply + ' Departamentos 202, 302, 402 y 502.', result.audit).reason, 'alternative_unit_list_premature')
  const excluded = catalogDialogueReply(info(q, { semantica_turno: { property: { excluded_categories: ['penthouse'] } } }))
  assert.doesNotMatch(excluded.reply, /penthouses|142[.,]09/)
  const exact = catalogDialogueReply(info(query('search', { category: 'departamento', filters: { bedrooms: 5, bedrooms_required: true } })))
  assert.doesNotMatch(exact.reply, /alternativas|120[.,]83|142[.,]09/)
  const incomplete = catalogue.map(unit => unit.unit_number === '602' ? { ...unit, area_internal_m2: null } : unit)
  const partial = catalogDialogueReply({ ...info(q), catalogo: incomplete })
  assert.doesNotMatch(partial.reply, /142[.,]09/)
})

test('accepting alternatives to a five-bedroom apartment does not silently restore the old category on another yes', () => {
  let summary = {}, history = [], pending = {}
  for (const [index, current] of ['No tiene departamentos de 5 habitaciones?', 'si esta bien', 'si esta bien'].entries()) {
    const semantics = normalizeTurnSemantics({ turn_semantics: {
      primary_intent: index ? 'answer_previous' : 'select_property', confidence: 'high', primary_evidence: current,
      property: { group: 'residential', operation: index ? 'none' : 'search', category: index ? null : 'departamento',
        filters: index ? {} : { bedrooms: 5 }, evidence: current, confidence: 'high' },
      answer_to_previous: index ? { question_id: pending.id, kind: 'affirmative', evidence: current, confidence: 'high' } : {},
    } }, current, pending)
    const reference = resolvePropertyTurn(catalogue, current, summary, history, semantics)
    const result = catalogDialogueReply({ catalogo: catalogue, referencia_unidad: reference, property_context: reference.context, semantica_turno: semantics }, current)
    assert.equal(validateCatalogReply(result.reply, result.audit).valid, true)
    assert.match(result.reply, /120[.,]83/)
    assert.match(result.reply, /142[.,]09/)
    if (index) {
      assert.equal(result.audit.catalog_query.category, null)
      assert.equal(result.audit.pending_question.act, 'choose_category')
      assert.deepEqual(result.audit.selected_unit_ids, [])
      assert.doesNotMatch(result.reply, /202|302|402|502|602|planta|exteriores/)
    }
    summary = { _property_context: rememberPropertyReply(catalogue, reference.context, result.reply, result.audit) }
    history.push({ role: 'cliente', content: current }, { role: 'bot', content: result.reply })
    pending = result.audit.pending_question
  }
})

test('a category selection followed by differences compares the seven offered apartments through real memory', () => {
  const current = 'departamentos'
  const semantics = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'select_property', confidence: 'high', primary_evidence: current,
    property: { category: 'departamento', operation: 'select', evidence: current, confidence: 'high' } } }, current)
  const reference = resolvePropertyTurn(catalogue, current, {}, [], semantics)
  const first = catalogDialogueReply({ catalogo: catalogue, semantica_turno: semantics, referencia_unidad: reference, property_context: reference.context }, current)
  const summary = { _property_context: rememberPropertyReply(catalogue, reference.context, first.reply, first.audit), _unit_reference: reference.memory }
  const next = 'y cual es diferencia entre cada uno?'
  const nextSemantics = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'project_information', confidence: 'high', primary_evidence: next,
    property: { operation: 'compare', query_scope: 'offered', evidence: next, confidence: 'high' } } }, next, first.audit.pending_question)
  const nextReference = resolvePropertyTurn(catalogue, next, summary, [{ role: 'cliente', content: current }, { role: 'bot', content: first.reply }], nextSemantics)
  const compared = catalogDialogueReply({ catalogo: catalogue, semantica_turno: nextSemantics, referencia_unidad: nextReference, property_context: nextReference.context }, next)
  assert.equal(compared.audit.catalog_results.units.length, 7)
  assert.equal(compared.audit.catalog_comparison.groups.length, 2)
  assert.equal(compared.audit.catalog_coverage.status, 'answered')
  assert.match(compared.reply, /Se diferencian en los dormitorios/)
  assert.match(compared.reply, /La planta cambia:/)
  assert.equal(validateCatalogReply(compared.reply, compared.audit).valid, true)
})
