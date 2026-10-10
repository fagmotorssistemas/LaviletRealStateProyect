import assert from 'node:assert/strict'
import test from 'node:test'
import fixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { floorEvidence } from './floor-evidence'
import { normalizeCatalogRequest } from './catalog-request'
import { normalizeTurnSemantics } from './turn-semantics'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { resolvePropertyTurn } from './property-context'

const current = 'entiendo, creo que en una planta baja me gustaria mas para no subir tantas gradas'
const pending = { id: 'property_floor', act: 'choose_floor', question: '¿En qué planta le gustaría revisar los departamentos?' }
function extraction(message = current, floor = 1): Row {
  const raw: Row = structuredClone(fixture)
  raw.full_name = raw.residence_city = raw.residence_country = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.preferred_category = 'departamento'
  raw.declaration_evidence = { preferred_category: message, purchase_purpose: null }
  raw.events = ['declared_unit_type']
  const semantics = object(raw.turn_semantics)
  semantics.primary_evidence = message
  semantics.answer_to_previous = { question_id: 'property_floor', kind: 'value', evidence: message, confidence: 'high' }
  semantics.property = { ...object(semantics.property), group: 'residential', category: 'departamento',
    evidence: message, confidence: 'high', excluded_categories: ['suite', 'local', 'penthouse'],
    filters: { ...object(object(semantics.property).filters), floor_number: floor, bedrooms: 3 },
    filter_evidence: { ...object(object(semantics.property).filter_evidence), floor_number: message } }
  return raw
}

for (const [quote, number] of [
  [current, 0], ['Prefiero planta baja', 0], ['Quisiera la primera planta alta', 1],
  ['En la segunda planta alta, por favor', 2], ['Me gustaría el piso cinco', 5], ['piso 3', 3],
] as const) test('floor labels retain their actual numeric meaning: ' + quote, () => {
  assert.deepEqual(floorEvidence(quote), { kind: 'exact', number })
  const normalized = normalizeTurnSemantics(extraction(quote, 9), quote, pending)
  assert.equal(object(object(normalized.property).filters).floor_number, number)
})

for (const quote of ['Prefiero pisos bajos', 'Me gustan las plantas bajas', 'Quiero una planta más baja',
  'Preferiría pisos altos', 'Me gustaría el nivel inferior']) test('relative height cannot invent an exact floor: ' + quote, () => {
  assert.deepEqual(floorEvidence(quote), { kind: 'relative', number: null })
  const normalized = normalizeTurnSemantics(extraction(quote, 0), quote, pending)
  assert.equal(object(object(normalized.property).filters).floor_number, null)
  assert.equal(object(normalized.property).category, null)
  assert.deepEqual(object(normalized.property).excluded_categories, [])
})

test('intervals, negations and competing floors keep their separate semantic contract', () => {
  for (const quote of ['No quiero planta baja', 'Entre la segunda y la tercera planta', 'piso 2 o piso 3',
    'Desde el piso 2', 'No en planta baja, sino en el piso 2', 'Quiero del primer al tercer piso',
    'Quiero piso 2 a 4', 'piso 2 y 3', 'primera o segunda planta']) {
    assert.equal(floorEvidence(quote).kind, 'other', quote)
  }
})

test('a current quote without an exact floor cannot certify a numeric equality', () => {
  for (const message of ['¿Tienen ascensores?', 'No quiero primera planta', 'Del primer al tercer piso', 'piso 2 a 4']) {
    assert.equal(normalizeCatalogRequest({ purpose: 'search', metric: null, confidence: 'high', evidence: message,
      semantic_preferences: [], requirements: [{ field: 'floor_number', operator: 'eq', value: 9,
        upper_value: null, strength: 'required', evidence: message }] }, message), null, message)
    const raw = extraction(message, 9)
    object(raw.turn_semantics).answer_to_previous = { question_id: 'none', kind: 'none', evidence: '', confidence: 'high' }
    assert.equal(object(object(normalizeTurnSemantics(raw, message, {})).property).filters.floor_number, null, message)
  }
})

test('a household or furniture number cannot become a floor through an abbreviated quote', () => {
  const message = 'Tengo 3 hijos y quiero saber si entran dos camas'
  for (const evidence of ['3', 'dos']) {
    assert.equal(normalizeCatalogRequest({ purpose: 'search', metric: null, confidence: 'high', evidence: message,
      semantic_preferences: [], requirements: [{ field: 'floor_number', operator: 'eq', value: 9,
        upper_value: null, strength: 'required', evidence }] }, message), null, evidence)
  }
  const request = normalizeCatalogRequest({ purpose: 'search', metric: null, confidence: 'high', evidence: 'Quiero piso 2',
    semantic_preferences: [], requirements: [{ field: 'floor_number', operator: 'eq', value: 9,
      upper_value: null, strength: 'required', evidence: '2' }] }, 'Quiero piso 2')!
  assert.equal((request.requirements as Row[])[0].value, 2)
})

test('a bare ordinal supplies a floor only while answering the floor question', () => {
  assert.equal(floorEvidence('la segunda', true).number, 2)
  assert.equal(floorEvidence('la segunda').kind, 'other')
})

test('the captured wrong floor and type declarations are normalized without another extraction or CRM contamination', async () => {
  const raw = extraction(), original = structuredClone(raw)
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: pending }, {
    activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw },
  })
  assert.equal(calls, 1)
  assert.equal(object(object(result.semantics.property).filters).floor_number, 0)
  assert.equal(object(result.semantics.property).category, null)
  assert.deepEqual(object(result.semantics.property).excluded_categories, [])
  assert.equal(result.extracted.preferred_category, null)
  assert.ok(!(result.extracted.events as string[]).includes('declared_unit_type'))
  assert.notEqual(object(rememberInterpretedTurn({}, current, result.extracted, result.semantics).datos_confirmados).categoria, 'departamento')
  assert.deepEqual(raw, original)
})

test('a new floor keeps an already confirmed type without turning other types into exclusions', async () => {
  const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: pending }, {
    activePrompt: async () => 'Extract', aiJson: async () => extraction(),
  })
  const context = {
    query: { group: 'residential', category: 'penthouse', operation: 'search', filters: { bedrooms: 3 } },
    preference_category: 'penthouse', category_preference: { category: 'penthouse', evidence: 'quiero penthouse' },
    pending_question: pending, selected_ids: [],
  }
  const resolved = resolvePropertyTurn([], current, { _property_context: context, _pending_question: pending }, [], result.semantics)
  assert.equal(object(resolved.query).category, 'penthouse')
  assert.equal(object(object(resolved.query).filters).floor_number, 0)
  assert.equal(object(object(resolved.query).filters).bedrooms, 3)
})

test('the top-level type flag cannot bypass a neutral semantic category during a floor answer', async () => {
  const raw = extraction()
  object(object(raw.turn_semantics).property).category = null
  object(object(raw.turn_semantics).property).excluded_categories = []
  const result = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: pending }, {
    activePrompt: async () => 'Extract', aiJson: async () => raw,
  })
  assert.equal(result.extracted.preferred_category, null)
})

test('a separate explicit category declaration survives the floor requirement', () => {
  const message = 'Prefiero los penthouses en el piso 6'
  const raw = extraction(message, 6)
  object(object(raw.turn_semantics).property).category = 'penthouse'
  object(object(raw.turn_semantics).property).excluded_categories = []
  const normalized = normalizeTurnSemantics(raw, message, pending)
  assert.equal(object(normalized.property).category, 'penthouse')
  assert.equal(object(object(normalized.property).filters).floor_number, 6)
})

test('the parallel catalog requirement cannot restore floor one from a ground-floor quote', () => {
  const raw = { purpose: 'search', metric: null, confidence: 'high', evidence: current, semantic_preferences: [],
    requirements: [{ field: 'floor_number', operator: 'eq', value: 1, upper_value: null, strength: 'required', evidence: current }] }
  const original = structuredClone(raw), request = normalizeCatalogRequest(raw, current)!
  assert.equal((request.requirements as Row[])[0].value, 0)
  assert.deepEqual(raw, original)
})

test('a mandatory relative floor preserves its qualitative requirement instead of certifying an invented number', () => {
  const message = 'Necesito pisos bajos'
  const request = normalizeCatalogRequest({ purpose: 'search', metric: null, confidence: 'high', evidence: message,
    semantic_preferences: [message], requirements: [{ field: 'floor_number', operator: 'eq', value: 0,
      upper_value: null, strength: 'required', evidence: message }] }, message)!
  assert.equal((request.requirements as Row[])[0].field, 'unmodeled')
  assert.equal((request.requirements as Row[])[0].value, message)
  assert.equal((request.requirements as Row[])[0].strength, 'required')
})

test('a floor quoted from a previous description is not a new constraint without current field evidence', () => {
  const message = 'El mensaje anterior decía segunda planta alta. Todavía no he escogido.'
  const raw = extraction(message, 2), semantics = object(raw.turn_semantics)
  semantics.primary_intent = 'project_information'
  semantics.answer_to_previous = { question_id: 'none', kind: 'none', evidence: '', confidence: 'high' }
  const property = object(semantics.property)
  property.category = null; property.excluded_categories = []
  object(property.filter_evidence).floor_number = ''
  assert.equal(object(object(normalizeTurnSemantics(raw, message, {})).property).filters.floor_number, null)
})
