import test from 'node:test'
import assert from 'node:assert/strict'
import { completeTurnReply } from './turn-completeness'
import { rememberTurnIntentAfterReply } from './turn-intent'
import { deliveredPendingQuestion } from './continuation-question'
import { withResponseReviewPolicy } from './response-review-policy'
import { writerFixture } from './fixtures/writer-response.fixture'
import { object, type Row } from './data'

test('writer request IDs close only the identified customer request after accepted delivery', async () => {
  const price = '¿Cuánto cuesta?', policy = '¿Permiten mascotas?', current = `${price} ${policy}`
  const intent = { price_request_status: 'pending', current_message: current, required_facts: ['price'],
    requests: [{ domain: 'property', evidence: price, request: price, topics: ['purchase_price'] },
      { domain: 'project', evidence: policy, request: policy }] }
  for (const requested of [price, policy, 'unknown']) {
    const result = await withResponseReviewPolicy({ enabled: false, updatedAt: null }, () => completeTurnReply({
      current, baseReply: '', verified: { contrato_turno: intent }, audit: { resolved_turn_intent: intent },
    }, async (_rules, input) => {
      const refs = input.referencias_solicitud as Row[]
      const id = refs.find(ref => ref.text === requested)?.id || 'R99'
      return writerFixture({ reply: 'Información de referencia para su consulta.', question: null,
        requests: [{ fragment: id, status: 'answered', fact_key: 'price', intent: 'ask_price', request_type: 'general_information', evidence: 'Respuesta simulada' }] })
    }))
    const coverage = (result.audit.requests as Row[])[0]
    assert.equal(coverage.fragment, requested === 'unknown' ? 'R99' : requested)
    assert.match(String(coverage.request_id), /^R\d+$/)
    assert.equal(rememberTurnIntentAfterReply(intent, result.audit, { accepted: true, recovery: false }).price_request_status,
      requested === price ? 'answered' : 'pending')
    assert.equal(rememberTurnIntentAfterReply(intent, result.audit, { accepted: false, recovery: false }).price_request_status, 'pending')
  }
})

test('continuation IDs retain a verified plan scope without widening it when catalogue rows are omitted', () => {
  const metadata = { text: '¿Qué opción desea revisar?', continuation_id: 'unit_choice', continuation_act: 'choose_unit',
    purpose: 'choose_property', target_ids: ['injected'], candidate_ids: ['u602', 'u605', 'injected'] }
  const plan = { question_id: 'unit_choice', question_act: 'choose_unit', selection_scope: { unit_ids: ['u602', 'u605'] } }
  const pending = deliveredPendingQuestion('Texto opaco para el servidor.', { metadata, plan })
  assert.deepEqual(pending.candidate_ids, ['u602', 'u605'])
  assert.deepEqual(pending.target_ids, [])
  assert.deepEqual(deliveredPendingQuestion('', { metadata, plan }, []).candidate_ids, [], 'An explicitly empty catalogue stays authoritative')
  assert.deepEqual(deliveredPendingQuestion('', { metadata, plan: { ...plan, question_act: 'confirm_unit' } }).candidate_ids, [])
  assert.equal(object(pending).act, 'choose_unit')
})
