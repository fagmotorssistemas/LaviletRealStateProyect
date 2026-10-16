import assert from 'node:assert/strict'
import test from 'node:test'
import { aiRequestRole } from './ai-model-routing'
import { type Row } from './data'
import { reviewWriterContent, writerContentReviewSchema, WRITER_CONTENT_REVIEW_VERSION } from './writer-content-review'

const pass = { review_contract: WRITER_CONTENT_REVIEW_VERSION, verdict: 'pass', findings: [] }
const finding = { category: 'hard_fact', statement: 'El precio indicado no coincide.', reason: 'La fuente contiene otro importe.',
  authoritative_fact: 'Precio publicado en la fuente autorizada.' }
const block = { ...pass, verdict: 'block', findings: [finding] }

test('the simplified contract selects the reviewer role and has no prose inventories', () => {
  assert.equal(aiRequestRole(writerContentReviewSchema, 'review', false), 'reviewer')
  assert.deepEqual(Object.keys((writerContentReviewSchema.properties as Row)), ['review_contract', 'verdict', 'findings'])
})

test('AI approval is final even for wording and figures that legacy code rejected', async () => {
  const reply = 'Áreas interiores de 49.86 a 73.86 m², con espacios exteriores de 9.34 a 22.14 m². '
    + 'El precio sería un dólar. Su crédito ya está aprobado. https://example.com/otra-ruta'
  let calls = 0
  const result = await reviewWriterContent(reply, { borrador: 'Borrador anterior', fuentes_autorizadas: { suites: 'Fuentes del turno' } },
    async (_instructions, context, schema, _image, _file, _tone, task) => {
      calls++
      assert.equal(task, 'review')
      assert.equal((context as Row).borrador, reply)
      assert.equal(schema, writerContentReviewSchema)
      return pass
    })
  assert.equal(calls, 1)
  assert.equal(result.approved, true)
  assert.equal(result.audit.status, 'checked')
  assert.equal(result.audit.authority, 'ai_reviewer')
  assert.deepEqual(result.findings, [])
})

test('a valid AI block is returned directly without code judging or matching its wording', async () => {
  let calls = 0
  const result = await reviewWriterContent('Precio: USD 1.', {}, async () => { calls++; return block })
  assert.equal(calls, 1)
  assert.equal(result.approved, false)
  assert.equal(result.audit.status, 'rejected')
  assert.deepEqual(result.findings, [finding])
  assert.equal(result.audit.metadata_retries, 0)
})

test('invalid review metadata receives one technical retry against the unchanged draft', async () => {
  const reply = 'El penthouse tiene tres dormitorios y terraza.'
  const contexts: Row[] = []
  const result = await reviewWriterContent(reply, { fuentes_autorizadas: { unidad: 'u605' } }, async (_instructions, context) => {
    contexts.push(context as Row)
    return contexts.length === 1 ? { ...pass, facts: [] } : pass
  })
  assert.equal(result.approved, true)
  assert.equal(result.audit.metadata_retries, 1)
  assert.equal(contexts.length, 2)
  assert.equal(contexts[0].borrador, reply)
  assert.equal(contexts[1].borrador, reply)
  assert.deepEqual((contexts[1].recuperacion_contrato as Row).validation_issues, ['review_fields_invalid'])
})

test('a malformed JSON result receives at most one technical retry', async () => {
  let calls = 0
  const repaired = await reviewWriterContent('Texto íntegro.', {}, async () => {
    if (++calls === 1) throw new SyntaxError('Invalid JSON')
    return pass
  })
  assert.equal(calls, 2)
  assert.equal(repaired.approved, true)
  calls = 0
  const exhausted = await reviewWriterContent('Texto íntegro.', {}, async () => {
    calls++
    throw new Error('OPENAI_INVALID_JSON')
  })
  assert.equal(calls, 2)
  assert.equal(exhausted.approved, false)
  assert.equal(exhausted.audit.status, 'invalid_review')
  assert.deepEqual(exhausted.audit.validation_issues, ['review_json_invalid'])
})

test('two invalid contracts cannot approve a draft or start an unbounded repair loop', async () => {
  for (const invalid of [
    { ...pass, verdict: 'maybe' },
    { ...pass, review_contract: 'old' },
    { ...pass, findings: [finding] },
    { ...block, findings: [] },
    { ...block, findings: [{ ...finding, category: 'turn_goal' }] },
    { ...block, findings: [{ ...finding, reason: 23 }] },
  ]) {
    let calls = 0
    const result = await reviewWriterContent('Respuesta.', {}, async () => { calls++; return invalid })
    assert.equal(calls, 2)
    assert.equal(result.approved, false)
    assert.equal(result.audit.status, 'invalid_review')
  }
})

test('provider failures propagate without a second content-review attempt', async () => {
  const failure = new Error('OPENAI_HTTP_429')
  let calls = 0
  await assert.rejects(reviewWriterContent('Respuesta.', {}, async () => { calls++; throw failure }), error => error === failure)
  assert.equal(calls, 1)
})
