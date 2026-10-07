/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict')
const { cases } = require('./extractor-model-evals.cjs')
test('extractor benchmark spans distinct scenarios with independent semantic expectations', () => {
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length)
  assert.ok(cases.length >= 30)
  for (const c of cases) assert.equal(typeof c.check, 'function', c.id)
})
test('a price answer cannot authorize credit or selection of the referenced proposals', () => {
  const c = cases.find(c => c.id === 'price-of-proposal')
  const good = { turn_semantics: { primary_intent: 'ask_price', property: { reference_kind: 'followup', operation: 'details' } } }
  assert.equal(c.check(good), true)
  assert.equal(c.check({ ...good, financing_consent: true }), false)
  assert.equal(c.check({ ...good, visit_intent: { kind: 'accept_visit_preference' } }), false)
  assert.equal(c.check({ ...good, turn_semantics: { ...good.turn_semantics, property: { reference_kind: 'comparison', operation: 'compare' } } }), true)
  assert.equal(c.check({ ...good, turn_semantics: { ...good.turn_semantics, property: { reference_kind: 'none', operation: 'search' } } }), false)
  assert.equal(c.check({ ...good, turn_semantics: { ...good.turn_semantics, property: { ...good.turn_semantics.property, operation: 'select' } } }), false)
})

test('entry capital is not confused with a total budget, regardless of its supported representation', () => {
  const c = cases.find(c => c.id === 'down-payment-not-total')
  assert.equal(c.check({ turn_semantics: { budget: { status: 'initial_capital', amount: 40000 } } }), true)
  const amount = { role: 'down_payment', amount: 40000 }
  assert.equal(c.check({ financing_amounts: [amount], turn_semantics: { budget: { status: 'not_discussed', amount: null } } }), true)
  assert.equal(c.check({ financing_amounts: [amount], turn_semantics: { budget: { status: 'maximum_total', amount: 40000 } } }), false)
})
test('bank mention oracle catches a valid JSON but false entity selection', () => {
  const c = cases.find(c => c.id === 'bank-mention-not-choice')
  assert.equal(c.check({ financing_partner_choice: { kind: 'none' } }), true)
  assert.equal(c.check({ financing_partner_choice: { kind: 'select', name: 'Cooperativa JEP' } }), false)
})
test('uncertain acknowledgement cannot masquerade as an answer to a missing question', () => {
  const c = cases.find(c => c.id === 'ambiguous-acknowledgement')
  assert.equal(c.check({ turn_semantics: { answer_to_previous: { question_id: 'none' }, property: { operation: 'none' } } }), true)
  assert.equal(c.check({ turn_semantics: { answer_to_previous: { question_id: 'financing_invitation' }, property: { operation: 'none' } } }), false)
})
test('five occupants and five required bedrooms have different expectations', () => {
  const c = cases.find(c => c.id === 'mandatory-five')
  assert.equal(c.check({ turn_semantics: { property: { filters: { bedrooms: 5, bedrooms_required: true } } } }), true)
  assert.equal(c.check({ turn_semantics: { property: { filters: { bedrooms: 3, bedrooms_required: false } } } }), false)
})

test('informational cases reject invented tracking, unit selection and visit events', () => {
  const c = cases.find(c => c.id === 'price-of-proposal')
  const good = { turn_semantics: { primary_intent: 'ask_price', property: { reference_kind: 'followup', operation: 'details', unit_numbers: ['302','602'] } } }
  assert.equal(c.check(good), true)
  for (const extra of [{ consent_granted: true }, { tracking_consent: true }, { unit_id: 'eval-d302' },
    { events: ['requested_visit'] }]) assert.equal(c.check({ ...good, ...extra }), false)
  assert.equal(c.check({ ...good, turn_semantics: { ...good.turn_semantics, property: { ...good.turn_semantics.property, unit_numbers: ['eval-d302'] } } }), false)
})
test('requesting an advisor permits only that action, not a simultaneous invented visit', () => {
  const c = cases.find(c => c.id === 'explicit-advisor')
  const good = { requested_advisor: true }
  assert.equal(c.check(good), true)
  for (const extra of [{ opt_out: true }, { financing_consent: true }, { events: ['requested_visit'] },
    { visit_intent: { kind: 'request_visit' } }, { turn_semantics: { primary_intent: 'request_visit' } }])
    assert.equal(c.check({ ...good, ...extra }), false)
})
test('opt-out cannot grant unrelated consent or request an advisor', () => {
  const c = cases.find(c => c.id === 'opt-out')
  assert.equal(c.check({ opt_out: true }), true)
  for (const extra of [{ requested_advisor: true }, { financing_consent: true }, { consent_granted: true },
    { events: ['requested_visit'] }, { unit_id: 'eval-d302' }]) assert.equal(c.check({ opt_out: true, ...extra }), false)
})
test('refusing a name preserves the stated country without inventing purchase purpose', () => {
  const c = cases.find(c => c.id === 'refused-name')
  const good = { residence_country: 'España', full_name: null, purchase_purpose: null }
  assert.equal(c.check(good), true)
  assert.equal(c.check({ ...good, residence_country: null }), false)
  assert.equal(c.check({ ...good, full_name: 'Carlos' }), false)
  assert.equal(c.check({ ...good, purchase_purpose: 'vivir' }), false)
})
test('a request for two property categories cannot silently select or exclude one', () => {
  const c = cases.find(c => c.id === 'two-compatible-categories')
  const good = { turn_semantics: { property: { group: 'residential', category: null, operation: 'search', filters: { bedrooms: 3 } } } }
  assert.equal(c.check(good), true)
  assert.equal(c.check({ ...good, preferred_category: 'departamento' }), false)
  for (const change of [{ category: 'departamento' }, { excluded_categories: ['penthouse'] }, { group: 'commercial' }, { operation: 'select' }])
    assert.equal(c.check({ ...good, turn_semantics: { property: { ...good.turn_semantics.property, ...change } } }), false)
})
test('the office visit captures its destination, date and time using either supported input', () => {
  const c = cases.find(c => c.id === 'explicit-office-visit')
  const good = { visit_intent: { kind: 'request_visit', target: 'project', destination: 'office' },
    preferred_visit_time_text: 'mañana a las diez' }
  assert.equal(c.check(good), true)
  assert.equal(c.check({ ...good, preferred_visit_time_text: null, visit_preference: { date_text: 'mañana', time_text: '10:00' } }), true)
  assert.equal(c.check({ ...good, preferred_visit_time_text: null }), false)
  assert.equal(c.check({ ...good, preferred_visit_time_text: 'mañana' }), false)
  for (const change of [{ target: 'other' }, { destination: 'building' }])
    assert.equal(c.check({ ...good, visit_intent: { ...good.visit_intent, ...change } }), false)
  for (const extra of [{ requested_advisor: true }, { financing_consent: true }, { opt_out: true }])
    assert.equal(c.check({ ...good, ...extra }), false)
})
test('reserving the specified unit cannot reserve another one or authorize a visit', () => {
  const c = cases.find(c => c.id === 'explicit-reservation')
  const good = { turn_semantics: { reservation: { kind: 'request', unit_numbers: ['302'] },
    property: { operation: 'select', unit_numbers: ['302'] } } }
  assert.equal(c.check(good), true)
  assert.equal(c.check({ ...good, unit_id: '302' }), false)
  assert.equal(c.check({ ...good, unit_id: 'eval-d302' }), true)
  for (const extra of [{ requested_advisor: true }, { financing_consent: true }, { visit_intent: { kind: 'request_visit' } },
    { visit_intent: { kind: 'accept_visit_preference' } }, { events: ['requested_visit'] }]) assert.equal(c.check({ ...good, ...extra }), false)
  assert.equal(c.check({ ...good, turn_semantics: { ...good.turn_semantics, reservation: { kind: 'request', unit_numbers: ['602'] } } }), false)
})
test('accepting a financial review does not imply accepting a visit or tracking', () => {
  const c = cases.find(c => c.id === 'financing-acceptance')
  assert.equal(c.check({ financing_consent: true }), true)
  for (const extra of [{ requested_advisor: true }, { opt_out: true }, { events: ['requested_visit'] },
    { consent_granted: true }, { visit_intent: { kind: 'accept_visit_preference' } }])
    assert.equal(c.check({ financing_consent: true, ...extra }), false)
})

test('family capacity is an informational evaluation rather than a reservation or a new bedroom requirement', () => {
  const c = cases.find(c => c.id === 'people-evaluation')
  const good = { turn_semantics: { primary_intent: 'project_information',
    housing_quantities: [{ dimension: 'bedrooms', role: 'evaluation', values: [3] }, { dimension: 'people', role: 'context', values: [6] }],
    property: { operation: 'details', filters: { bedrooms: null } } } }
  assert.equal(c.check(good), true)
  for (const primary_intent of ['ask_price','ask_reservation','other'])
    assert.equal(c.check({ ...good, turn_semantics: { ...good.turn_semantics, primary_intent } }), false)
  assert.equal(c.check({ ...good, turn_semantics: { ...good.turn_semantics, housing_quantities: [] } }), false)
  assert.equal(c.check({ ...good, turn_semantics: { ...good.turn_semantics, property: { operation: 'search', filters: { bedrooms: 3 } } } }), false)
})

test('a current tracking acceptance authorizes follow-up without any other action', () => {
  for (const id of ['tracking-acknowledgement','tracking-interested-answer','tracking-explicit-request']) {
    const c = cases.find(c => c.id === id)
    assert.equal(c.check({ consent_granted: true }), true, id)
    assert.equal(c.check({ tracking_consent: true }), true, id)
    assert.equal(c.check({ consent_granted: false, tracking_consent: false }), false, id)
    for (const extra of [{ requested_advisor: true }, { opt_out: true }, { financing_consent: true },
      { events: ['requested_visit'] }, { visit_intent: { kind: 'accept_visit_preference' } }, { unit_id: 'eval-d302' },
      { turn_semantics: { reservation: { kind: 'request', unit_numbers: ['302'] } } }])
      assert.equal(c.check({ consent_granted: true, ...extra }), false, id)
  }
})
test('tracking acknowledgements refer to exactly one actual tracking question', () => {
  for (const id of ['tracking-acknowledgement','tracking-interested-answer']) {
    const c = cases.find(c => c.id === id)
    assert.equal((c.input.ultima_pregunta.match(/\?/g) || []).length, 1)
    assert.equal(c.input.historial.length, 1)
    assert.equal(c.input.historial[0].role, 'assistant')
    assert.equal(c.input.historial[0].content, c.input.ultima_pregunta)
  }
  assert.equal(cases.find(c => c.id === 'tracking-explicit-request').input.ultima_pregunta, undefined)
})


test('quoted opt-out and thematic rejection preserve only the current project request', () => {
  for (const [id, intent, evidence] of [
    ['quoted-third-party-opt-out', 'ask_price', 'Yo sólo quiero saber los precios'],
    ['topic-restriction-not-opt-out', 'project_information', 'sólo información del proyecto'],
  ]) {
    const c = cases.find(c => c.id === id)
    const good = { turn_semantics: { primary_intent: intent },
      requests: [{ domain: 'property', evidence, request: evidence, confidence: 'high' }] }
    assert.equal(c.check(good), true, id)
    for (const extra of [{ opt_out: true }, { requested_advisor: true }, { financing_consent: true },
      { consent_granted: true }, { visit_intent: { kind: 'request_visit' } }, { events: ['requested_visit'] },
      { unit_id: 'eval-d302' }]) assert.equal(c.check({ ...good, ...extra }), false, id)
    // A correct property request does not excuse a second quoted/denied
    // operational request, even if all permission flags happen to be false.
    for (const domain of ['contact', 'tracking', 'financing', 'appointment'])
      assert.equal(c.check({ ...good, requests: [...good.requests,
        { domain, request: 'No me escriban más', evidence: 'No me escriban más', confidence: 'high' }] }), false, id)
    assert.equal(c.check({ ...good, requests: [...good.requests,
      { domain: 'property', request: 'No quiero recibir mensajes sobre financiamiento',
        evidence: 'No quiero recibir mensajes sobre financiamiento', confidence: 'high' }] }), false, id)
    assert.equal(c.check({ ...good, requests: [] }), false, id)
    assert.equal(c.check({ ...good, requests: [{ domain: 'contact', evidence: 'No me escriban más' }] }), false, id)
    assert.equal(c.check({ ...good, turn_semantics: { primary_intent: 'opt_out' } }), false, id)
    assert.equal(c.check({ ...good, requests: [{ domain: 'property', evidence: 'Una pregunta inventada' }] }), false, id)
  }
})
