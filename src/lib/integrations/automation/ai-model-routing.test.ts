import assert from 'node:assert/strict'
import test from 'node:test'
import { aiRequestRole, automationModelForRole, automationReasoningEffortForRole } from './ai-model-routing'
import { aiRequestBody } from './ai-request-body'
import { aiOutputBudget } from './ai-output'

test('Luna extraction leaves writing, classification, review and media independent', () => {
  const env = { OPENAI_MODEL: 'gpt-4.1' }
  const cases = [
    { schema: { properties: { property_fragments: {} } }, task: 'writing', attachments: false, role: 'scope', model: 'gpt-4o-mini' },
    { schema: { properties: { turn_semantics: {} } }, task: 'data', attachments: false, role: 'extractor', model: 'gpt-6-luna' },
    { schema: { properties: { requests: {}, question: {} } }, task: 'writing', attachments: false, role: 'writer', model: 'gpt-4.1-mini' },
    { schema: { properties: { factual_values: {} } }, task: 'review', attachments: false, role: 'reviewer', model: 'gpt-5-mini' },
    { schema: undefined, task: 'writing', attachments: false, role: 'draft', model: 'gpt-4.1-mini' },
    { schema: undefined, task: 'data', attachments: true, role: 'media', model: 'gpt-4.1' },
    { schema: undefined, task: 'data', attachments: false, role: 'interpretation', model: 'gpt-4.1' },
    { schema: { properties: { requests: {}, question: {} } }, task: 'writing', attachments: true, role: 'media', model: 'gpt-4.1' },
  ] as const
  for (const item of cases) {
    const role = aiRequestRole(item.schema, item.task, item.attachments)
    assert.equal(role, item.role)
    assert.equal(automationModelForRole(role, env), item.model)
  }
})

test('low reasoning is limited to GPT-5 mini reviewers including snapshots', () => {
  for (const model of ['gpt-5-mini', 'gpt-5-mini-2025-08-07']) {
    assert.equal(automationReasoningEffortForRole('reviewer', model, {}), 'low')
    assert.equal(automationReasoningEffortForRole('reviewer', model, { OPENAI_REVIEW_REASONING_EFFORT: ' minimal ' }), 'minimal')
    for (const role of ['writer', 'extractor', 'scope', 'draft', 'interpretation', 'media'] as const)
      assert.equal(automationReasoningEffortForRole(role, model, {}), undefined)
  }
  for (const model of ['gpt-4o-mini', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-5', 'gpt-5-mini-invalid'])
    assert.equal(automationReasoningEffortForRole('reviewer', model, { OPENAI_REVIEW_REASONING_EFFORT: 'high' }), undefined)
})

test('reasoning override is validated only when applicable to the chosen reviewer model', () => {
  for (const effort of ['minimal', 'low', 'medium', 'high'])
    assert.equal(automationReasoningEffortForRole('reviewer', 'gpt-5-mini', { OPENAI_REVIEW_REASONING_EFFORT: effort }), effort)
  assert.throws(() => automationReasoningEffortForRole('reviewer', 'gpt-5-mini', { OPENAI_REVIEW_REASONING_EFFORT: 'unsupported' }),
    { message: 'OPENAI_REVIEW_REASONING_EFFORT_INVALID' })
  assert.equal(automationReasoningEffortForRole('reviewer', 'gpt-4.1', { OPENAI_REVIEW_REASONING_EFFORT: 'unsupported' }), undefined)
})

test('each trial role can be rolled back without changing the other agents', () => {
  const env = { OPENAI_MODEL: 'gpt-4.1', OPENAI_MODEL_EXTRACTOR: ' gpt-4.1 ', OPENAI_MODEL_SCOPE: 'gpt-4.1', OPENAI_MODEL_REVIEWER: 'gpt-4.1', OPENAI_MODEL_WRITER: ' gpt-4.1 ' }
  assert.equal(automationModelForRole('scope', env), 'gpt-4.1')
  assert.equal(automationModelForRole('reviewer', env), 'gpt-4.1')
  assert.equal(automationModelForRole('writer', env), 'gpt-4.1')
  assert.equal(automationModelForRole('draft', env), 'gpt-4.1')
  assert.equal(automationModelForRole('extractor', env), 'gpt-4.1')
  assert.equal(automationModelForRole('media', env), 'gpt-4.1')
})

test('a writer override is isolated and an empty override uses the trial default', () => {
  for (const override of ['', '   ', undefined]) {
    const env = { OPENAI_MODEL: 'gpt-4.1', OPENAI_MODEL_WRITER: override }
    assert.equal(automationModelForRole('writer', env), 'gpt-4.1-mini')
    assert.equal(automationModelForRole('draft', env), 'gpt-4.1-mini')
    assert.equal(automationModelForRole('extractor', env), 'gpt-6-luna')
  }
  const env = { OPENAI_MODEL: 'extractor-model', OPENAI_MODEL_WRITER: ' writer-trial ' }
  assert.equal(automationModelForRole('writer', env), 'writer-trial')
  assert.equal(automationModelForRole('draft', env), 'writer-trial')
  assert.equal(automationModelForRole('extractor', env), 'gpt-6-luna')
  for (const role of ['interpretation', 'media'] as const)
    assert.equal(automationModelForRole(role, env), 'extractor-model')
  assert.equal(automationModelForRole('scope', env), 'gpt-4o-mini')
  assert.equal(automationModelForRole('reviewer', env), 'gpt-5-mini')
})

test('extractor rollback and trial do not change any other agent', () => {
  for (const override of ['', '   ', undefined])
    assert.equal(automationModelForRole('extractor', { OPENAI_MODEL: 'gpt-4.1', OPENAI_MODEL_EXTRACTOR: override }), 'gpt-6-luna')
  for (const model of ['gpt-4.1-mini', 'gpt-4.1', 'gpt-6-luna', 'extractor-trial']) {
    const env = { OPENAI_MODEL: 'media-model', OPENAI_MODEL_EXTRACTOR: ` ${model} ` }
    assert.equal(automationModelForRole('extractor', env), model)
    for (const role of ['media', 'interpretation'] as const) assert.equal(automationModelForRole(role, env), 'media-model')
    for (const role of ['writer', 'draft'] as const) assert.equal(automationModelForRole(role, env), 'gpt-4.1-mini')
    assert.equal(automationModelForRole('scope', env), 'gpt-4o-mini')
    assert.equal(automationModelForRole('reviewer', env), 'gpt-5-mini')
  }
})

test('Luna extractor reasoning is isolated from reviewer controls and follows supported efforts', () => {
  assert.equal(automationReasoningEffortForRole('extractor', 'gpt-6-luna', {}), 'low')
  assert.equal(automationReasoningEffortForRole('extractor', 'gpt-6-luna', { OPENAI_REVIEW_REASONING_EFFORT: 'high' }), 'low')
  for (const effort of ['none', 'low', 'medium', 'high', 'xhigh', 'max'])
    assert.equal(automationReasoningEffortForRole('extractor', 'gpt-6-luna', { OPENAI_EXTRACTOR_REASONING_EFFORT: ` ${effort} ` }), effort)
  assert.throws(() => automationReasoningEffortForRole('extractor', 'gpt-6-luna', { OPENAI_EXTRACTOR_REASONING_EFFORT: 'minimal' }),
    { message: 'OPENAI_EXTRACTOR_REASONING_EFFORT_INVALID' })
  for (const model of ['gpt-4.1-mini', 'gpt-4.1', 'gpt-5-mini'])
    assert.equal(automationReasoningEffortForRole('extractor', model, { OPENAI_EXTRACTOR_REASONING_EFFORT: 'unsupported' }), undefined)
  for (const role of ['writer', 'scope', 'draft', 'reviewer', 'interpretation', 'media'] as const)
    assert.equal(automationReasoningEffortForRole(role, 'gpt-6-luna', { OPENAI_EXTRACTOR_REASONING_EFFORT: 'high' }), undefined)
  assert.equal(automationReasoningEffortForRole('reviewer', 'gpt-5-mini', { OPENAI_EXTRACTOR_REASONING_EFFORT: 'high' }), 'low')
})

test('Luna request retains the strict extraction schema and bounded output', () => {
  const env = { OPENAI_MODEL: 'gpt-4.1' }, schema = { type: 'object', properties: { turn_semantics: {} }, additionalProperties: false }
  const model = automationModelForRole('extractor', env)!
  const request = aiRequestBody({ model, instructions: 'Extract only current evidence.', input: { mensaje_actual: 'Sí, ese dinero sería para la entrada.' },
    schema, maxOutputTokens: aiOutputBudget(schema, 'data', {}), reasoningEffort: automationReasoningEffortForRole('extractor', model, env) })
  assert.equal(request.model, 'gpt-6-luna')
  assert.deepEqual(request.reasoning, { effort: 'low' })
  assert.equal(request.max_output_tokens, 4200)
  assert.deepEqual(request.text.format, { type: 'json_schema', name: 'lavilet_result', strict: true, schema })
  assert.equal(request.store, false)
  assert.equal('temperature' in request, false)
})
