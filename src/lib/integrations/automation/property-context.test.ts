import test from 'node:test'
import assert from 'node:assert/strict'
import { resolvePropertyTurn } from './property-context'
import { normalizeTurnSemantics } from './turn-semantics'
import { catalogDialogueReply } from './catalog-dialogue'
import type { Row } from './data'

const units: Row[] = [
  { id: 'u502', unit_number: '502', category: 'departamento', floor_number: 5, bedrooms: 3, area_internal_m2: 120.83, published_commercial_price: 310000 },
  { id: 'u504', unit_number: '504', category: 'departamento', floor_number: 5, bedrooms: 3, area_internal_m2: 110, published_commercial_price: 300000 },
  { id: 'u602', unit_number: '602', category: 'penthouse', floor_number: 6, bedrooms: 3, area_internal_m2: 142.09, published_commercial_price: 550000 },
]
const purpose = { id: 'property_purpose', act: 'other', question: '¿Lo busca para vivir o como inversión?', target_ids: [], candidate_ids: [] }
const saved = (change: Row = {}): Row => ({ version: 2, offered_ids: ['u502'], selected_ids: [], comparison_ids: [], focused_ids: ['u502'],
  pending_question: purpose, query: { group: 'residential', category: 'departamento', operation: 'search', scope: 'catalog', filters: { bedrooms: 3, floor_number: 5 } }, ...change })
const choice = (current: string, pending: Row = purpose, changes: Row = {}) => normalizeTurnSemantics({ turn_semantics: {
  primary_intent: 'select_property', primary_evidence: current, confidence: 'high',
  property: { operation: 'select', reference_kind: 'followup', evidence: current, confidence: 'high', ...changes },
} }, current, pending)

test('a current contextual choice selects the verified focus even when the next question asks its use', () => {
  for (const current of ['si prefiero esa opcion', 'Sí, esa opción me interesa.', 'Me quedo con la alternativa que acabamos de ver.',
    'esa es la que buscaba', 'me decido por esa alternativa', 'la elección de mi familia es esa']) {
    for (const scope of [null, 'offered', 'selected']) {
      const result = resolvePropertyTurn(units, current, { _property_context: saved(), _pending_question: purpose }, [], choice(current, purpose, { query_scope: scope }))
      assert.equal(result.reason, 'explicit_contextual_choice', current)
      assert.equal(result.explicit, true)
      assert.equal(result.needsClarification, false)
      assert.deepEqual(result.context.selected_ids, ['u502'])
      assert.deepEqual(result.context.focused_ids, ['u502'])
      assert.deepEqual(result.matches.map(unit => unit.id), ['u502'])
      assert.equal(result.query.scope, 'selected')
      const reply = catalogDialogueReply({ catalogo: units, referencia_unidad: result, property_context: result.context, politica_comercial: { precios_autorizados: true } }, current)
      assert.deepEqual(reply?.audit.selected_unit_ids, ['u502'])
      assert.doesNotMatch(reply?.reply || '', /cuál de estas opciones|qué unidad/i)
    }
  }
})

test('only the current focused unit or a single current offer can resolve a contextual choice', () => {
  const current = 'Quiero esa opción'
  for (const context of [saved({ focused_ids: [] }), saved({ offered_ids: ['u502', 'u504'] })]) {
    const result = resolvePropertyTurn(units, current, { _property_context: context }, [], choice(current))
    assert.equal(result.reason, 'explicit_contextual_choice')
    assert.deepEqual(result.context.selected_ids, ['u502'])
  }
  for (const context of [saved({ offered_ids: ['u502', 'u504'], focused_ids: [] }), saved({ offered_ids: ['u502', 'u504'], focused_ids: ['u502', 'u504'] })]) {
    const result = resolvePropertyTurn(units, current, { _property_context: context }, [], choice(current))
    assert.equal(result.needsClarification, true)
    assert.deepEqual(result.context.selected_ids, [])
    assert.deepEqual(result.matches.map(unit => unit.id), ['u502', 'u504'])
    const reply = catalogDialogueReply({ catalogo: units, referencia_unidad: result, property_context: result.context }, current)
    assert.deepEqual(reply?.audit.selected_unit_ids, [])
  }
})

test('an affirmative to purpose or financing never becomes a selection through remembered focus', () => {
  for (const pending of [purpose, { id: 'financing_invitation', act: 'financing', question: '¿Desea revisar financiamiento?', target_ids: ['u502'], candidate_ids: ['u502'] }]) {
    for (const current of ['Sí', 'Claro', 'de acuerdo']) {
      // Even an erroneous select/followup extraction needs a current act of
      // choosing; affirmative consent to the previous question is insufficient.
      const result = resolvePropertyTurn(units, current, { _property_context: saved({ pending_question: pending }), _pending_question: pending }, [], choice(current, pending))
      assert.deepEqual(result.context.selected_ids, [], `${pending.id}: ${current}`)
      assert.equal(result.explicit, false)
    }
  }
})

test('retired, ambiguous or outdated focus cannot be substituted by an available offer', () => {
  const current = 'prefiero esa opción'
  const cases = [
    { catalog: units.filter(unit => unit.id !== 'u502'), context: saved({ offered_ids: ['u502', 'u504'] }), reason: 'contextual_choice_unavailable' },
    { catalog: units.map(unit => unit.id === 'u502' ? { ...unit, status: 'reservado' } : unit), context: saved({ offered_ids: ['u502', 'u504'] }), reason: 'contextual_choice_unavailable' },
    { catalog: units, context: saved({ offered_ids: ['u504'] }), reason: 'contextual_choice_incompatible' },
    { catalog: units, context: saved({ offered_ids: ['u602'], focused_ids: ['u602'] }), reason: 'contextual_choice_incompatible' },
    { catalog: units, context: saved({ query: { category: 'departamento', filters: { floor_number: 2 } } }), reason: 'contextual_choice_incompatible' },
  ]
  for (const item of cases) {
    const result = resolvePropertyTurn(item.catalog, current, { _property_context: item.context }, [], choice(current))
    assert.equal(result.reason, item.reason)
    assert.equal(result.needsClarification, true)
    assert.equal(result.explicit, false)
    assert.deepEqual(result.context.selected_ids, [])
    assert.equal(result.matches.some(unit => unit.id === 'u504'), false)
  }
})

test('inherited or missing current evidence cannot authorize a contextual selection', () => {
  const current = 'prefiero esa opción'
  for (const evidence of ['', 'Quiero el departamento 502']) {
    const result = resolvePropertyTurn(units, current, { _property_context: saved() }, [], choice(current, purpose, { evidence }))
    assert.deepEqual(result.context.selected_ids, [])
    assert.equal(result.explicit, false)
  }
  const result = resolvePropertyTurn(units, current, { _property_context: saved() }, [], {
    primary_intent: 'select_property', primary_evidence: 'Quiero el departamento 502', confidence: 'high',
    property: { operation: 'select', reference_kind: 'followup', evidence: current, confidence: 'high' },
  })
  assert.deepEqual(result.context.selected_ids, [])
  assert.equal(result.explicit, false)
})

test('a negative answer cannot authorize the rejected choice while a separate current choice retains its evidence', () => {
  const pending = { id: 'unit_choice', act: 'confirm_unit', question: '¿Desea continuar con esta unidad?', target_ids: ['u502'], candidate_ids: ['u502'] }
  const current = 'No me decido por esa alternativa'
  const rejected = normalizeTurnSemantics({ turn_semantics: {
    primary_intent: 'select_property', primary_evidence: current, confidence: 'high',
    answer_to_previous: { question_id: 'unit_choice', kind: 'negative', evidence: current, confidence: 'high' },
    property: { operation: 'select', reference_kind: 'followup', evidence: current, confidence: 'high' },
  } }, current, pending)
  const result = resolvePropertyTurn(units, current, { _property_context: saved({ pending_question: pending }), _pending_question: pending }, [], rejected)
  assert.deepEqual(result.context.selected_ids, [])
  assert.equal(result.explicit, false)

  const financing = { id: 'financing_invitation', act: 'financing', question: '¿Desea revisar financiamiento?', target_ids: ['u502'], candidate_ids: ['u502'] }
  const mixed = 'No por ahora, pero me decido por esa alternativa'
  const semantic = normalizeTurnSemantics({ turn_semantics: {
    primary_intent: 'select_property', primary_evidence: 'me decido por esa alternativa', confidence: 'high',
    answer_to_previous: { question_id: financing.id, kind: 'negative', evidence: 'No por ahora', confidence: 'high' },
    property: { operation: 'select', reference_kind: 'followup', evidence: 'me decido por esa alternativa', confidence: 'high' },
  } }, mixed, financing)
  const selected = resolvePropertyTurn(units, mixed, { _property_context: saved({ pending_question: financing }), _pending_question: financing }, [], semantic)
  assert.equal(selected.reason, 'explicit_contextual_choice')
  assert.deepEqual(selected.context.selected_ids, ['u502'])
})
