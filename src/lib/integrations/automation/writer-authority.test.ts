import test from 'node:test'
import assert from 'node:assert/strict'
import { completeTurnReply, type TurnCompletenessInput } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { requireReviewedResponse } from './response-review-recovery'
import { object, type Row } from './data'
import { WRITER_CONTENT_REVIEW_VERSION } from './writer-content-review'

const input: TurnCompletenessInput = {
  current: 'Me gustaría tener más información sobre una suite',
  baseReply: 'Contamos con suites de un dormitorio.',
  verified: { catalogo: [
    { id: 's1', unit_number: '101', category: 'suite', bedrooms: 1, area_internal_m2: 49.86, area_exterior_m2: 9.34, is_published: true },
    { id: 's2', unit_number: '102', category: 'suite', bedrooms: 1, area_internal_m2: 73.86, area_exterior_m2: 22.14, is_published: true },
  ] },
  audit: { semantic_review_enabled: true, business_risk_review_enabled: true },
  validateReply: () => { throw Error('Server must not judge writer prose') },
  normalizeReply: () => { throw Error('Server must not rewrite writer prose') },
}
const pass = { review_contract: WRITER_CONTENT_REVIEW_VERSION, verdict: 'pass', findings: [] }
const block = { review_contract: WRITER_CONTENT_REVIEW_VERSION, verdict: 'block', findings: [
  { category: 'hard_fact', statement: 'El precio atribuido a la suite', reason: 'El importe no corresponde al catálogo', authoritative_fact: 'Consultar el precio publicado para la unidad' },
] }

for (const enabled of [true, false]) for (const draft of [
  'Las suites tienen 1 dormitorio y áreas interiores de 49.86 a 73.86 m², con espacios exteriores de 9.34 a 22.14 m².',
  'Al aire libre dispone de entre nueve coma treinta y cuatro y veintidós coma catorce metros cuadrados.',
  'Para el exterior: 9,34–22,14 m². En el interior encontrará superficies desde 49,86 hasta 73,86 m².',
]) test(`writer paraphrases remain intact with review ${enabled ? 'on' : 'off'}: ${draft.slice(0, 30)}`, async () => {
  const calls: string[] = []
  const result = await withResponseReviewPolicy({ enabled, updatedAt: null }, () => completeTurnReply(input,
    async (_rules, context, _schema, _image, _file, _tone, task) => {
      calls.push(task || '')
      if (task === 'review') { assert.equal(context.borrador, draft); return pass }
      // Defective auxiliary metadata must not block or replace a complete message.
      return { reply: draft, requests: null, question: { purpose: 'broken' } }
    }))
  assert.equal(result.reply, draft)
  assert.deepEqual(calls, enabled ? ['writing', 'review'] : ['writing'])
  assert.equal(result.audit.server_semantic_validation, false)
  assert.equal(result.needsAdvisor, false)
  assert.deepEqual(object(result.audit.final_validation).issues, [])
  assert.doesNotThrow(() => requireReviewedResponse(result.audit))
})

test('only an AI block requests a complete writer repair, followed by another AI review', async () => {
  const calls: string[] = [], first = 'La suite cuesta un dólar.', repaired = 'Podemos revisar el precio publicado de la suite que prefiera.'
  const result = await withResponseReviewPolicy({ enabled: true, updatedAt: null }, () => completeTurnReply(input,
    async (_rules, context, _schema, _image, _file, _tone, task) => {
      calls.push(task || '')
      if (task === 'review') return context.borrador === first ? block : pass
      if (calls.length === 1) return { reply: first }
      assert.deepEqual(object(context.reparacion).hallazgos_revisor, block.findings)
      return { reply: repaired }
    }))
  assert.equal(result.reply, repaired)
  assert.deepEqual(calls, ['writing', 'review', 'writing', 'review'])
  assert.equal(result.audit.status, 'checked')
  assert.equal((result.audit.repair_attempts as Row[]).length, 1)
})

test('exhausted AI rejection records recovery without assembling alternative commercial prose', async () => {
  const draft = 'La suite cuesta un dólar.'
  const calls: string[] = []
  const result = await withResponseReviewPolicy({ enabled: true, updatedAt: null }, () => completeTurnReply(input,
    async (_rules, _context, _schema, _image, _file, _tone, task) => {
      calls.push(task || '')
      return task === 'review' ? block : { reply: draft }
    }))
  assert.equal(result.reply, draft)
  assert.deepEqual(calls, ['writing', 'review', 'writing', 'review'])
  assert.equal(result.audit.status, 'rejected_review')
  assert.throws(() => requireReviewedResponse(result.audit), /RESPONSE_REVIEW_EXHAUSTED/)
})

test('observation preserves the original writer even for unsupported policies', async () => {
  const draft = 'Puede modificar libremente cualquier espacio.'
  const calls: string[] = []
  const result = await withResponseReviewPolicy({ enabled: false, observationOnly: true, updatedAt: null }, () => completeTurnReply(input,
    async (_rules, _context, _schema, _image, _file, _tone, task) => {
      calls.push(task || '')
      return task === 'review' ? { ...block, findings: [{ ...block.findings[0], category: 'unsupported_policy' }] } : { reply: draft }
    }))
  assert.equal(result.reply, draft)
  assert.deepEqual(calls, ['writing', 'review'])
  assert.equal(result.audit.status, 'review_observed')
  assert.equal(object(result.audit.observation).status, 'rejected')
  assert.doesNotThrow(() => requireReviewedResponse(result.audit))
})

test('a reservation sentence alone cannot execute or claim an operation in structured state', async () => {
  const result = await withResponseReviewPolicy({ enabled: false, updatedAt: null }, () => completeTurnReply(input,
    async () => ({ reply: 'Su reserva está confirmada.', question: null, writer_receipts: { presented_unit_ids: ['invented'] } })))
  assert.equal(result.needsAdvisor, false)
  assert.equal(result.audit.operational_action_verified, false)
  assert.deepEqual(object(result.audit.writer_receipts).presented_unit_ids, [])
})
