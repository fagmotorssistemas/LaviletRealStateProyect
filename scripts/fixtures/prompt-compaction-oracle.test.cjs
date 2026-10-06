/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict')
const fixtures = require('./prompt-compaction-evals.cjs')
const { commercialJourneyPlan } = require('../../src/lib/integrations/automation/commercial-journey.ts')

test('evaluation cases are unique and each has an independent semantic assertion', () => {
  const cases = [...fixtures.extractor, ...fixtures.writer]
  assert.equal(new Set(cases.map(c => c.id)).size, cases.length)
  for (const c of cases) assert.equal(typeof c.check, 'function', c.id)
})

test('price-of-proposal oracle rejects a catalogue restart and a fabricated advisor request', () => {
  const c = fixtures.extractor.find(c => c.id === 'price-of-proposal')
  const good = { turn_semantics: { primary_intent: 'ask_price', property: { reference_kind: 'followup', operation: 'details' } } }
  assert.equal(c.check(good), true)
  assert.equal(c.check({ ...good, requested_advisor: true }), false)
  assert.equal(c.check({ turn_semantics: { primary_intent: 'ask_price', property: { reference_kind: 'none', operation: 'search' } } }), false)
})

test('writer oracle requires both verified recommendation ranges and its invitation before budget', () => {
  const c = fixtures.writer.find(c => c.id === 'writer-recommend-alternative')
  const reply = 'No tenemos cinco dormitorios. Hay departamentos de 3 dormitorios con 120,83 m² y penthouses con 142,09 m². ¿Desea revisarlos?'
  assert.equal(c.check({ reply }), true)
  assert.equal(c.check({ reply: reply.replace('142,09', '109,69') }), false)
  assert.equal(c.check({ reply: reply.replace('¿Desea revisarlos?', '¿Cuál es su presupuesto?') }), false)
  assert.equal(c.check({ reply: 'No hay cinco dormitorios. Si desea, podemos revisar alternativas.' }), false)
})

for (const id of ['writer-recommend-alternative', 'writer-price-of-proposal']) {
  test(`live fixture includes the active commercial journey and real pending proposal: ${id}`, async () => {
    const c = fixtures.writer.find(c => c.id === id), input = await c.prepare()
    assert.ok(input.verified.recorrido_comercial)
    assert.equal(input.verified.catalogo_verificacion.length, 2)
    assert.equal(input.verified.property_context.query.filters.bedrooms, 5)
    const plan = commercialJourneyPlan(input.verified, input.audit)
    assert.equal(plan.action, 'clarify_requirements')
    assert.equal(plan.question_id, 'property_requirements')
    assert.equal(plan.financing_offer_allowed, false)
    assert.deepEqual(plan.alternative_unit_ids, ['eval-d302', 'eval-p602'])
    assert.ok(plan.question.includes('?'))
    if (id === 'writer-price-of-proposal') {
      assert.equal(input.verified.property_context.proposal_information.informational_only, true)
      assert.equal(input.audit.source, 'unit_price')
    }
  })
}
