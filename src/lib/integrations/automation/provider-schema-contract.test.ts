import test from 'node:test'
import assert from 'node:assert/strict'
import { completeTurnReply } from './turn-completeness'
import { continuationQuestionProperties } from './continuation-question'
import { BUSINESS_RISK_REVIEW_VERSION } from './business-risk-review'
import { object, type Row } from './data'

// Validate the strict object contract of the actual schemas sent by the flow.
// A mocked 200 response alone cannot detect an HTTP 400 invalid_json_schema.
function strictObjectIssues(value: unknown, path = '$'): string[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) return value.flatMap((v, i) => strictObjectIssues(v, `${path}[${i}]`))
  const schema = object(value), issues: string[] = []
  if (schema.type === 'object' || Array.isArray(schema.type) && schema.type.includes('object')) {
    const keys = Object.keys(object(schema.properties))
    const required = Array.isArray(schema.required) ? schema.required : []
    for (const key of keys) if (!required.includes(key)) issues.push(`${path}: missing required ${key}`)
    for (const key of required) if (!keys.includes(String(key))) issues.push(`${path}: unknown required ${key}`)
    if (schema.additionalProperties !== false) issues.push(`${path}: additionalProperties must be false`)
  }
  for (const key of ['properties', '$defs']) for (const [name, child] of Object.entries(object(schema[key])))
    issues.push(...strictObjectIssues(child, `${path}.${name}`))
  for (const key of ['items', 'anyOf', 'allOf', 'oneOf'])
    if (schema[key]) issues.push(...strictObjectIssues(schema[key], `${path}.${key}`))
  return issues
}

test('strict contract check detects both fields omitted in the Oct 15 incident', () => {
  const issues = strictObjectIssues({ type: 'object', additionalProperties: false,
    properties: continuationQuestionProperties, required: ['continuation_id', 'continuation_act'] })
  assert.deepEqual(issues, ['$: missing required comparison_categories', '$: missing required comparison_bedrooms'])
})

for (const current of ['¿Cómo es la zona?', '¿Cómo es la zona?\nclaro'])
  test('writer and reviewer strict object contracts: ' + current.replace(/\n/g, ' / '), async () => {
    const captured: { task: string; schema: Row }[] = []
    await completeTurnReply({ current, baseReply: 'Podemos orientarle sobre el proyecto.', verified: {},
      audit: { semantic_review_enabled: true, business_risk_review_enabled: true } },
    async (_instructions, _input, schema, _image, _file, _tone, task) => {
      captured.push({ task: String(task), schema: object(schema) })
      if (task === 'writing') return { reply: 'Podemos orientarle sobre el proyecto.', requests: [],
        question: { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none',
          continuation_act: 'other', comparison_categories: [], comparison_bedrooms: null } }
      return { review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'pass', findings: [], facts: [], question: null }
    })
    assert.ok(captured.some(call => call.task === 'writing'), 'The real writer request must be exercised')
    assert.ok(captured.some(call => call.task === 'review'), 'The real reviewer request must be exercised')
    for (const call of captured) assert.deepEqual(strictObjectIssues(call.schema), [], call.task)
    const question = object(object(captured.find(call => call.task === 'writing')!.schema.properties).question)
    for (const key of Object.keys(continuationQuestionProperties))
      assert.ok((question.required as string[]).includes(key), key)
  })
