import test from 'node:test'
import assert from 'node:assert/strict'
import Ajv from 'ajv'
import profileFixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { interpretConversationTurn, TURN_EXTRACTION_SCHEMA } from './turn-interpretation'
import { REQUEST_TOPICS, REQUEST_TOPICS_SCHEMA, REQUEST_TOPICS_RULES, normalizedRequestTopics } from './request-topics'

function extraction(current: string): Row {
  const raw: Row = structuredClone(profileFixture)
  raw.full_name = raw.residence_city = raw.residence_country = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  Object.assign(object(raw.turn_semantics), { primary_intent: 'other', primary_evidence: current,
    answer_to_previous: { kind: 'none', question_id: 'none', evidence: '', confidence: 'low' } })
  return raw
}

test('request topics are a closed schema with explicit legacy absence and normalized known values', () => {
  const validate = new Ajv().compile(REQUEST_TOPICS_SCHEMA)
  assert.ok(validate([...REQUEST_TOPICS]))
  assert.equal(validate(['grant_financing_consent']), false)
  assert.equal(normalizedRequestTopics(undefined), undefined)
  assert.deepEqual(normalizedRequestTopics([]), [])
  assert.deepEqual(normalizedRequestTopics(['location', 'unknown', 'location', 'delivery', 3]), ['location', 'delivery'])
  const raw = extraction('¿Dónde están?')
  raw.requests = [{ domain: 'property', request: 'Ubicación', evidence: '¿Dónde están?', confidence: 'high', topics: ['location'] }]
  const live = new Ajv().compile(TURN_EXTRACTION_SCHEMA)
  assert.ok(live(raw), JSON.stringify(live.errors))
  delete (raw.requests as Row[])[0].topics
  assert.equal(live(raw), false)
})

test('multiple current and validated pending requests preserve their separate requested subjects', async () => {
  const current = '¿Dónde está y ya comenzó la construcción? También quiero ver los departamentos', raw = extraction(current)
  raw.requests = [
    { domain: 'property', request: 'Ubicación y estado', evidence: '¿Dónde está y ya comenzó la construcción?', confidence: 'high', topics: ['location', 'construction_status'] },
    { domain: 'property', request: 'Ver departamentos', evidence: 'quiero ver los departamentos', confidence: 'high', topics: ['visualization', 'property_options', 'visualization'] },
    { domain: 'financing', request: 'Préstamo pendiente', evidence: '¿Ofrecen financiamiento?', confidence: 'high', topics: ['financing'] },
    { domain: 'property', request: 'Texto histórico no pendiente', evidence: '¿Cuánto cuesta?', confidence: 'high', topics: ['purchase_price'] },
  ]
  const result = await interpretConversationTurn({ mensaje_actual: current,
    consultas_pendientes: [{ message_id: 'pending-1', content: '¿Ofrecen financiamiento?' }] }, {
    activePrompt: async () => '', aiJson: async rules => { assert.ok(rules.includes(REQUEST_TOPICS_RULES)); return raw },
  })
  assert.deepEqual(result.requests.map(request => request.topics), [
    ['location', 'construction_status'], ['visualization', 'property_options'], ['financing'],
  ])
  assert.equal(result.requests[2].source, 'pending')
  assert.equal(result.requests[2].source_message_id, 'pending-1')
  assert.equal(result.extracted.financing_consent, null)
  assert.equal(result.extracted.requested_advisor, false)
})

test('legacy requests stay compatible and compact financing includes identical topic instructions', async () => {
  const current = 'Prefiero departamentos', raw = extraction(current)
  raw.requests = [{ domain: 'property', request: 'Explorar departamentos', evidence: current, confidence: 'high' }]
  const result = await interpretConversationTurn({ mensaje_actual: current, catalog_search: { embeddingsEnabled: true },
    contexto_propiedades: { selected_ids: ['202'] }, resumen: { _financing_journey: { accepted: true } } }, {
    activePrompt: async () => '', aiJson: async rules => {
      assert.ok(rules.includes(REQUEST_TOPICS_RULES))
      assert.ok(rules.includes('Está continuando una conversación financiera'))
      return raw
    },
  })
  assert.equal(Object.hasOwn(result.requests[0], 'topics'), false)
})
