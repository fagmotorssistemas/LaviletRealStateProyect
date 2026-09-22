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
  assert.deepEqual(answer.audit.selected_unit_ids, [])
  const required = catalogDialogueReply(info(query('search', { category: 'departamento', filters: { bedrooms: 5, bedrooms_required: true } })))
  assert.doesNotMatch(required.reply, /alternativas|penthouses|gustaría/)
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
