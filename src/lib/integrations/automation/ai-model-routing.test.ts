import assert from 'node:assert/strict'
import test from 'node:test'
import { aiRequestRole, automationModelForRole } from './ai-model-routing'

test('only scope classification and review use mini in the trial', () => {
  const env = { OPENAI_MODEL: 'gpt-4.1' }
  const cases = [
    { schema: { properties: { property_fragments: {} } }, task: 'writing', attachments: false, role: 'scope', model: 'gpt-4o-mini' },
    { schema: { properties: { turn_semantics: {} } }, task: 'data', attachments: false, role: 'extractor', model: 'gpt-4.1' },
    { schema: { properties: { requests: {}, question: {} } }, task: 'writing', attachments: false, role: 'writer', model: 'gpt-4.1' },
    { schema: { properties: { factual_values: {} } }, task: 'review', attachments: false, role: 'reviewer', model: 'gpt-4o-mini' },
    { schema: undefined, task: 'writing', attachments: false, role: 'draft', model: 'gpt-4.1' },
    { schema: undefined, task: 'data', attachments: true, role: 'media', model: 'gpt-4.1' },
  ] as const
  for (const item of cases) {
    const role = aiRequestRole(item.schema, item.task, item.attachments)
    assert.equal(role, item.role)
    assert.equal(automationModelForRole(role, env), item.model)
  }
})

test('each trial role can be rolled back without changing the other agents', () => {
  const env = { OPENAI_MODEL: 'gpt-4.1', OPENAI_MODEL_SCOPE: 'gpt-4.1', OPENAI_MODEL_REVIEWER: 'gpt-4.1' }
  assert.equal(automationModelForRole('scope', env), 'gpt-4.1')
  assert.equal(automationModelForRole('reviewer', env), 'gpt-4.1')
  assert.equal(automationModelForRole('writer', env), 'gpt-4.1')
})
