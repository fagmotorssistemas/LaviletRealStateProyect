import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { commercialEngagement, COMMERCIAL_ENGAGEMENT_VERSION, passiveSalesCopy, passiveSalesRules, requestedPropertyContinuation, type CommercialEngagementTurn } from './commercial-engagement'
import { rememberSalesReply } from './sales-policy'

const saved = { passive_sales: true, property_interest: false }
const turn = (current: string, overrides: Record<string, unknown> = {}): CommercialEngagementTurn => ({
  scope: { kind: 'property', uncertain: false },
  semantics: { confidence: 'high', primary_intent: 'project_information',
    property: { confidence: 'high', operation: 'details', evidence: current, query_scope: 'offered' },
    answer_to_previous: { kind: 'none', confidence: 'low', question_id: 'none' } },
  intent: { objective: 'project_information', requests: [{ domain: 'property', confidence: 'high', evidence: current, request: current }] },
  ...overrides,
})

describe('current property continuation keeps sales permission separate', () => {
  for (const current of ['indíqueme lo de los 3 dormitorios', 'cuánto valen estas opciones?', '¿en qué pisos están?', 'quiero comparar estas opciones']) {
    it(`permits the requested information and relevant clarification: ${current}`, () => {
      const engagement = commercialEngagement(current, [], saved, turn(current))
      assert.equal(engagement.passive, true)
      assert.equal(engagement.interested, false)
      assert.equal(engagement.property_continuation_allowed, true)
      assert.equal(engagement.property_continuation?.property_interest_renewed, false)
      const allowed = engagement.property_continuation?.allowed_question_ids as string[]
      assert.ok(allowed.includes('property_category'))
      assert.ok(allowed.includes('property_floor'))
      assert.ok(allowed.includes('property_requirements'))
      assert.ok(allowed.includes('unit_choice'))
      for (const id of ['financing_invitation', 'visit_invitation', 'reservation_invitation', 'lead_profile', 'budget_amount']) assert.ok(!allowed.includes(id))
    })
  }

  for (const [current, property] of [
    ['estoy buscando algo de 5 cuartos porque mi familia es grande', { filters: { bedrooms: 5 } }],
    ['necesito siete dormitorios', { filters: { bedrooms: 7 } }],
    ['me interesan más los departamentos', { category: 'departamento' }],
    ['prefiero la cuarta planta', { filters: { floor_number: 4 } }],
    ['busco al menos 170 m²', { filters: { min_area_m2: 170 } }],
  ] as const) {
    it(`renews a concrete search from grounded semantics without phrase lists: ${current}`, () => {
      const input = turn(current, {
        semantics: { confidence: 'high', primary_intent: 'select_property',
          property: { confidence: 'high', operation: 'search', evidence: current, ...property } },
        intent: { objective: 'select_property', requests: [{ domain: 'property', confidence: 'high', evidence: current }] },
      })
      const engagement = commercialEngagement(current, [{ role: 'cliente', content: 'Sólo por curiosidad' }], saved, input)
      assert.equal(engagement.passive, false)
      assert.equal(engagement.interested, true)
      assert.equal(engagement.property_continuation?.property_interest_renewed, true)
      assert.equal(engagement.property_continuation?.reason, 'current_concrete_property_search')
    })
  }

  it('a price request with a criterion does not renew buying interest', () => {
    const current = '¿Qué precio tienen los de tres dormitorios?'
    const input = turn(current, {
      semantics: { confidence: 'high', primary_intent: 'ask_price',
        property: { confidence: 'high', operation: 'search', evidence: current, filters: { bedrooms: 3 } } },
      intent: { objective: 'ask_price', requests: [{ domain: 'property', confidence: 'high', evidence: current }] },
    })
    const engagement = commercialEngagement(current, [], saved, input)
    assert.equal(engagement.passive, true)
    assert.equal(engagement.property_continuation_allowed, true)
    assert.equal(engagement.property_continuation?.property_interest_renewed, false)
  })

  it('a current explicit refusal takes precedence over a conflicting search label', () => {
    const current = 'No quiero comprar, sólo por curiosidad: ¿hay tres dormitorios?'
    const input = turn(current, {
      semantics: { confidence: 'high', primary_intent: 'select_property',
        property: { confidence: 'high', operation: 'search', evidence: current, filters: { bedrooms: 3 } } },
      intent: { objective: 'select_property', requests: [{ domain: 'property', confidence: 'high', evidence: current }] },
    })
    const engagement = commercialEngagement(current, [], {}, input)
    assert.equal(engagement.passive, true)
    assert.equal(engagement.interested, false)
    assert.equal(engagement.property_continuation?.property_interest_renewed, false)
    assert.equal(engagement.property_continuation_allowed, false, 'Answer the facts without a new qualification invitation')
    assert.equal(engagement.property_continuation?.reason, 'current_sales_refusal')
  })

  it('a refusal of financing can coexist with a concrete property search', () => {
    const current = 'No quiero financiamiento; prefiero departamentos de tres dormitorios'
    const input = turn(current, {
      semantics: { confidence: 'high', primary_intent: 'select_property',
        property: { confidence: 'high', operation: 'search', evidence: 'prefiero departamentos de tres dormitorios', category: 'departamento', filters: { bedrooms: 3 } },
        answer_to_previous: { kind: 'negative', confidence: 'high', question_id: 'financing_invitation', evidence: 'No quiero financiamiento' } },
      pendingQuestion: { id: 'financing_invitation', question: '¿Desea continuar con financiamiento?' },
      intent: { objective: 'select_property', requests: [{ domain: 'property', confidence: 'high', evidence: 'prefiero departamentos de tres dormitorios' }] },
    })
    const engagement = commercialEngagement(current, [], saved, input)
    assert.equal(engagement.passive, false)
    assert.equal(engagement.property_continuation?.property_interest_renewed, true)
    assert.ok(!(engagement.property_continuation?.allowed_question_ids as string[]).includes('financing_invitation'))
  })

  for (const [current, negativeEvidence, pendingQuestion] of [
    ['No me interesa el financiamiento; prefiero departamentos de tres dormitorios', 'No me interesa el financiamiento', { id: 'financing_invitation', question: '¿Desea iniciar la revisión financiera?' }],
    ['No estoy interesado en una visita; prefiero departamentos de tres dormitorios', 'No estoy interesado en una visita', { id: 'visit_invitation', question: '¿Desea coordinar una visita?' }],
    ['No me interesa; prefiero departamentos de tres dormitorios', 'No me interesa', { id: 'financing_invitation', question: '¿Desea iniciar la revisión financiera?' }],
    ['No me interesa la reserva; prefiero departamentos de tres dormitorios', '', {}],
  ] as const) {
    it(`keeps a qualified refusal separate from the independent search: ${current}`, () => {
      const evidence = 'prefiero departamentos de tres dormitorios'
      const engagement = commercialEngagement(current, [], saved, turn(current, {
        semantics: { primary_intent: 'select_property', confidence: 'high',
          property: { confidence: 'high', operation: 'search', evidence, category: 'departamento', filters: { bedrooms: 3 } },
          answer_to_previous: { kind: negativeEvidence ? 'negative' : 'none', confidence: 'high', evidence: negativeEvidence, question_id: 'id' in pendingQuestion ? pendingQuestion.id : 'none' } },
        intent: { objective: 'select_property', requests: [{ domain: 'property', confidence: 'high', evidence }] }, pendingQuestion,
      }))
      assert.equal(engagement.passive, false)
      assert.equal(engagement.property_continuation_allowed, true)
      assert.equal(engagement.property_continuation?.property_interest_renewed, true)
      for (const id of ['financing_invitation', 'visit_invitation', 'reservation_invitation']) assert.ok(!(engagement.property_continuation?.allowed_question_ids as string[]).includes(id))
    })
  }

  for (const [current, negativeEvidence, pendingQuestion] of [
    ['No me interesa comprar; prefiero departamentos de tres dormitorios', 'No me interesa comprar', { id: 'financing_invitation', question: '¿Desea revisar financiamiento?' }],
    ['No me interesa; prefiero departamentos de tres dormitorios', 'No me interesa', { id: 'property_category', question: '¿Prefiere departamentos o penthouses?' }],
    ['No me interesa el financiamiento; no quiero comprar; prefiero departamentos de tres dormitorios', 'No me interesa el financiamiento', { id: 'financing_invitation', question: '¿Desea revisar financiamiento?' }],
    ['No me interesa el financiamiento; no me interesa el proyecto; prefiero departamentos de tres dormitorios', 'No me interesa el financiamiento', { id: 'financing_invitation', question: '¿Desea revisar financiamiento?' }],
    ['No me interesa; prefiero departamentos de tres dormitorios', 'No me interesa', { id: 'financing_invitation', question: 'Tenemos financiamiento disponible.' }],
  ] as const) {
    it(`a global refusal cannot be relabeled as a scoped refusal: ${current}`, () => {
      const evidence = 'prefiero departamentos de tres dormitorios'
      const engagement = commercialEngagement(current, [], {}, turn(current, {
        semantics: { primary_intent: 'select_property', confidence: 'high',
          property: { confidence: 'high', operation: 'search', evidence, category: 'departamento' },
          answer_to_previous: { kind: 'negative', confidence: 'high', evidence: negativeEvidence, question_id: pendingQuestion.id } },
        intent: { objective: 'select_property', requests: [{ domain: 'property', confidence: 'high', evidence }] }, pendingQuestion,
      }))
      assert.equal(engagement.passive, true)
      assert.equal(engagement.property_continuation_allowed, false)
      assert.equal(engagement.property_continuation?.reason, 'current_sales_refusal')
    })
  }

  it('a qualified refusal with only a factual price query does not renew buying interest', () => {
    const current = 'No me interesa el financiamiento; ¿cuánto valen estas opciones?'
    const evidence = '¿cuánto valen estas opciones?'
    const engagement = commercialEngagement(current, [], saved, turn(current, {
      semantics: { primary_intent: 'ask_price', confidence: 'high', property: { operation: 'details', confidence: 'high', evidence } },
      intent: { objective: 'ask_price', requests: [{ domain: 'property', confidence: 'high', evidence }] },
    }))
    assert.equal(engagement.passive, true)
    assert.equal(engagement.property_continuation_allowed, true)
    assert.equal(engagement.property_continuation?.property_interest_renewed, false)
  })

  it('declining the actual financing question alone preserves previous property engagement without renewing it', () => {
    const current = 'No me interesa el financiamiento'
    const input: CommercialEngagementTurn = { scope: { kind: 'property' },
      semantics: { primary_intent: 'answer_previous', confidence: 'high',
        answer_to_previous: { kind: 'negative', confidence: 'high', question_id: 'financing_invitation', evidence: current } },
      intent: { objective: 'answer_previous', requests: [] },
      pendingQuestion: { id: 'financing_invitation', question: '¿Desea continuar con la revisión financiera?' } }
    for (const previous of [saved, { passive_sales: false, property_interest: true }]) {
      const engagement = commercialEngagement(current, [], previous, input)
      assert.equal(engagement.passive, previous.passive_sales)
      assert.equal(engagement.interested, previous.property_interest)
      assert.equal(engagement.property_continuation_allowed, false)
      assert.equal(engagement.property_continuation?.property_interest_renewed, false)
      const remembered = rememberSalesReply(previous, [], current, 'Entiendo. Continuamos atendiendo su consulta.', input)
      assert.equal(remembered.passive_sales, previous.passive_sales)
      assert.equal(remembered.property_interest, previous.property_interest)
    }
    for (const refusal of ['No me interesa el proyecto', 'No quiero comprar', 'Sólo por curiosidad', 'Número equivocado']) {
      const semantics = { primary_intent: 'answer_previous', confidence: 'high',
        answer_to_previous: { kind: 'negative', confidence: 'high', question_id: 'financing_invitation', evidence: refusal } }
      const engagement = commercialEngagement(refusal, [], { passive_sales: false, property_interest: true }, { ...input, semantics })
      assert.equal(engagement.passive, true)
      assert.equal(engagement.interested, false)
      assert.equal(engagement.property_continuation_allowed, false)
    }
  })

  it('versioned engagement survives a search, scoped financing refusal and later factual price query', () => {
    const search = 'Estoy buscando algo de cinco dormitorios para mi familia'
    const searchTurn = turn(search, { semantics: { primary_intent: 'select_property', confidence: 'high',
      property: { operation: 'search', confidence: 'high', evidence: search, filters: { bedrooms: 5 } } },
      intent: { objective: 'select_property', scope: { kind: 'property' }, requests: [{ domain: 'property', confidence: 'high', evidence: search }] } })
    const afterSearch = rememberSalesReply(saved, [], search, 'Tenemos alternativas de tres dormitorios.', searchTurn)
    assert.equal(afterSearch.engagement_version, COMMERCIAL_ENGAGEMENT_VERSION)
    assert.equal(afterSearch.passive_sales, false)
    const history = [{ role: 'cliente', content: search }, { role: 'bot', content: '¿Desea continuar con una revisión financiera?' }]
    const refusal = 'No me interesa el financiamiento'
    const refusalTurn = turn(refusal, { semantics: { primary_intent: 'answer_previous', confidence: 'high',
      answer_to_previous: { question_id: 'financing_invitation', kind: 'negative', evidence: refusal, confidence: 'high' } },
      intent: { objective: 'answer_previous', scope: { kind: 'property' }, requests: [] },
      pendingQuestion: { id: 'financing_invitation', question: '¿Desea continuar con una revisión financiera?' } })
    const afterRefusal = rememberSalesReply(afterSearch, history, refusal, 'Entiendo. Atenderemos sus consultas sobre las opciones.', refusalTurn)
    assert.equal(afterRefusal.passive_sales, false)
    const price = '¿Qué precio tienen estas opciones?'
    const priceHistory = [...history, { role: 'cliente', content: refusal }, { role: 'bot', content: 'Entiendo. Atenderemos sus consultas sobre las opciones.' }]
    const priceTurn = turn(price, { intent: { objective: 'ask_price', scope: { kind: 'property' }, requests: [{ domain: 'property', evidence: price, confidence: 'high' }] } })
    const priceEngagement = commercialEngagement(price, priceHistory, afterRefusal, priceTurn)
    assert.equal(priceEngagement.passive, false)
    assert.equal(priceEngagement.interested, true)
    assert.equal(priceEngagement.property_continuation?.property_interest_renewed, false)
    const afterPrice = rememberSalesReply(afterRefusal, priceHistory, price, 'Estos son los precios.', priceTurn)
    assert.equal(afterPrice.passive_sales, false)
    assert.equal(afterPrice.property_interest, true)
  })

  it('a versioned global refusal stays passive despite old historical interest, while legacy reconciliation is preserved', () => {
    const current = '¿Qué precio tienen esas opciones?'
    const history = [{ role: 'cliente', content: 'Ahora sí quiero comprar un departamento' }]
    const snapshot = { ...saved, engagement_version: COMMERCIAL_ENGAGEMENT_VERSION }
    assert.equal(commercialEngagement(current, history, snapshot, turn(current)).passive, true)
    assert.equal(commercialEngagement(current, history, snapshot).passive, false, 'Three-argument callers retain legacy historical reconciliation')
    assert.equal(commercialEngagement(current, history, saved, turn(current)).passive, false, 'Unversioned memory retains migration reconciliation')
    assert.equal(commercialEngagement('No quiero comprar', history,
      { passive_sales: false, property_interest: true, engagement_version: COMMERCIAL_ENGAGEMENT_VERSION }, turn('No quiero comprar')).passive, true)
  })

  it('the current canonical out-of-scope turn enters informational mode without changing mixed property requests', () => {
    const snapshot = { passive_sales: false, property_interest: true, engagement_version: COMMERCIAL_ENGAGEMENT_VERSION }
    const current = 'Gracias, entendido'
    const acknowledgment = commercialEngagement(current, [], snapshot, turn(current, { scope: { kind: 'out_of_scope' },
      semantics: { primary_intent: 'other', confidence: 'high' }, intent: { objective: 'other', requests: [] } }))
    assert.equal(acknowledgment.passive, true)
    assert.equal(acknowledgment.interested, false)
    assert.equal(acknowledgment.property_continuation_allowed, false)
    const mixed = commercialEngagement('¿Qué precios tienen?', [], snapshot, turn('¿Qué precios tienen?', { scope: { kind: 'mixed' } }))
    assert.equal(mixed.passive, false)
    assert.equal(mixed.property_continuation_allowed, true)
  })

  it('accepting a verified alternative permits its clarification without selecting a unit or authorizing another operation', () => {
    const current = 'está bien'
    const input = turn(current, {
      semantics: { primary_intent: 'answer_previous', confidence: 'high', property: {},
        answer_to_previous: { kind: 'affirmative', confidence: 'high', question_id: 'property_requirements', evidence: current } },
      intent: { objective: 'answer_previous', requests: [] },
      pendingQuestion: { id: 'property_requirements', act: 'explore_alternatives', question: '¿Desea revisar las opciones de tres dormitorios?', proposed_query: { filters: { bedrooms: 3 } } },
    })
    const engagement = commercialEngagement(current, [], saved, input)
    assert.equal(engagement.passive, true)
    assert.equal(engagement.property_continuation_allowed, true)
    assert.equal(engagement.property_continuation?.property_interest_renewed, false)
  })

  it('a real imperative CTA has the same authority as a question with punctuation', () => {
    const current = 'La cuarta'
    const input = turn(current, {
      semantics: { confidence: 'high', primary_intent: 'answer_previous', property: {},
        answer_to_previous: { kind: 'value', confidence: 'high', question_id: 'property_floor', evidence: current } },
      intent: { objective: 'answer_previous', requests: [] },
      pendingQuestion: { id: 'property_floor', act: 'choose_floor', question: 'Indíqueme qué planta prefiere entre la segunda y la quinta.' },
    })
    const engagement = commercialEngagement(current, [], saved, input)
    assert.equal(engagement.passive, true)
    assert.equal(engagement.property_continuation_allowed, true)
    assert.equal(engagement.property_continuation?.reason, 'current_answer_to_property_question')
  })

  it('an operator without a concrete numeric or category criterion does not renew a search', () => {
    const current = 'Quiero ver qué hay'
    const input = turn(current, {
      semantics: { confidence: 'high', primary_intent: 'select_property', property: { confidence: 'high', operation: 'search', evidence: current, filters: { bedrooms_operator: 'eq', bedrooms_required: false, bedrooms: null } } },
      intent: { objective: 'select_property', requests: [{ domain: 'property', confidence: 'high', evidence: current }] },
    })
    const engagement = commercialEngagement(current, [], saved, input)
    assert.equal(engagement.passive, true)
    assert.equal(engagement.property_continuation_allowed, true)
    assert.equal(engagement.property_continuation?.property_interest_renewed, false)
  })

  for (const [name, overrides] of [
    ['no question', { pendingQuestion: {} }],
    ['paragraph inferred as a question', { pendingQuestion: { id: 'property_category', question: 'Tenemos departamentos y penthouses.' } }],
    ['a financing question', { pendingQuestion: { id: 'financing_invitation', question: '¿Desea financiamiento?' } }],
    ['a foreign scope', { scope: { kind: 'other', uncertain: false } }],
    ['an uncertain scope', { scope: { kind: 'property', uncertain: true } }],
  ] as const) {
    it(`does not authorize a bare acknowledgment with ${name}`, () => {
      const current = 'está bien'
      const input = turn(current, {
        semantics: { confidence: 'high', primary_intent: 'answer_previous', property: {},
          answer_to_previous: { kind: 'affirmative', confidence: 'high', question_id: name === 'a financing question' ? 'financing_invitation' : 'property_category', evidence: current } },
        intent: { objective: 'answer_previous', requests: [] }, ...overrides,
      })
      const engagement = commercialEngagement(current, [], saved, input)
      assert.equal(engagement.passive, true)
      assert.equal(engagement.property_continuation_allowed, false)
      assert.equal(engagement.property_continuation?.property_interest_renewed, false)
    })
  }

  it('historical and unsupported evidence cannot open the current search', () => {
    const current = 'gracias'
    for (const input of [
      turn(current, { intent: { objective: 'project_information', requests: [{ domain: 'property', confidence: 'high', source: 'pending', evidence: current }] }, semantics: {} }),
      turn(current, { intent: { objective: 'select_property', requests: [] }, semantics: { confidence: 'high', property: { confidence: 'high', operation: 'search', evidence: 'quiero departamentos', category: 'departamento' } } }),
      turn(current, { scope: { kind: 'other' } }),
      turn(current, { scope: { kind: 'property', uncertain: true } }),
    ]) assert.equal(requestedPropertyContinuation(current, input).allowed, false)
  })

  it('declining an alternative does not repeat a qualification invitation', () => {
    const current = 'No, necesito cinco'
    const input = turn(current, {
      semantics: { confidence: 'high', primary_intent: 'answer_previous', property: {},
        answer_to_previous: { kind: 'negative', confidence: 'high', question_id: 'property_requirements', evidence: current } },
      intent: { objective: 'answer_previous', requests: [] },
      pendingQuestion: { id: 'property_requirements', question: '¿Desea revisar alternativas de tres dormitorios?' },
    })
    assert.equal(requestedPropertyContinuation(current, input).allowed, false)
    assert.equal(requestedPropertyContinuation(current, input).reason, 'current_property_choice_declined')
  })

  it('the shared rules and text fallback retain a pertinent property question and remove unrelated finance and budget offers', () => {
    const current = 'Indíqueme las opciones de tres dormitorios'
    const state = commercialEngagement(current, [], saved, turn(current))
    assert.match(passiveSalesRules(state), /solicitud actual.*permite una pregunta pertinente/)
    const reply = 'Tenemos departamentos y penthouses de tres dormitorios. ¿Cuál le interesa? ¿Tiene algún presupuesto? Si desea, podemos coordinar financiamiento con JEP.'
    const kept = passiveSalesCopy(reply, current, state)
    assert.match(kept, /¿Cuál le interesa\?/)
    assert.doesNotMatch(kept, /presupuesto|JEP|financiamiento/)
    assert.doesNotMatch(passiveSalesCopy(reply, current, { passive: true, interested: false }), /¿Cuál le interesa\?/)
  })
})
