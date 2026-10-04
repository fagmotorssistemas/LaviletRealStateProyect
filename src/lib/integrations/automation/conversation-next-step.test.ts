import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { unresolvedChoice, needsPropertyPurpose } from './conversation-next-step'
import { resolvePropertyTurn } from './property-context'
import { taskVerifiedContext, taskModelEvidence, addTaskQueryEvidence } from './task-context'
import { turnEvidence } from './turn-evidence'
import { reviewObligations } from './focused-review'
import { compactTurnPromptContext } from './turn-prompt-context'
import { commercialReply } from './sdr'
import { rememberPropertyReply } from './property-context'

const units = [
  { id: 'local', unit_number: 'LC1', category: 'local', published_commercial_price: 145000 },
  { id: 'suite', unit_number: 'S1', category: 'suite', bedrooms: 1, published_commercial_price: 210000 },
  ...[250000, 270000, 290000, 310000].map((price, i) => ({ id: `d${i + 2}02`, unit_number: `${i + 2}02`,
    category: 'departamento', bedrooms: 3, floor_number: i + 2, published_commercial_price: price })),
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6, published_commercial_price: 550000 },
]
const info = (): Row => ({ catalogo: units, catalog_search: { embeddingsEnabled: true },
  politica_comercial: { precios_autorizados: true }, property_context: {},
  semantica_turno: { primary_intent: 'project_information', property: { operation: 'none', reference_kind: 'none' } },
  solicitudes_interpretadas: [{ domain: 'property', request: 'Qué ofrece el proyecto' }] })

test('a broad offer retains all category ranges without sending every unit to the models', () => {
  const input = info(), before = structuredClone(input)
  const verified = taskVerifiedContext(input, { source: 'catalog_details' }, '¿Qué más ofrece?')
  assert.equal(object(verified.prompt_context_selection).task, 'catalog_overview')
  const evidence = turnEvidence(verified), model = taskModelEvidence(evidence, verified)
  assert.equal(model.units.length, 0)
  const range = model.groups.find(g => g.id === 'group:context:all:range')!
  assert.equal(range.published_commercial_price, 145000)
  assert.equal(object(range.upper_values).published_commercial_price, 550000)
  for (const category of ['suite', 'departamento', 'penthouse', 'local'])
    assert.ok(model.groups.some(g => String(g.id).includes(`group:${category}:`)), category)
  assert.deepEqual(input, before)
  assert.equal(evidence.units.length, units.length, 'Full canonical evidence remains available to validation.')
  const off = { ...input, catalog_search: { embeddingsEnabled: false } }
  assert.equal(taskVerifiedContext(off, {}, '¿Qué ofrece?'), off)
})

test('a concrete feature request cannot be reduced to a generic price overview', () => {
  const input = info()
  object(input.semantica_turno).catalog_request = { purpose: 'search', requirements: [
    { field: 'spaces', operator: 'contains', value: 'terraza', strength: 'required' },
  ] }
  const verified = taskVerifiedContext(input, {}, '¿Qué tiene con terraza?')
  assert.equal(object(verified.prompt_context_selection).task, 'property')
  assert.equal(taskModelEvidence(turnEvidence(verified), verified).units.length, units.length)
})

test('quoting the overall price range does not turn the entire catalogue into a comparison', async () => {
  const input = { ...info(), alcance_negocio: 'property', historial: [],
    semantica_turno: { primary_intent: 'ask_price', confidence: 'high', property: { operation: 'none', reference_kind: 'none' } } }
  const result = await commercialReply(input, '¿Qué precio tiene?', {}, async () => ({}))
  assert.equal(result.audit.source, 'unit_price')
  assert.deepEqual(result.audit.comparison_unit_ids, [])
  const saved = rememberPropertyReply(units, {}, result.reply, result.audit)
  assert.deepEqual(saved.comparison_ids || [], [])
})

test('a fresh budget query excludes historical comparison units outside its price scope', () => {
  const input = info()
  input.property_context = { query: { group: 'residential', category: 'departamento', operation: 'search', requirements: [
    { field: 'published_commercial_price', operator: 'lte', value: 300000, strength: 'required' },
  ] }, comparison_ids: units.map(u => u.id), selected_ids: [] }
  const verified = taskVerifiedContext(input, {}, 'Para mi familia, hasta 300 mil')
  const canonical = addTaskQueryEvidence(turnEvidence(verified), verified)
  const model = taskModelEvidence(canonical, verified)
  assert.deepEqual(model.units.map(u => u.id), ['d202', 'd302', 'd402'])
  const range = model.groups.find(g => g.id === 'group:task_query:departamento:3:range')!
  assert.equal(range.floor_number, 2)
  assert.equal(object(range.upper_values).floor_number, 4)
  assert.equal(range.published_commercial_price, 250000)
  assert.equal(object(range.upper_values).published_commercial_price, 290000)
  assert.ok(model.units.every(u => u.query_role === 'current_query'))
  assert.equal(canonical.units.length, units.length)
})

test('an explicitly selected higher-priced unit remains available but is labelled outside the current query', () => {
  const input = info()
  input.property_context = { query: { group: 'residential', operation: 'search', requirements: [
    { field: 'published_commercial_price', operator: 'lte', value: 300000, strength: 'required' },
  ] }, selected_ids: ['d502'] }
  const verified = taskVerifiedContext(input, {}, 'Compare con mi presupuesto')
  assert.equal(taskModelEvidence(turnEvidence(verified), verified).units.find(u => u.id === 'd502')?.query_role, 'related_option')
})

test('general prices have a commercial next question, but known purpose and profile capture take precedence', () => {
  const input = { ...info(), contrato_turno: { objective: 'ask_price' } }
  assert.equal(needsPropertyPurpose(input, {}, {}), true)
  assert.ok(reviewObligations({}, input, {}).some(o => o.id === 'property_purpose'))
  for (const purpose of ['vivir', 'segunda_vivienda', 'negocio'])
    assert.equal(needsPropertyPurpose({ ...input, lead: { purchase_purpose: purpose } }, {}, {}), false)
  assert.equal(needsPropertyPurpose({ ...input, lead: { purchase_purpose: 'invertir' } }, {}, {}), true,
    'Investment alone does not distinguish housing from commercial property.')
  assert.equal(needsPropertyPurpose({ ...input, property_context: { query: { group: 'residential' } } }, {}, {}), false)
  assert.equal(needsPropertyPurpose(input, {}, { requiere_captura: true }), false)
  assert.equal(needsPropertyPurpose(input, {}, { presentacion_sin_tipos: true }), false)
})

const pending = { id: 'unit_choice', act: 'choose_unit', candidate_ids: ['p602', 'd502'],
  question: '¿Le gustaría conocer más detalles de los penthouses o comparar con departamentos en pisos superiores?' }
test('a bare yes to alternative actions asks which one without selecting a unit or expanding the catalogue', () => {
  for (const answer of ['sí claro', 'Claro que sí', 'de acuerdo', 'sí, por favor']) {
    assert.ok(unresolvedChoice(answer, pending), answer)
    const saved = { pending_question: pending, offered_ids: ['p602', 'd502'], selected_ids: [],
      query: { group: 'residential', operation: 'search' } }
    const reference = resolvePropertyTurn(units, answer, { _property_context: saved }, [], {
      primary_intent: 'answer_previous', confidence: 'high', property: { operation: 'compare', reference_kind: 'followup' },
      answer_to_previous: { kind: 'affirmative', confidence: 'high' },
    })
    assert.equal(reference.reason, 'unresolved_choice')
    assert.equal(reference.needsClarification, true)
    assert.deepEqual(reference.matches, [])
    assert.deepEqual(reference.context.selected_ids, [])
    const audit = { source: 'clarify_previous_choice', choice_clarification: object(reference).choice_clarification }
    const verified = taskVerifiedContext({ ...info(), property_context: reference.context }, audit, answer)
    assert.equal(taskModelEvidence(turnEvidence(verified), verified).units.length, 0)
    assert.ok(reviewObligations(audit, verified, {}).some(o => o.id === 'clarify_previous_choice'))
    const prompt = compactTurnPromptContext({ contexto_verificado: { ...verified, unidades_consultadas: units },
      property_context: reference.context, estado_operativo: audit })
    assert.deepEqual(object(prompt.estado_operativo).choice_clarification, audit.choice_clarification)
    assert.equal(object(prompt.contexto_verificado).unidades_consultadas, undefined)
    assert.equal(object(prompt.contexto_verificado).property_context, undefined)
  }
})

test('a yes to one action and explicit alternative choices keep their existing continuations', () => {
  assert.equal(unresolvedChoice('sí claro', { ...pending, question: '¿Le gustaría conocer el penthouse 602?' }), null)
  assert.equal(unresolvedChoice('sí claro', { id: 'financing_consent', question: '¿Desea continuar con la revisión?' }), null)
  for (const answer of ['Compare ambos', 'Quiero el departamento 502', 'Detalles de los penthouses', 'ambas opciones'])
    assert.equal(unresolvedChoice(answer, pending), null)
})
