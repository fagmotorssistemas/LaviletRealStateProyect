import test from 'node:test'
import assert from 'node:assert/strict'
import fixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { normalizeEvents } from './conversation-rules'
import { confirmedInterpretationMemory } from './interpretation-memory'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { normalizeTurnSemantics } from './turn-semantics'
import { isGeneralProjectOverviewWithoutPurchaseScope, isPassiveProfilePurposeEvidence, isPassivePurchaseEvidence } from './purchase-evidence'

const confirmation = { id: 'lead_residence_confirmation', act: 'profile', question: '¿Cuenca es su lugar de residencia actual?',
  residence_candidate: { city: 'Cuenca', country: null, evidence: 'Soy de Cuenca' } }

function extraction(current: string): Row {
  const raw: Row = structuredClone(fixture)
  raw.full_name = raw.residence_city = raw.residence_country = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  const semantics = object(raw.turn_semantics)
  semantics.primary_intent = 'project_information'; semantics.primary_evidence = current
  semantics.answer_to_previous = { question_id: 'none', kind: 'none', evidence: '', confidence: 'low' }
  Object.assign(object(semantics.property), { group: 'residential', evidence: current, confidence: 'high' })
  raw.requests = [{ domain: 'property', topics: ['project_overview'], request: 'Información general', evidence: current, confidence: 'high' }]
  return raw
}

test('greetings around a general project enquiry never declare a residential search', async () => {
  for (const current of ['Saludos, quiero informacion por favor', 'Hola, quisiera información del proyecto por favor',
    'Buenos días, quiero más información', 'Bueno, quiero detalles del proyecto',
    '¿Me puede contar de qué trata el proyecto?', '¿Qué es La Vilet?']) {
    const raw = extraction(current), before = structuredClone(raw)
    let calls = 0
    const result = await interpretConversationTurn({ mensaje_actual: current }, {
      activePrompt: async () => 'Extract', aiJson: async rules => {
        calls++
        assert.ok(rules.includes('SEPARE PERFIL, FINALIDAD Y BÚSQUEDA'))
        return raw
      },
    })
    assert.equal(calls, 1)
    assert.equal(result.semantics.primary_intent, 'project_information')
    assert.equal(object(result.semantics.property).group, null, current)
    assert.equal(object(result.semantics.property).operation, 'none')
    assert.equal(result.extracted.purchase_purpose, null)
    assert.deepEqual(result.requests[0].topics, ['project_overview'])
    assert.deepEqual(raw, before)
    const summary = rememberInterpretedTurn({}, current, result.extracted, result.semantics)
    assert.equal(confirmedInterpretationMemory(summary).property, undefined)
    assert.equal(object(summary.datos_confirmados).proposito, undefined)
  }
})

test('a typed overview never establishes a category, including enquiries outside the lexical information examples', () => {
  const current = '¿Me puede contar de qué trata el proyecto?', raw = extraction(current)
  assert.equal(isPassivePurchaseEvidence(current), false)
  assert.equal(isGeneralProjectOverviewWithoutPurchaseScope(raw, current), true)
  raw.preferred_category = 'departamento'; raw.events = ['declared_unit_type']
  object(raw.declaration_evidence).preferred_category = current
  const result = normalizeEvents(raw, current)
  assert.equal(result.preferred_category, null)
  assert.equal((result.events as string[]).includes('declared_unit_type'), false)
})

test('the scope guard respects an independent genuine category or purpose in the same message', () => {
  const current = '¿Me puede contar de qué trata el proyecto? Busco un local para invertir', raw = extraction(current)
  object((raw.requests as Row[])[0]).evidence = '¿Me puede contar de qué trata el proyecto?'
  raw.preferred_category = 'local'; raw.purchase_purpose = 'invertir'
  raw.events = ['declared_unit_type', 'declared_purchase_purpose']
  Object.assign(object(raw.declaration_evidence), { preferred_category: 'Busco un local para invertir', purchase_purpose: 'para invertir' })
  assert.equal(isGeneralProjectOverviewWithoutPurchaseScope(raw, current), false)
  const result = normalizeEvents(raw, current)
  assert.equal(result.preferred_category, 'local')
  assert.equal(result.purchase_purpose, 'invertir')
  assert.ok((result.events as string[]).includes('declared_unit_type'))
  assert.ok((result.events as string[]).includes('declared_purchase_purpose'))
  assert.equal(isPassivePurchaseEvidence('Quiero información de departamentos'), false)
  assert.equal(isPassivePurchaseEvidence('Quisiera información de locales'), false)
})

test('the recorded yes I live in Cuenca only confirms profile, dropping the false purchase-purpose event in one call', async () => {
  const current = 'si yo vivo en cuenca', raw = extraction(current)
  raw.purchase_purpose = 'vivir'; raw.events = ['declared_purchase_purpose']
  object(raw.declaration_evidence).purchase_purpose = current
  raw.residence_city = 'Cuenca'; object(raw.profile_evidence).residence_city = current
  raw.requests = []
  object(raw.turn_semantics).primary_intent = 'answer_previous'
  object(raw.turn_semantics).answer_to_previous = { question_id: confirmation.id, kind: 'affirmative', evidence: current, confidence: 'high' }
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: confirmation,
    perfil_inicial: { residence_candidate: confirmation.residence_candidate } }, {
    activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw },
  })
  assert.equal(calls, 1)
  assert.equal(result.extracted.residence_city, 'Cuenca')
  assert.equal(result.extracted.purchase_purpose, null)
  assert.equal((result.extracted.events as string[]).includes('declared_purchase_purpose'), false)
  assert.equal(object(result.semantics.property).group, null)
  assert.equal(object(result.semantics.answer_to_previous).question_id, confirmation.id)
  assert.equal(object(result.semantics.answer_to_previous).kind, 'affirmative')
  assert.ok((result.semantics.normalization_issues as string[]).includes('purchase_purpose_from_passive_source'))
  const summary = rememberInterpretedTurn({}, current, result.extracted, result.semantics)
  assert.equal(object(summary.datos_confirmados).proposito, undefined)
  assert.equal(confirmedInterpretationMemory(summary).property, undefined)
})

test('standalone source guards reject residence as intended use even outside the full conversation wrapper', () => {
  for (const current of ['Sí, yo vivo en Cuenca', 'Claro, actualmente resido en Cuenca', 'Saludos, vivimos en Cuenca',
    'Bueno, vivo en una vivienda en Cuenca', 'Soy de Cuenca']) {
    assert.equal(isPassivePurchaseEvidence(current), true, current)
    const raw = extraction(current)
    raw.purchase_purpose = 'vivir'; raw.events = ['declared_purchase_purpose']
    object(raw.declaration_evidence).purchase_purpose = current
    const result = normalizeEvents(raw, current)
    assert.equal(result.purchase_purpose, null, current)
    assert.equal((result.events as string[]).includes('declared_purchase_purpose'), false)
    assert.equal(object(normalizeTurnSemantics(raw, current, {}).property).group, null)
    raw.preferred_category = 'departamento'; raw.events = ['declared_unit_type', 'declared_purchase_purpose']
    object(raw.declaration_evidence).preferred_category = current
    assert.equal(normalizeEvents(raw, current).preferred_category, null)
    assert.equal((normalizeEvents(raw, current).events as string[]).includes('declared_unit_type'), false)
    assert.equal((normalizeEvents(raw, current).events as string[]).includes('declared_purchase_purpose'), false)
  }
})

test('a whole-message profile citation cannot erase independent holiday or rental use', async () => {
  for (const [current, purpose] of [
    ['Vivo en Cuenca y lo quiero para vacaciones', 'segunda_vivienda'],
    ['Vivo en Cuenca pero sería para arrendarlo', 'invertir'],
  ] as const) {
    const raw = extraction(current)
    raw.residence_city = 'Cuenca'; object(raw.profile_evidence).residence_city = current
    raw.purchase_purpose = purpose; raw.events = ['declared_purchase_purpose']
    object(raw.declaration_evidence).purchase_purpose = current
    raw.requests = []
    object(raw.turn_semantics).primary_intent = 'answer_previous'
    object(raw.turn_semantics).answer_to_previous = { question_id: confirmation.id, kind: 'value', evidence: current, confidence: 'high' }
    Object.assign(object(object(raw.turn_semantics).property), { group: 'residential', operation: 'search', evidence: current })
    assert.equal(isPassivePurchaseEvidence(current), false)
    assert.equal(isPassiveProfilePurposeEvidence(raw, confirmation, current), false)
    const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: confirmation }, {
      activePrompt: async () => 'Extract', aiJson: async () => raw,
    })
    assert.equal(result.extracted.residence_city, 'Cuenca')
    assert.equal(result.extracted.purchase_purpose, purpose)
    assert.equal(object(result.semantics.property).group, 'residential')
    assert.ok((result.extracted.events as string[]).includes('declared_purchase_purpose'))
    const memory = rememberInterpretedTurn({}, current, result.extracted, result.semantics)
    assert.equal(object(memory.datos_confirmados).proposito, purpose)
  }
})

test('a bare yes to residence confirmation cannot declare a purchase purpose, while a genuine purpose answer survives', async () => {
  const current = 'Sí, claro', raw = extraction(current)
  raw.purchase_purpose = 'vivir'; raw.events = ['declared_purchase_purpose']
  object(raw.declaration_evidence).purchase_purpose = current
  raw.requests = []; raw.residence_confirmation = { decision: 'confirm', evidence: current, confidence: 'high' }
  object(raw.turn_semantics).primary_intent = 'answer_previous'
  object(raw.turn_semantics).answer_to_previous = { question_id: confirmation.id, kind: 'affirmative', evidence: current, confidence: 'high' }
  const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: confirmation,
    perfil_inicial: { residence_candidate: confirmation.residence_candidate } }, {
    activePrompt: async () => 'Extract', aiJson: async () => raw,
  })
  assert.equal(result.extracted.residence_city, 'Cuenca')
  assert.equal(result.extracted.purchase_purpose, null)
  assert.equal((result.extracted.events as string[]).includes('declared_purchase_purpose'), false)
  const purpose = 'Para vivir', purposeRaw = extraction(purpose)
  purposeRaw.purchase_purpose = 'vivir'; purposeRaw.events = ['declared_purchase_purpose']
  object(purposeRaw.declaration_evidence).purchase_purpose = purpose
  assert.equal(normalizeEvents(purposeRaw, purpose).purchase_purpose, 'vivir')
})

test('profile-only novelty cannot overwrite an already confirmed investment purpose or commercial requirement', async () => {
  const current = 'si yo vivo en cuenca', raw = extraction(current)
  raw.purchase_purpose = 'vivir'; raw.events = ['declared_purchase_purpose']
  object(raw.declaration_evidence).purchase_purpose = current
  raw.residence_city = 'Cuenca'; object(raw.profile_evidence).residence_city = current
  raw.requests = []
  object(raw.turn_semantics).primary_intent = 'answer_previous'
  object(raw.turn_semantics).answer_to_previous = { question_id: confirmation.id, kind: 'affirmative', evidence: current, confidence: 'high' }
  const savedProperty = { group: 'commercial', category: 'local', filters: {}, excluded_categories: [],
    evidence: 'Busco un local para invertir', confidence: 'high' }
  const previous = { datos_confirmados: { proposito: 'invertir' }, _interpretation_memory: { property: savedProperty } }
  const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: confirmation, resumen: previous,
    perfil_inicial: { residence_candidate: confirmation.residence_candidate } }, { activePrompt: async () => 'Extract', aiJson: async () => raw })
  const remembered = rememberInterpretedTurn(previous, current, result.extracted, result.semantics)
  assert.equal(object(remembered.datos_confirmados).proposito, 'invertir')
  assert.deepEqual(confirmedInterpretationMemory(remembered).property, savedProperty)
})

test('a mixed profile answer preserves independent housing, investment and commercial declarations', async () => {
  for (const [statement, purpose, group, category] of [
    ['busco una vivienda para vivir', 'vivir', 'residential', null],
    ['busco una vivienda para invertir', 'invertir', 'residential', null],
    ['busco un local para mi negocio', 'negocio', 'commercial', 'local'],
  ] as const) {
    const current = `Sí, yo vivo en Cuenca y ${statement}`, raw = extraction(current)
    assert.equal(isPassivePurchaseEvidence(current), false)
    raw.residence_city = 'Cuenca'; object(raw.profile_evidence).residence_city = 'yo vivo en Cuenca'
    raw.purchase_purpose = purpose; object(raw.declaration_evidence).purchase_purpose = statement
    raw.events = ['declared_purchase_purpose']; raw.requests = []
    Object.assign(object(object(raw.turn_semantics).property), { group, category, operation: 'search', evidence: statement })
    object(raw.turn_semantics).primary_intent = 'answer_previous'
    object(raw.turn_semantics).answer_to_previous = { question_id: confirmation.id, kind: 'affirmative', evidence: 'Sí, yo vivo en Cuenca', confidence: 'high' }
    const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: confirmation }, {
      activePrompt: async () => 'Extract', aiJson: async () => raw,
    })
    assert.equal(result.extracted.residence_city, 'Cuenca')
    assert.equal(result.extracted.purchase_purpose, purpose)
    assert.equal(object(result.semantics.property).group, group)
    assert.equal(object(result.semantics.property).category, category)
    assert.ok((result.extracted.events as string[]).includes('declared_purchase_purpose'))
    const memory = rememberInterpretedTurn({}, current, result.extracted, result.semantics)
    assert.equal(object(memory.datos_confirmados).proposito, purpose)
    assert.equal(object(confirmedInterpretationMemory(memory).property).group, group)
  }
})
