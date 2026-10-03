import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogSearchExplanation } from './catalogSearchExplanation'
import { explainStep, stepTitle } from './messageExplanation'
import { ARCHITECTURE_NODES, nodeState } from './architectureGraph'
import { workflowFromExecution, type WorkflowExecution, type WorkflowExecutionStep } from './executionWorkflow'

test('a historical completed step with applied false never claims embeddings were used', () => {
  const step = { order: 15, key: 'catalog_embedding_search', label: 'Búsqueda de unidades por embeddings',
    status: 'succeeded', input: { enabled: true }, output: { enabled: true, applied: false, reason: 'requires_current_search' } } as WorkflowExecutionStep
  const execution = { steps: [step] } as WorkflowExecution
  assert.equal(stepTitle(step), 'Búsqueda anterior utilizada')
  assert.match(explainStep(execution, step).summary, /no significa que se hayan utilizado embeddings/)
  assert.equal(workflowFromExecution(execution)?.nodes[0].data.title, 'Búsqueda anterior utilizada')
})

test('map branches and diagnostics distinguish applied retrieval from intentional bypass', () => {
  const applied = { key: 'catalog_embedding_search', status: 'succeeded', input: {},
    output: { applied: true, reason: 'semantic_candidates', selected_unit_ids: ['one', 'two'] } } as unknown as WorkflowExecutionStep
  const bypassed = { ...applied, status: 'skipped', output: { applied: false, reason: 'budget_context' } }
  assert.match(catalogSearchExplanation(applied.output).summary, /2 candidatas/)
  assert.match(catalogSearchExplanation(bypassed.output).reason, /presupuesto/)
  assert.equal(nodeState(ARCHITECTURE_NODES.find(n => n.id === 'embedding_applied')!, [applied]), 'observed')
  assert.equal(nodeState(ARCHITECTURE_NODES.find(n => n.id === 'embedding_applied')!, [bypassed]), 'not_selected')
  assert.equal(nodeState(ARCHITECTURE_NODES.find(n => n.id === 'embedding_bypassed')!, [bypassed]), 'skipped')
})
