import test from 'node:test'
import assert from 'node:assert/strict'
import profileFixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { unansweredInbound } from './pending-inbound'
import { interpretConversationTurn } from './turn-interpretation'

const client = (id: string, content: string): Row => ({ role: 'cliente', external_message_id: id, content })
const question = 'quiero saber como funciona el financiaeminto'
const current = 'y cuanto deberia ajustar'

test('a timed out message survives recovery notices and closes only on an accepted substantive receipt', () => {
  const messages = [client('fin', question), { role: 'bot', content: 'Aviso', model_used: 'system:generation-recovery' }, client('adjust', current)]
  const pending = unansweredInbound(messages, ['adjust'])
  assert.deepEqual(pending.map(row => row.message_id), ['fin'])
  const receipt = { role: 'bot', tool_calls: { answered_message_ids: ['fin', 'adjust'], provider_status: 'accepted' } }
  assert.deepEqual(unansweredInbound([...messages, receipt], []), [])
  assert.equal(unansweredInbound([...messages, { ...receipt, tool_calls: { answered_message_ids: ['fin'], provider_status: 'failed' } }], []).length, 2)
})

test('human replies and legacy bot replies close old requests without treating a newer client message as answered', () => {
  for (const role of ['asesor', 'bot']) assert.deepEqual(unansweredInbound([client('old', question), { role }, client('new', current)], [])
    .map(row => row.message_id), ['new'])
})

test('extractor keeps a pending financing query alongside the current adjustment without replaying consent', async () => {
  const raw = structuredClone(profileFixture) as Row
  raw.full_name = raw.residence_city = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.requests = [{ domain: 'property', request: 'Cuánto ajustar el presupuesto', evidence: current, confidence: 'high' },
    { domain: 'financing', request: 'Explicar financiamiento', evidence: question, confidence: 'high' },
    { domain: 'advisor', request: 'Asesor', evidence: 'quiero un asesor', confidence: 'high' }]
  const semantics = object(raw.turn_semantics)
  semantics.primary_intent = 'discuss_budget'; semantics.primary_evidence = current
  semantics.budget = { status: 'not_discussed', amount: null, confidence: 'low', evidence: '' }
  semantics.answer_to_previous = { kind: 'none', question_id: 'none', confidence: 'low', evidence: '' }
  const result = await interpretConversationTurn({ mensaje_actual: current, consultas_pendientes: [
    { message_id: 'fin', content: question }, { message_id: 'old-action', content: 'quiero un asesor' }], resumen: {} }, {
    activePrompt: async () => 'Extractor', aiJson: async (_rules, input) => {
      assert.equal((object(input).consultas_pendientes as Row[]).length, 2)
      return raw
    },
  })
  assert.equal(result.requests.length, 2)
  assert.equal(result.requests[1].source_message_id, 'fin')
  assert.equal(result.extracted.requested_advisor, false)
  assert.equal(result.extracted.financing_consent, null)
})
