import test from 'node:test'
import assert from 'node:assert/strict'
import fixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { normalizeEvents } from './conversation-rules'
import { confirmedInterpretationMemory } from './interpretation-memory'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { nextDiscoveryQuestion } from './sdr-rules'
import { isAssetOnlyPurposeEvidence, isPassiveProfilePurposeEvidence } from './purchase-evidence'

function extraction(current: string, group: string, purpose: string, category: string | null = null): Row {
  const raw: Row = structuredClone(fixture)
  raw.full_name = raw.residence_city = raw.residence_country = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.preferred_category = category; raw.purchase_purpose = purpose
  raw.events = ['declared_purchase_purpose', ...(category ? ['declared_unit_type'] : [])]
  raw.declaration_evidence = { preferred_category: category ? current : null, purchase_purpose: current }
  const semantics = object(raw.turn_semantics)
  semantics.primary_intent = 'select_property'; semantics.primary_evidence = current
  semantics.answer_to_previous = { question_id: 'none', kind: 'none', evidence: '', confidence: 'low' }
  Object.assign(object(semantics.property), { group, category, operation: 'search', evidence: current, confidence: 'high' })
  return raw
}

test('choosing an asset or physical requirements cannot additionally declare its intended use', async () => {
  for (const [current, group, category, assumedPurpose] of [
    ['busco algo para vivienda', 'residential', null, 'vivir'],
    ['Me interesa un departamento', 'residential', 'departamento', 'vivir'],
    ['Quiero tres dormitorios', 'residential', null, 'vivir'],
    ['Quiero vivienda en la segunda planta', 'residential', null, 'vivir'],
    ['Vivo en Cuenca y busco vivienda', 'residential', null, 'vivir'],
    ['Prefiero un local comercial', 'commercial', 'local', 'negocio'],
    ['Busco un local', 'commercial', 'local', 'invertir'],
  ] as const) {
    const raw = extraction(current, group, assumedPurpose, category), original = structuredClone(raw)
    assert.equal(isAssetOnlyPurposeEvidence(raw, {}, current), true, current)
    assert.equal(normalizeEvents(raw, current).purchase_purpose, null, current)
    let calls = 0
    const result = await interpretConversationTurn({ mensaje_actual: current }, {
      activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw },
    })
    assert.equal(calls, 1)
    assert.equal(result.extracted.purchase_purpose, null, current)
    assert.equal((result.extracted.events as string[]).includes('declared_purchase_purpose'), false)
    assert.equal(object(result.semantics.property).group, group)
    assert.equal(result.extracted.preferred_category, category)
    assert.deepEqual(raw, original)
    const remembered = rememberInterpretedTurn({}, current, result.extracted, result.semantics)
    assert.equal(object(remembered.datos_confirmados).proposito, undefined)
    assert.equal(object(confirmedInterpretationMemory(remembered).property).group, group)
  }
})

test('declared future uses remain independent from their housing or commercial group', async () => {
  for (const [current, group, category, purpose] of [
    ['Busco una vivienda para vivir', 'residential', null, 'vivir'],
    ['Quiero un departamento para alquilarlo a terceros', 'residential', 'departamento', 'invertir'],
    ['Quiero un local comercial para mi negocio', 'commercial', 'local', 'negocio'],
    ['Quiero un local para abrir una panadería', 'commercial', 'local', 'negocio'],
    ['Busco una vivienda para mis vacaciones', 'residential', null, 'segunda_vivienda'],
    ['Quiero una segunda vivienda', 'residential', null, 'segunda_vivienda'],
    ['Vivo en Cuenca y busco una vivienda para invertir', 'residential', null, 'invertir'],
  ] as const) {
    const raw = extraction(current, group, purpose, category)
    assert.equal(isAssetOnlyPurposeEvidence(raw, {}, current), false, current)
    const result = await interpretConversationTurn({ mensaje_actual: current }, {
      activePrompt: async () => 'Extract', aiJson: async () => raw,
    })
    assert.equal(result.extracted.purchase_purpose, purpose, current)
    assert.ok((result.extracted.events as string[]).includes('declared_purchase_purpose'))
    assert.equal(object(result.semantics.property).group, group)
  }
})

test('category-only novelty preserves a previously declared investment purpose', async () => {
  const current = 'busco algo para vivienda', raw = extraction(current, 'residential', 'vivir')
  const previous = { datos_confirmados: { proposito: 'invertir' } }
  const result = await interpretConversationTurn({ mensaje_actual: current, resumen: previous }, {
    activePrompt: async () => 'Extract', aiJson: async () => raw,
  })
  const remembered = rememberInterpretedTurn(previous, current, result.extracted, result.semantics)
  assert.equal(object(remembered.datos_confirmados).proposito, 'invertir')
  assert.equal(object(confirmedInterpretationMemory(remembered).property).group, 'residential')
})

test('an acknowledgement accepts the offered asset without also filling purchase purpose', () => {
  const current = 'Sí, me parece bien', raw = extraction(current, 'residential', 'vivir', 'departamento')
  const pending = { id: 'property_category', act: 'choose_category', question: '¿Le gustaría que exploremos los departamentos?' }
  object(raw.turn_semantics).answer_to_previous = { question_id: pending.id, kind: 'affirmative', evidence: current, confidence: 'high' }
  assert.equal(normalizeEvents(raw, current, false, pending).purchase_purpose, null)
})

test('an explicit or elliptical answer to the real intended-use question remains valid', () => {
  const pending = { id: 'property_purpose', act: 'choose', question: '¿Lo busca para vivir o como inversión?' }
  for (const [current, purpose] of [['Para invertir', 'invertir'], ['Vivir', 'vivir'], ['Para arrendarlo', 'invertir']] as const) {
    const raw = extraction(current, 'residential', purpose)
    object(raw.turn_semantics).answer_to_previous = { question_id: pending.id, kind: 'value', evidence: current, confidence: 'high' }
    assert.equal(normalizeEvents(raw, current, false, pending).purchase_purpose, purpose)
  }
})

test('discovery separates a neutral asset choice from later intended-use collection', () => {
  assert.equal(nextDiscoveryQuestion({}).question, '¿Le interesa una vivienda o un local comercial?')
  assert.equal(nextDiscoveryQuestion({ preferred_category: 'departamento' }).key, 'proposito')
  assert.equal(nextDiscoveryQuestion({ preferred_category: 'local' }).key, 'proposito')
  assert.equal(nextDiscoveryQuestion({ preferred_category: 'local', purchase_purpose: 'invertir' }).key, 'prioridad')
})

test('combined current name and residence cannot establish a future purchase purpose', async () => {
  const pending = { id: 'lead_profile', act: 'profile', question: '¿Cómo se llama y dónde reside actualmente?' }
  for (const [current, name, nameQuote] of [
    ['Claro, soy carlos y vivo en cuenca', 'carlos', 'Claro, soy carlos y vivo en cuenca'],
    ['Mi nombre es Ana María y resido en Quito', 'Ana María', 'Ana María'],
    ['Me llamo Luis y actualmente vivo en Guayaquil', 'Luis', 'Me llamo Luis'],
  ]) {
    const raw = extraction(current, 'residential', 'vivir')
    raw.full_name = name; raw.residence_city = current.endsWith('Quito') ? 'Quito' : current.endsWith('Guayaquil') ? 'Guayaquil' : 'Cuenca'
    raw.profile_evidence = { full_name: nameQuote, residence_city: current, residence_country: null }
    Object.assign(object(raw.turn_semantics), { primary_intent: 'answer_previous', answer_to_previous: {
      question_id: pending.id, kind: 'affirmative', evidence: current, confidence: 'high' } })
    object(object(raw.turn_semantics).property).operation = 'none'
    assert.equal(isPassiveProfilePurposeEvidence(raw, pending, current), true, current)
    let calls = 0
    const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: pending }, {
      activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw },
    })
    assert.equal(calls, 1, current)
    assert.equal(result.extracted.purchase_purpose, null, current)
    assert.equal(object(result.semantics.property).group, null)
    assert.ok(!(result.extracted.events as string[]).includes('declared_purchase_purpose'))
    const previous = { datos_confirmados: { proposito: 'invertir' } }
    const remembered = rememberInterpretedTurn(previous, current, result.extracted, result.semantics)
    assert.equal(object(remembered.datos_confirmados).proposito, 'invertir')
  }
})

test('profile clauses do not erase an independent asset or future-use declaration in the same citation', async () => {
  const pending = { id: 'lead_profile', act: 'profile', question: '¿Cómo se llama y dónde reside actualmente?' }
  for (const [tail, group, category, expectedPurpose] of [
    ['y busco vivienda', 'residential', null, null],
    ['y quiero una vivienda para invertir', 'residential', null, 'invertir'],
    ['pero lo quiero para vacaciones', 'residential', null, 'segunda_vivienda'],
    ['pero sería para arrendarlo', 'residential', null, 'invertir'],
    ['y busco un local para abrir una panadería', 'commercial', 'local', 'negocio'],
  ] as const) {
    const current = 'Soy Carlos y vivo en Cuenca '+tail
    const raw = extraction(current, group, expectedPurpose || 'vivir', category)
    raw.full_name = 'Carlos'; raw.residence_city = 'Cuenca'
    raw.profile_evidence = { full_name: current, residence_city: current, residence_country: null }
    object(raw.turn_semantics).answer_to_previous = {
      question_id: pending.id, kind: 'value', evidence: current, confidence: 'high' }
    assert.equal(isPassiveProfilePurposeEvidence(raw, pending, current), false, current)
    const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: pending }, {
      activePrompt: async () => 'Extract', aiJson: async () => raw,
    })
    assert.equal(result.extracted.purchase_purpose, expectedPurpose, current)
    assert.equal(result.extracted.preferred_category, category, current)
    assert.equal(object(result.semantics.property).group, group, current)
  }
})
