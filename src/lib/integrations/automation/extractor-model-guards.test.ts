import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { interpretConversationTurn } from './turn-interpretation'
import { reconcileQuotedQuantityReferences, TurnInterpretationError } from './turn-interpretation-input'
import { normalizeTurnSemantics } from './turn-semantics'
import { propertyFiltersFromText } from './turn-semantics'
import { resolvePropertyTurn } from './property-context'

const oldNeed = 'Busco una vivienda de unos 5 cuartos.'
const question = '¿Le interesa revisar estas alternativas de 3 dormitorios?'
const current = '¿Qué precios tienen esas opciones?'
const pending = { id: 'property_requirements', act: 'explore_alternatives', question, candidate_ids: ['d302', 'p602'],
  proposed_query: { group: 'residential', filters: { bedrooms: 3 } } }
const input: Row = { mensaje_actual: current, pregunta_pendiente: pending,
  contexto_propiedades: { query: { group: 'residential', filters: { bedrooms: 5 } }, offered_ids: ['d302', 'p602'], pending_question: pending },
  historial_reciente: [{ role: 'user', content: oldNeed }] }
const quantity = (dimension: string, values: number[], role: string, evidence: string): Row =>
  ({ dimension, values, role, count_basis: 'unspecified', evidence, confidence: 'high' })
function extraction(message = current): Row {
  return { requests: [{ domain: 'property', request: 'Precios de las alternativas', evidence: message, confidence: 'high' }],
    turn_semantics: { primary_intent: 'ask_price', primary_evidence: message, confidence: 'high',
      property: { group: 'residential', operation: 'details', reference_kind: 'comparison', query_scope: 'offered',
        filters: { floor_number: null, bedrooms: null }, evidence: message, confidence: 'high' },
      housing_quantities: [quantity('bedrooms', [3], 'evaluation', question), quantity('bedrooms', [5], 'requirement', oldNeed)] } }
}

test('prices and details of offered alternatives discard only proven historical quantity echoes', async () => {
  for (const operation of ['details', 'compare']) {
    const raw = extraction(), original = structuredClone(raw), summary = structuredClone(input)
    object(object(raw.turn_semantics).property).operation = operation
    let calls = 0
    const result = await interpretConversationTurn(input, { activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw } })
    assert.equal(calls, 1)
    assert.equal(result.semantics.primary_intent, 'ask_price')
    assert.equal(object(result.semantics.property).operation, operation)
    assert.deepEqual(result.semantics.housing_quantities, [])
    assert.deepEqual(object(result.diagnostic.historical_reconciliation).fields, ['housing_quantities.0', 'housing_quantities.1'])
    assert.equal(object(result.diagnostic.interpretation_recovery).attempted, false)
    assert.equal(object(object(object(input.contexto_propiedades).query).filters).bedrooms, 5)
    assert.deepEqual(input, summary)
    original.turn_semantics = { ...object(original.turn_semantics), property: { ...object(object(original.turn_semantics).property), operation } }
    assert.deepEqual(raw, original)
    assert.notEqual(object(result.semantics.answer_to_previous).kind, 'affirmative')
  }
})

test('current quantities are never discarded because the same words also appeared in history', async () => {
  const message = `${current} Somos varios y buscamos algo para cinco personas.`
  const raw = extraction(message)
  object(raw.turn_semantics).housing_quantities = [quantity('people', [], 'context', 'Somos varios'),
    quantity('people', [5], 'context', 'para cinco personas'), quantity('bedrooms', [5], 'requirement', oldNeed)]
  const previous = { ...input, historial_reciente: [{ role: 'user', content: message }, { role: 'user', content: oldNeed }] }
  const result = await interpretConversationTurn({ ...previous, mensaje_actual: message }, { activePrompt: async () => 'Extract', aiJson: async () => raw })
  assert.deepEqual((result.semantics.housing_quantities as Row[]).map(q => [q.dimension, q.values]), [['people', []], ['people', [5]]])
  assert.equal(object(object(result.semantics.property).filters).bedrooms, null)
})

for (const kind of ['search', 'selection', 'new_filter', 'unknown_quote', 'no_known_options']) {
  test(`historical quantity evidence still requires recovery for ${kind}`, async () => {
    const raw = extraction(), property = object(object(raw.turn_semantics).property)
    if (kind === 'search') property.operation = 'search'
    if (kind === 'selection') property.operation = 'select'
    if (kind === 'new_filter') {
      property.filters = { bedrooms: 3 }
      property.filter_evidence = { bedrooms: current }
    }
    if (kind === 'unknown_quote') object(raw.turn_semantics).housing_quantities = [quantity('people', [9], 'context', 'Mi familia tiene nueve personas')]
    const context = kind === 'no_known_options' ? { ...input, contexto_propiedades: {}, pregunta_pendiente: {} } : input
    const before = structuredClone(raw)
    assert.deepEqual(reconcileQuotedQuantityReferences(raw, context, current), { raw, fields: [] })
    let calls = 0
    await assert.rejects(interpretConversationTurn(context, { activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw } }),
      (error: unknown) => error instanceof TurnInterpretationError && error.issues.some(issue => issue.startsWith('non_current_evidence:quantity.')))
    assert.equal(calls, 2)
    assert.deepEqual(raw, before)
  })
}

test('accepting property alternatives cannot accept a visit with the very same answer evidence', async () => {
  const message = 'Sí, revisemos las opciones de tres'
  const raw = extraction(message), semantics = object(raw.turn_semantics)
  semantics.housing_quantities = []
  semantics.answer_to_previous = { question_id: 'property_requirements', kind: 'affirmative', evidence: message, confidence: 'high' }
  raw.visit_intent = { kind: 'accept_visit_preference', purpose: 'accept_alternative', target: 'project', destination: null,
    evidence: message, confidence: 'high' }
  const result = await interpretConversationTurn({ ...input, mensaje_actual: message,
    dialogo_visita: { status: 'offered', offered_destination: 'office' } }, { activePrompt: async () => 'Extract', aiJson: async () => raw })
  assert.equal(object(result.semantics.answer_to_previous).question_id, 'property_requirements')
  assert.equal(object(result.semantics.answer_to_previous).kind, 'affirmative')
  assert.equal(result.extracted.visit_intent, null)
  assert.ok((result.semantics.normalization_issues as string[]).includes('visit_acceptance_belongs_to_other_question'))
})

test('a distinct visit request survives answering a property question in the same turn', async () => {
  const propertyAnswer = 'Sí, revisemos las opciones de tres', visitAnswer = 'Acepto la visita en la oficina'
  const message = `${propertyAnswer}. ${visitAnswer}`
  const raw = extraction(message), semantics = object(raw.turn_semantics)
  semantics.housing_quantities = []
  semantics.answer_to_previous = { question_id: 'property_requirements', kind: 'affirmative', evidence: propertyAnswer, confidence: 'high' }
  raw.visit_intent = { kind: 'accept_visit_preference', purpose: 'accept_alternative', target: 'project', destination: 'office',
    evidence: visitAnswer, confidence: 'high' }
  raw.requests = [{ domain: 'property', request: 'Revisar alternativas', evidence: propertyAnswer, confidence: 'high' },
    { domain: 'visit', request: 'Aceptar la oficina propuesta', evidence: visitAnswer, confidence: 'high' }]
  const result = await interpretConversationTurn({ ...input, mensaje_actual: message }, { activePrompt: async () => 'Extract', aiJson: async () => raw })
  assert.equal(object(result.extracted.visit_intent).kind, 'accept_visit_preference')
  assert.equal(object(result.semantics.answer_to_previous).kind, 'affirmative')
  assert.equal(result.requests.length, 2)
})

test('an actual visit answer retains its intent, while an unbound acceptance remains for the visit state validator', async () => {
  for (const question of [{ id: 'visit_destination', act: 'visit', question: '¿Desea visitar la oficina?' }, {}]) {
    const message = 'Sí, la oficina', raw = extraction(message), semantics = object(raw.turn_semantics)
    semantics.housing_quantities = []
    semantics.answer_to_previous = { question_id: 'visit_destination', kind: 'affirmative', evidence: message, confidence: 'high' }
    raw.visit_intent = { kind: 'accept_visit_preference', purpose: 'accept_alternative', target: 'project', destination: 'office',
      evidence: message, confidence: 'high' }
    const result = await interpretConversationTurn({ ...input, mensaje_actual: message, pregunta_pendiente: question },
      { activePrompt: async () => 'Extract', aiJson: async () => raw })
    assert.equal(object(result.extracted.visit_intent).kind, 'accept_visit_preference')
    assert.ok(!(result.semantics.normalization_issues as string[]).includes('visit_acceptance_belongs_to_other_question'))
  }
})

test('quantity-only recovery rereads the current turn without history and preserves unrelated valid fields', async () => {
  const message = 'Prefiero plantas altas, no tengo un piso exacto en mente'
  const raw = extraction(message), semantics = object(raw.turn_semantics)
  semantics.primary_intent = 'select_property'
  object(semantics.property).operation = 'search'
  semantics.housing_quantities = [quantity('bedrooms', [3], 'requirement', '')]
  raw.full_name = 'Carlos'
  raw.profile_evidence = { full_name: 'Carlos' }
  raw.financing_partner_choice = { kind: 'none', name: null, evidence: '', confidence: 'low' }
  const first = structuredClone(raw)
  let calls = 0
  const result = await interpretConversationTurn({ ...input, mensaje_actual: message }, {
    activePrompt: async () => 'Extract', aiJson: async (rules, context, schema) => {
      calls++
      if (calls === 1) return raw
      assert.deepEqual(Object.keys(object(schema.properties)), ['turn_semantics'])
      assert.deepEqual(Object.keys(object(object(object(schema.properties).turn_semantics).properties)), ['housing_quantities'])
      assert.equal(object(context).mensaje_actual, message)
      assert.equal(object(context).historial, undefined)
      assert.equal(object(context).contexto_propiedades, undefined)
      assert.equal(object(context).hechos_confirmados, undefined)
      assert.ok(rules.length < 2000)
      // The real strict schema rejects extra fields; even an injected legacy
      // mock cannot make this focused repair authorize an unrelated action.
      return { financing_consent: true, requested_advisor: true,
        turn_semantics: { housing_quantities: [], primary_intent: 'request_reservation' } }
    },
  })
  assert.equal(calls, 2)
  assert.equal(result.semantics.primary_intent, 'select_property')
  assert.equal(object(result.semantics.property).operation, 'search')
  assert.deepEqual(result.semantics.housing_quantities, [])
  assert.equal(result.extracted.financing_consent, null)
  assert.equal(result.extracted.requested_advisor, false)
  assert.equal(object(result.semantics.reservation).kind, 'none')
  assert.equal(object(result.diagnostic.interpretation_recovery).status, 'recovered')
  assert.deepEqual(raw, first)
})

test('focused quantity repair can keep new household context while removing stale room requirements', async () => {
  const message = 'Somos varios y prefiero las plantas altas', raw = extraction(message), semantics = object(raw.turn_semantics)
  object(semantics.property).operation = 'search'
  semantics.housing_quantities = [quantity('bedrooms', [3], 'requirement', '')]
  let calls = 0
  const result = await interpretConversationTurn({ ...input, mensaje_actual: message }, { activePrompt: async () => 'Extract',
    aiJson: async () => ++calls === 1 ? raw : { turn_semantics: { housing_quantities: [quantity('people', [], 'context', 'Somos varios')] } } })
  assert.equal(calls, 2)
  assert.equal((result.semantics.housing_quantities as Row[])[0].dimension, 'people')
  assert.deepEqual((result.semantics.housing_quantities as Row[])[0].values, [])
  assert.equal(object(object(result.semantics.property).filters).bedrooms, null)
})

test('missing or still unsupported quantity repairs fail after one retry without erasing the assertion', async () => {
  for (const repaired of [{}, { turn_semantics: { housing_quantities: [quantity('people', [9], 'context', 'Somos nueve')] } }]) {
    const raw = extraction(), semantics = object(raw.turn_semantics)
    object(semantics.property).operation = 'search'
    semantics.housing_quantities = [quantity('bedrooms', [5], 'requirement', '')]
    let calls = 0
    await assert.rejects(interpretConversationTurn(input, { activePrompt: async () => 'Extract', aiJson: async () => ++calls === 1 ? raw : repaired }), TurnInterpretationError)
    assert.equal(calls, 2)
  }
})

test('a long literal compound declaration keeps its current intent, filters and budget without an extra call', async () => {
  const message = `Busco una vivienda de 3 dormitorios. ${'Quiero revisar las características con mi familia antes de decidir. '.repeat(5)} Mi presupuesto aproximado es de 400 mil dólares.`
  const raw: Row = { requests: [{ domain: 'property', request: 'Opciones para vivienda', evidence: 'Busco una vivienda de 3 dormitorios.', confidence: 'high' }],
    turn_semantics: { primary_intent: 'discuss_budget', primary_evidence: message, confidence: 'high',
      housing_quantities: [quantity('bedrooms', [3], 'requirement', message)],
      property: { group: 'residential', operation: 'search', evidence: message, confidence: 'high',
        filters: { bedrooms: 3 }, filter_evidence: { bedrooms: message } },
      budget: { status: 'amount', amount: 400000, evidence: message, confidence: 'high' } } }
  assert.ok(message.length > 240)
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: message }, { activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw } })
  assert.equal(calls, 1)
  assert.equal(result.semantics.primary_intent, 'discuss_budget')
  assert.equal(object(result.semantics.property).group, 'residential')
  assert.equal(object(object(result.semantics.property).filters).bedrooms, 3)
  assert.equal(object(result.semantics.budget).amount, 400000)
  assert.equal((result.semantics.housing_quantities as Row[]).length, 1)
})

for (const [evidence, amount] of [
  ['Mi presupuesto es de cuatrocientos mil dólares', 400000],
  ['Tengo un millón doscientos treinta mil quinientos para la compra', 1230500],
  ['Para la entrada dispongo de treinta y cinco mil', 35000],
  ['Estimo unos cuatrocientos dólares para esta compra, aún no estoy seguro', 400],
  ['Tengo $400.000 en total', 400000],
] as const) test(`budget numeric equivalence preserves ${amount} from its current declaration`, async () => {
  const raw: Row = { turn_semantics: { primary_intent: 'discuss_budget', primary_evidence: evidence, confidence: 'high',
    budget: { status: 'amount', amount, evidence, confidence: 'high' } } }
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: evidence }, { activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw } })
  assert.equal(calls, 1)
  assert.equal(object(result.semantics.budget).amount, amount)
  assert.equal(object(result.diagnostic.interpretation_recovery).attempted, false)
  assert.equal(result.extracted.requested_advisor, false)
})

for (const [evidence, amount] of [
  ['No tengo un presupuesto definido', 400000],
  ['Mi presupuesto es de cuatrocientos mil dólares', 400],
  ['Tengo cuatrocientos dólares', 400000],
  ['Tengo 400 dólares', 400000],
] as const) test(`an invented budget amount ${amount} cannot pass its literal quantity`, async () => {
  const raw: Row = { turn_semantics: { budget: { status: 'amount', amount, evidence, confidence: 'high' } } }
  assert.equal(object(normalizeTurnSemantics(raw, evidence, {}).budget).amount, null)
  let calls = 0
  await assert.rejects(interpretConversationTurn({ mensaje_actual: evidence }, { activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw } }),
    (error: unknown) => error instanceof TurnInterpretationError && error.issues.includes('invalid_budget_amount'))
  assert.equal(calls, 2)
})

test('repairing a wrong monetary magnitude preserves the exact current declaration and unrelated valid data', async () => {
  const message = 'Me llamo Carlos y tengo cuatrocientos dólares', raw: Row = {
    full_name: 'Carlos', profile_evidence: { full_name: 'Me llamo Carlos' },
    turn_semantics: { budget: { status: 'amount', amount: 400000, evidence: 'tengo cuatrocientos dólares', confidence: 'high' } },
  }
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: message }, { activePrompt: async () => 'Extract', aiJson: async () => ++calls === 1 ? raw
    : { turn_semantics: { budget: { status: 'amount', amount: 400, evidence: 'tengo cuatrocientos dólares', confidence: 'high' } } } })
  assert.equal(calls, 2)
  assert.equal(object(result.semantics.budget).amount, 400)
  assert.equal(object(result.extracted.lead_profile).full_name, 'Carlos')
})

const homes: Row[] = [1, 2, 3, 4].map(bedrooms => ({ id: `home-${bedrooms}`, unit_number: String(200 + bedrooms),
  category: 'departamento', bedrooms, floor_number: 2, is_published: true, status: 'disponible' }))
for (const [message, value, operator, upper, expected] of [
  ['Busco al menos dos dormitorios', 2, 'gte', null, [2, 3, 4]],
  ['Busco como máximo tres dormitorios', 3, 'lte', null, [1, 2, 3]],
  ['Busco entre dos y tres dormitorios', 2, 'between', 3, [2, 3]],
  ['Busco exactamente dos dormitorios', 2, 'eq', null, [2]],
] as const) test(`validated catalogue ${operator} preserves the same bedroom relation without a duplicate field quote`, async () => {
  const raw: Row = { turn_semantics: { primary_intent: 'select_property', primary_evidence: message, confidence: 'high',
    housing_quantities: [quantity('bedrooms', upper ? [value, upper] : [value], 'requirement', message)],
    property: { group: 'residential', operation: 'search', evidence: message, confidence: 'high',
      filters: { bedrooms: value, bedrooms_operator: operator, bedrooms_upper: upper, bedrooms_required: null },
      filter_evidence: { bedrooms: message, bedrooms_operator: '', bedrooms_upper: '' } } },
    catalog_request: { purpose: 'search', metric: null, evidence: message, confidence: 'high', semantic_preferences: [],
      requirements: [{ field: 'bedrooms', operator, value, upper_value: upper, strength: 'required', evidence: message }] } }
  let calls = 0
  const result = await interpretConversationTurn({ mensaje_actual: message }, { activePrompt: async () => 'Extract', aiJson: async () => { calls++; return raw } })
  assert.equal(calls, 1)
  assert.equal(object(object(result.semantics.property).filters).bedrooms_operator || 'eq', operator)
  assert.equal(object(object(result.semantics.property).filters).bedrooms_upper ?? null, upper)
  assert.notEqual(object(object(result.semantics.property).filters).bedrooms_required, true)
  const resolution = resolvePropertyTurn(homes, message, {}, [], result.semantics)
  assert.deepEqual(resolution.matches.map(unit => unit.bedrooms), expected)
  assert.equal(object(object(resolution.context.query).filters).bedrooms_operator || 'eq', operator)
  assert.deepEqual(object(resolution.context.query).requirements, object(result.semantics.catalog_request).requirements)
})

test('an invalid or preferred catalogue condition cannot replace a current evidenced bedroom relation', async () => {
  const message = 'Busco al menos dos dormitorios', raw: Row = {
    turn_semantics: { primary_intent: 'select_property', primary_evidence: message, confidence: 'high',
      housing_quantities: [quantity('bedrooms', [2], 'requirement', message)],
      property: { group: 'residential', operation: 'search', evidence: message, confidence: 'high', filters: { bedrooms: 2, bedrooms_operator: 'gte' },
        filter_evidence: { bedrooms: message, bedrooms_operator: message } } },
  }
  for (const requirement of [
    { value: 3, evidence: 'Busco tres dormitorios', strength: 'required' },
    { value: 3, evidence: message, strength: 'preferred' },
  ]) {
    raw.catalog_request = { purpose: 'search', metric: null, confidence: 'high', evidence: message, semantic_preferences: [],
      requirements: [{ field: 'bedrooms', operator: 'eq', upper_value: null, ...requirement }] }
    const result = await interpretConversationTurn({ mensaje_actual: message }, { activePrompt: async () => 'Extract', aiJson: async () => raw })
    assert.equal(object(object(result.semantics.property).filters).bedrooms, 2)
    assert.equal(object(object(result.semantics.property).filters).bedrooms_operator, 'gte')
  }
})

const lenders = ['Cooperativa JEP', 'Banco Pichincha']
for (const [message, lender, kind] of [
  ['Prefiero JEP', 'Cooperativa JEP', 'select'],
  ['Con Banco Pichincha por favor', 'Banco Pichincha', 'select'],
  ['¿Qué requisitos pide JEP?', 'Cooperativa JEP', 'none'],
] as const) test(`a lender ${kind} is preserved without a fabricated financing authorization`, async () => {
  const question = { id: 'financing_partner', act: 'financing', question: '¿Qué entidad prefiere?' }
  const raw: Row = { financing_consent: true, financing_partner: lender,
    financing_partner_choice: { kind, name: lender, evidence: message, confidence: 'high' },
    turn_semantics: { primary_intent: 'ask_financing', primary_evidence: message, confidence: 'high',
      answer_to_previous: { question_id: question.id, kind: kind === 'select' ? 'value' : 'none', evidence: message, confidence: 'high' } } }
  const state = { _financing_journey: { accepted: true, selected_partner: 'Banco Pichincha' } }
  const result = await interpretConversationTurn({ mensaje_actual: message, pregunta_pendiente: question, resumen: state,
    financiamiento: { partners: lenders, current: { explicit_consent: true } } }, { activePrompt: async () => 'Extract', aiJson: async () => raw })
  assert.equal(result.extracted.financing_consent, null)
  assert.equal(object(result.extracted.financing_partner_choice).kind, kind)
  assert.equal(object(result.extracted.financing_partner_choice).name, lender)
  assert.equal(object(state._financing_journey).accepted, true)
  assert.equal(object(state._financing_journey).selected_partner, 'Banco Pichincha')
})

test('a bank preference plus an independent current financial authorization retains both decisions', async () => {
  const message = 'Prefiero JEP y quiero iniciar la revisión financiera', raw: Row = {
    financing_consent: true, financing_partner: 'Cooperativa JEP',
    financing_partner_choice: { kind: 'select', name: 'Cooperativa JEP', evidence: 'Prefiero JEP', confidence: 'high' },
    turn_semantics: { primary_intent: 'ask_financing', primary_evidence: message, confidence: 'high',
      answer_to_previous: { question_id: 'financing_partner', kind: 'value', evidence: 'Prefiero JEP', confidence: 'high' } },
  }
  const result = await interpretConversationTurn({ mensaje_actual: message,
    pregunta_pendiente: { id: 'financing_partner', question: '¿Qué entidad prefiere?' }, financiamiento: { partners: lenders } },
  { activePrompt: async () => 'Extract', aiJson: async () => raw })
  assert.equal(result.extracted.financing_consent, true)
  assert.equal(object(result.extracted.financing_partner_choice).kind, 'select')
})

test('a current affirmative answer to an actual financial invitation retains authorization', async () => {
  const message = 'Sí, por favor', raw: Row = { financing_consent: true,
    turn_semantics: { primary_intent: 'answer_previous', primary_evidence: message, confidence: 'high',
      answer_to_previous: { question_id: 'financing_invitation', kind: 'affirmative', evidence: message, confidence: 'high' } } }
  const result = await interpretConversationTurn({ mensaje_actual: message,
    pregunta_pendiente: { id: 'financing_invitation', act: 'financing', question: '¿Desea iniciar la revisión financiera?' } },
  { activePrompt: async () => 'Extract', aiJson: async () => raw })
  assert.equal(result.extracted.financing_consent, true)
})

for (const message of ['No quiero iniciar ese trámite, sólo conocer los requisitos', 'Sólo si me garantizan la aprobación']) {
  test(`a ${message.startsWith('No') ? 'negative' : 'conditional'} financial answer cannot authorize from a mistaken flag`, async () => {
    const raw: Row = { financing_consent: true, turn_semantics: { primary_intent: 'ask_financing', primary_evidence: message, confidence: 'high',
      answer_to_previous: { question_id: 'financing_invitation', kind: 'negative', evidence: message, confidence: 'high' } } }
    const result = await interpretConversationTurn({ mensaje_actual: message,
      pregunta_pendiente: { id: 'financing_invitation', question: '¿Desea iniciar la revisión financiera?' } },
    { activePrompt: async () => 'Extract', aiJson: async () => raw })
    assert.equal(result.extracted.financing_consent, null)
  })
}

test('outside-scope financial authorization cannot survive rebinding to a property question', async () => {
  const outside = 'Quiero iniciar la revisión financiera de mi vehículo', property = '¿Qué precio tiene el departamento?'
  const raw: Row = { financing_consent: true,
    requests: [{ domain: 'financing', request: 'Iniciar revisión del vehículo', evidence: outside, confidence: 'high' }],
    turn_semantics: { primary_intent: 'ask_financing', primary_evidence: outside, confidence: 'high' } }
  const result = await interpretConversationTurn({ mensaje_actual: `${outside}. ${property}`, mensaje_accion: property,
    pregunta_pendiente: { id: 'financing_invitation', question: '¿Desea iniciar la revisión financiera?' } },
  { activePrompt: async () => 'Extract', aiJson: async () => raw })
  assert.equal(result.extracted.financing_consent, null)
})

for (const message of [
  'Prefiero plantas altas, no tengo un piso exacto en mente',
  'Quiero un piso alto', 'No tengo una planta preferida', 'Me gustaría un nivel intermedio',
]) test(`an indefinite floor article cannot become an exact floor: ${message}`, () => {
  assert.equal(propertyFiltersFromText(message, 'property_floor').floor_number, null)
  const semantics = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'select_property', primary_evidence: message, confidence: 'high',
    property: { group: 'residential', operation: 'search', evidence: message, confidence: 'high', filters: { floor_number: null } } } }, message, {})
  assert.equal(object(semantics.property).filters && object(object(semantics.property).filters).floor_number, null)
})

test('actual numeric and ordinal floor choices survive excluding indefinite articles', () => {
  for (const [message, expected] of [['Quiero el primer piso', 1], ['El piso uno', 1], ['Una vivienda en el piso 2', 2],
    ['En la tercera planta', 3], ['Uno', 1], ['Planta baja', 0]] as const) {
    assert.equal(propertyFiltersFromText(message, 'property_floor').floor_number, expected, message)
  }
  assert.equal(propertyFiltersFromText('Quiero un dormitorio').bedrooms, 1)
})
