import test from 'node:test'
import assert from 'node:assert/strict'
import { withPromptCostComparison, promptCostComparison } from './prompt-cost-comparison'
import { beginModelTrace, withAIExecutionTrace } from './ai-execution-trace'
import { AutomationExecutionTrace } from './execution-trace'
import { object, type Row } from './data'

test('only aggregate alternate sizes persist; model snapshot stays compact and concurrent calls stay isolated', async () => {
  let stored: Row[] = []
  const trace = new AutomationExecutionTrace([{ id: '00000000-0000-4000-8000-000000000001' }],
    { persist: async rows => { stored = rows; return { error: null } } })
  await withAIExecutionTrace(trace, async () => {
    await Promise.all([withPromptCostComparison({ catalog: 'NORMAL_PRIVATE_CONTEXT'.repeat(50) }, async () => {
      await Promise.resolve()
      beginModelTrace('rules', 'gpt-4.1', 'writing', { small: true }, {}).finish(undefined,
        { input_tokens: 100, output_tokens: 10, input_tokens_details: { cached_tokens: 0 } })
    }), (async () => {
      await Promise.resolve()
      beginModelTrace('other rules', 'gpt-4.1', 'data', { unrelated: true }, {}).finish()
    })()])
  })
  await trace.flush()
  const calls = stored.filter(r => r.step_key === 'model_request')
  const writer = calls.find(r => object(r.input_summary).task === 'writing')!
  const comparison = object(object(writer.input_summary).context_cost_comparison)
  assert.ok(Number(comparison.normal_prompt_characters) > Number(comparison.actual_prompt_characters))
  assert.deepEqual(object(object(writer.input_summary).prompt_snapshot).data, { small: true })
  assert.doesNotMatch(JSON.stringify(stored), /NORMAL_PRIVATE_CONTEXT/)
  assert.equal(object(calls.find(r => object(r.input_summary).task === 'data')!.input_summary).context_cost_comparison, undefined)
  assert.equal(promptCostComparison('rules', {}, {}), null)
})
