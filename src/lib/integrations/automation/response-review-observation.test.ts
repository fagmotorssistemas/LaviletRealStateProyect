import test from 'node:test'
import assert from 'node:assert/strict'
import { completeTurnReply, type TurnCompletenessInput } from './turn-completeness'
import { responseReviewObservationOnly, responseReviewEnabled, withResponseReviewPolicy, InvalidWriterTransportError } from './response-review-policy'
import { responseReviewSettings } from '@/lib/inmobiliaria/responseReview'
import { requireReviewedResponse } from './response-review-recovery'
import { operationalReply } from './operational-copy'
import { MAX_REPLY_CHARACTERS } from './response-plan'
import { OpenAIRequestError, AIRequestGuardError } from './openai-request'
import { object, type Row } from './data'

const demo = { ...responseReviewSettings(null), enabled: false, observationOnly: true }
const pass = { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
const noQuestion = { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' }
const input: TurnCompletenessInput = { current: 'Quiero información del departamento 202',
  baseReply: 'El departamento 202 tiene 3 dormitorios.', verified: { catalogo: [{ id: 'd202', category: 'departamento',
    unit_number: '202', bedrooms: 3, is_published: true, status: 'disponible' }] },
  audit: { semantic_review_enabled: true, business_risk_review_enabled: true } }
const run = (work: () => Promise<unknown>) => withResponseReviewPolicy(demo, work)
function harness(reply: string, review: Row | Error, question: unknown = noQuestion, requests: unknown = undefined) {
  const calls: string[] = []
  const generate: NonNullable<Parameters<typeof completeTurnReply>[1]> = async (_rules, raw, _schema, _image, _file, _tone, task = 'data') => {
    calls.push(task)
    if (task === 'review') { if (review instanceof Error) throw review; return review }
    const context = object(raw), ref = object((context.referencias_solicitud as Row[])[0])
    return { reply, question, requests: requests ?? [{ fragment: ref.id, intent: 'Información', request_type: 'general_information',
      status: 'answered', evidence: 'Respuesta contextual', fact_key: null }] }
  }
  return { calls, generate }
}
function assertObservation(result: Awaited<ReturnType<typeof completeTurnReply>>, passed: boolean) {
  assert.equal(result.audit.status, 'review_observed')
  assert.equal(object(result.audit.final_validation).passed, passed)
  assert.equal(object(result.audit.final_validation).policy, 'observation_only')
  assert.equal(object(result.audit.transport_validation).passed, true)
  assert.equal(object(result.audit.review_enforcement).blocking, false)
  assert.equal(object(result.audit.recovery).pending, false)
  assert.equal(result.needsAdvisor, false)
  assert.deepEqual(result.unresolved, [])
  assert.deepEqual(result.audit.repair_attempts, [])
}

test('observation is server owned, runs review even when the legacy enabled flag is false, and restores the normal policy', async () => {
  assert.equal(responseReviewObservationOnly(), false)
  await run(async () => { assert.equal(responseReviewEnabled(), true); assert.equal(responseReviewObservationOnly(), true) })
  assert.equal(responseReviewObservationOnly(), false)
})

test('a reviewed pass remains a pass but is delivered in observation mode', async () => {
  const mock = harness(input.baseReply, pass)
  await run(async () => {
    const result = await completeTurnReply(input, mock.generate)
    assertObservation(result, true)
    assert.equal(result.reply, input.baseReply)
    assert.equal(object(result.audit.semantic_review).status, 'checked')
    assert.deepEqual(mock.calls, ['writing', 'review'])
    assert.doesNotThrow(() => requireReviewedResponse(result.audit))
  })
})

for (const review of [
  { ...pass, verdict: 'block', findings: [{ category: 'hard_fact', statement: '3 dormitorios', reason: 'Hallazgo de demostración', authoritative_fact: 'Dato autorizado' }] },
  { ...pass, verdict: 'not_a_verdict' },
]) test('observation keeps rejected or malformed review results without rewriting or certifying the draft: '+review.verdict, async () => {
  const mock = harness(input.baseReply, review)
  await run(async () => {
    const result = await completeTurnReply(input, mock.generate)
    assertObservation(result, false)
    assert.equal(result.reply, input.baseReply)
    assert.deepEqual(mock.calls, ['writing', 'review'])
    assert.ok(['rejected', 'invalid_review'].includes(String(object(result.audit.semantic_review).status)))
    assert.doesNotThrow(() => requireReviewedResponse(result.audit))
  })
})

for (const failure of [new Error('OPENAI_INVALID_JSON'), new OpenAIRequestError(504, true, 1, 'timeout'), new AIRequestGuardError()])
  test('an unavailable reviewer preserves the same draft and records its failure: '+failure.message, async () => {
    const mock = harness(input.baseReply, failure)
    await run(async () => {
      const result = await completeTurnReply(input, mock.generate)
      assertObservation(result, false)
      assert.equal(result.reply, input.baseReply)
      assert.equal(object(result.audit.semantic_review).status, 'unavailable')
      assert.equal(object(result.audit.semantic_review).error_code, failure.message)
      assert.deepEqual(mock.calls, ['writing', 'review'])
    })
  })

test('commercial guard findings are monitored but still reach the reviewer and do not block the demonstration draft', async () => {
  const reply = 'El departamento 202 tiene 90 dormitorios. Su crédito ya está aprobado. https://example.com/otro'
  const mock = harness(reply, pass)
  await run(async () => {
    const result = await completeTurnReply(input, mock.generate)
    assertObservation(result, false)
    assert.equal(result.reply, reply)
    assert.deepEqual(mock.calls, ['writing', 'review'])
    assert.ok((object(result.audit.final_validation).issues as string[]).includes('unauthorized_link'))
    assert.equal(result.audit.operational_action_verified, false)
  })
})

test('recognized writer question recovers its meaning locally while other malformed metadata stays observed', async () => {
  const reply = '¿En qué planta le gustaría revisar opciones?'
  const wrong = { purpose: 'choose_property', role: 'optional_continuation', missing_datum: 'Planta', next_decision: 'Mostrar opciones',
    continuation_id: 'unit_choice', continuation_act: 'choose_unit' }
  const mock = harness(reply, pass, wrong, { malformed: true })
  await run(async () => {
    const result = await completeTurnReply(input, mock.generate)
    assertObservation(result, false)
    assert.equal(result.reply, reply)
    assert.equal(object(result.audit.follow_up).usable, true)
    assert.equal(object(result.audit.question).continuation_id, 'property_floor')
    assert.equal(object(result.audit.question_metadata_recovery).corrected, true)
    assert.deepEqual(mock.calls, ['writing', 'review'])
  })
})

test('unknown writer questions retain their warning without borrowing an action', async () => {
  const reply = '¿Qué le parece?'
  const wrong = { ...noQuestion, purpose: 'none', continuation_id: 'unit_choice', continuation_act: 'confirm_unit' }
  const mock = harness(reply, pass, wrong)
  await run(async () => {
    const result = await completeTurnReply(input, mock.generate)
    assert.equal(result.reply, reply)
    assert.equal(object(result.audit.follow_up).usable, false)
    assert.equal(object(result.audit.question_metadata_recovery).corrected, false)
    assert.deepEqual(mock.calls, ['writing', 'review'])
  })
})

test('a contradictory reviewer label does not replace the actual validated writer question', async () => {
  const reply = '¿En qué planta le gustaría revisar opciones?'
  const question = { purpose: 'choose_property', role: 'optional_continuation', missing_datum: 'Planta', next_decision: 'Mostrar opciones',
    continuation_id: 'property_floor', continuation_act: 'choose_floor' }
  const mock = harness(reply, { ...pass, question: { ...question, continuation_act: 'choose_unit', offered_action: 'none' } }, question)
  await run(async () => {
    const result = await completeTurnReply(input, mock.generate)
    assert.equal(result.reply, reply)
    assert.equal(object(result.audit.question).continuation_id, 'property_floor')
    assert.equal(object(result.audit.question).continuation_act, 'choose_floor')
    assert.equal(object(result.audit.follow_up).usable, true)
    assert.equal(object(result.audit.final_validation).passed, false)
    assert.ok((object(result.audit.final_validation).issues as string[]).includes('question_metadata_act_mismatch'))
    assert.deepEqual(mock.calls, ['writing', 'review'])
  })
})

for (const reply of ['', ' ', 'x'.repeat(MAX_REPLY_CHARACTERS + 1)])
  test('observation retains nonempty and length transport checks: '+reply.length, async () => {
    const mock = harness(reply, pass)
    await assert.rejects(run(() => completeTurnReply(input, mock.generate)), InvalidWriterTransportError)
    assert.deepEqual(mock.calls, ['writing'])
  })

test('a forged audit cannot bypass recovery outside the server demonstration setting', () => {
  assert.throws(() => requireReviewedResponse({ status: 'review_observed', review_control: { observationOnly: true },
    review_enforcement: { blocking: false }, recovery: { pending: true } }))
})

for (const review of [
  { fiel_a_los_hechos: false, conserva_estado_y_objetivo: false, no_pide_datos_conocidos: true, tono_natural: true },
  new Error('REVIEW_TIMEOUT'),
]) test('operational copy is reviewed and delivered unchanged in observation, including reviewer failures: '+String(review instanceof Error ? review.message : 'block'), async () => {
  const calls: string[] = [], reply = 'Su cita ya está confirmada.'
  const result = await withResponseReviewPolicy(demo, () => operationalReply('Su cita está pendiente.', 'Gracias', [], {},
    async (_rules, _context, _schema, _image, _file, _tone, task = 'data') => {
      calls.push(task)
      if (task === 'writing') return { mensaje: reply }
      if (review instanceof Error) throw review
      return review
    }))
  assert.equal(result.reply, reply)
  assert.equal(result.audit?.status, 'review_observed')
  assert.equal(object(result.audit?.final_validation).passed, false)
  assert.deepEqual(calls, ['writing', 'review'])
})

for (const semantic of [false, true]) test('observation evaluates the '+(semantic ? 'focused' : 'legacy')+' review route without metadata repairs or blocking', async () => {
  const review = semantic ? { review_contract: 'focused-review-v1', coverage: [], obligation_checks: [],
    claims: [], factual_values: [], project_values: [], numeric_checks: [], pending_checks: [],
    question: noQuestion, factual_inventory_complete: true, review_issues: [], missing_fact_fragments: [] }
    : { all_requests_considered: false, answers_supported: false, answered_content_preserved: true,
      operational_goal_preserved: true, question_has_purpose: true, question: { ...noQuestion, clarifies_request_ids: [] },
      missing_fact_fragments: [], review_issues: [] }
  const mock = harness(input.baseReply, review)
  await run(async () => {
    const result = await completeTurnReply({ ...input, audit: { semantic_review_enabled: semantic } }, mock.generate)
    assertObservation(result, false)
    assert.equal(result.reply, input.baseReply)
    assert.deepEqual(mock.calls, ['writing', 'review'])
  })
})

test('observation preparation preserves the common greeting, required brochure and price conditions before monitoring', async () => {
  const reply = 'El precio es $250,000.'
  const brochure = 'https://www.lavilett.com/materiales/brochure-la-vilet-v5.pdf'
  const mock = harness(reply, pass)
  await run(async () => {
    const result = await completeTurnReply({ ...input, verified: { politica_comercial: { precios_aproximados: true, precios_autorizados: true }, catalogo: [{ id: 'd202', category: 'departamento',
      unit_number: '202', published_commercial_price: 250000, is_published: true, status: 'disponible' }] },
      audit: { ...input.audit, writer_greeting: 'Hola', profile_introduction: { brochure_required: true, brochure_url: brochure } } }, mock.generate)
    assert.ok(result.reply.startsWith('Hola'))
    assert.ok(result.reply.includes(brochure))
    assert.match(result.reply, /referencial/i)
    assert.match(result.reply, /cambi/i)
    assert.deepEqual(mock.calls, ['writing', 'review'])
  })
})
