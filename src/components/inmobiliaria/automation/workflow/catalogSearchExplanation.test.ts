import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogSearchDiagnostics, catalogSearchExplanation } from './catalogSearchExplanation'
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

test('exact filtering distinguishes a planned embedding model from one actually consulted', () => {
  const output = { version: 'catalog-retrieval-v3', optimized: true, applied: false, method: 'structured_catalog',
    model: 'text-embedding-3-small', embedding_model_planned: 'text-embedding-3-small', embedding_model_consulted: null,
    embedding_requested: false, embedding_input_tokens: 0, exact_filter_applied: true,
    query_source: 'catalog_request', resolved_query: { operation: 'search', scope: 'catalog', filters: { bedrooms: 5 } },
    reason: 'exact_catalog_query', ranking_reason: 'no_confirmed_matches', matched_count: 0, unknown_count: 0, selected_count: 0 }
  const diagnostics = catalogSearchDiagnostics(output)
  assert.equal(diagnostics.consultedModel, 'No se consultó')
  assert.equal(diagnostics.plannedModel, 'text-embedding-3-small')
  assert.match(diagnostics.method, /Filtros exactos/)
  assert.match(catalogSearchExplanation(output).reason, /No hubo coincidencias confirmadas/)
  const explanation = explainStep({ steps: [] } as unknown as WorkflowExecution,
    { order: 15, status: 'succeeded', key: 'catalog_embedding_search', input: {}, output } as unknown as WorkflowExecutionStep)
  assert.equal(explanation.found.find(fact => fact.label === 'Modelo de embeddings consultado')?.value, 'No se consultó')
  assert.ok(explanation.used.some(fact => fact.label === 'Consulta ejecutada' && /5/.test(fact.value)))
  assert.ok(!explanation.found.some(fact => fact.label === 'Modelo utilizado'))
})

test('provider consultation and use of vector ranking are separate decisions', () => {
  const output = { optimized: true, applied: false, method: 'structured_catalog', model: 'text-embedding-3-small',
    embedding_requested: true, embedding_model_consulted: 'text-embedding-3-small', embedding_usage_recorded: false,
    reason: 'exact_catalog_query', ranking_reason: 'semantic_ranking_unavailable' }
  assert.equal(catalogSearchDiagnostics(output).consultedModel, 'text-embedding-3-small')
  assert.match(catalogSearchDiagnostics(output).method, /sin ordenación vectorial/)
  assert.match(catalogSearchExplanation(output).reason, /no estuvo disponible/)
  const historical = catalogSearchDiagnostics({ model: 'text-embedding-3-small', embedding_input_tokens: 0, applied: false })
  assert.equal(historical.consultedModel, 'Sin registro de consulta')
  assert.equal(historical.requested, null)
})
