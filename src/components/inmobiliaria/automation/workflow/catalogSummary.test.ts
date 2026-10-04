import test from 'node:test'
import assert from 'node:assert/strict'
import { catalogSummaries, hasCatalogSummary } from './catalogSummary'
import { ARCHITECTURE_NODES, nodeEvidence, nodeState } from './architectureGraph'
import type { WorkflowExecutionStep } from './executionWorkflow'

const call = (order: number, data: Record<string, unknown>, limited = false): WorkflowExecutionStep => ({ order,
  key: 'model_request', label: 'Redactor', category: 'ai', status: 'succeeded', source: '', startedAt: '', completedAt: '', durationMs: 10,
  input: { ai_role: 'writer', prompt_snapshot: { data, limited } }, output: {}, errorCode: null })
const evidence = () => ({ units: [
  { id: 'one', unit_number: 'LC-02', area_internal_m2: 95.37, area_exterior_m2: 46.74 },
  { id: 'two', unit_number: 'LC-03', area_internal_m2: 52.16, area_exterior_m2: null },
], groups: [
  { id: 'group:local:all:min', aggregation: 'min', member_ids: ['one', 'two'] },
  { id: 'group:local:all:range', aggregation: 'range', category: 'local', member_ids: { ref: 'evidencia_turno.groups.0.member_ids' },
    floor_number: 0, area_internal_m2: 52.16, upper_values: { floor_number: 0, area_internal_m2: 95.37 } },
] })

test('shows saved ranges, resolves compact memberships and never invents the missing exterior range', () => {
  const [summary] = catalogSummaries([call(19, { evidencia_turno: evidence(), contexto_verificado: { catalog_context_scope: { kind: 'semantic_candidates', complete: false } } })])
  assert.equal(summary.completeness, 'partial')
  assert.deepEqual(summary.groups[0].members, ['LC-02', 'LC-03'])
  assert.equal(summary.groups[0].ranges.find(r => r.field === 'area_internal_m2')?.min, 52.16)
  assert.equal(summary.groups[0].ranges.find(r => r.field === 'area_exterior_m2')?.min, null)
  assert.equal(summary.groups[0].ranges.find(r => r.field === 'floor_number')?.max, 0)
})

test('keeps unknown, bounded complete, partial and abbreviated captures distinct', () => {
  const base = { evidencia_turno: evidence() }
  assert.equal(catalogSummaries([call(1, base)])[0].completeness, 'unknown')
  const complete = { ...base, estado_operativo: { catalog_results: { complete: true } } }
  assert.equal(catalogSummaries([call(1, complete)])[0].completeness, 'complete')
  assert.equal(catalogSummaries([call(1, complete, true)])[0].limited, true)
  assert.equal(catalogSummaries([call(1, { ...complete, contexto_verificado: { catalog_context_scope: { kind: 'semantic_candidates' } } })])[0].completeness, 'partial')
  assert.equal(catalogSummaries([call(1, { ...complete, contexto_verificado: { catalog_context_scope: { kind: 'project_overview' } } })])[0].completeness, 'unknown')
})

test('uses only writer inputs, retains each call separately and ignores later retrievals', () => {
  const writer = call(2, { evidencia_turno: evidence() }), next = call(5, { evidencia_turno: { units: [], groups: [] } })
  const retrieval = { ...call(1, {}), key: 'catalog_embedding_search', output: { candidate_count: 16 } }
  const reviewer = { ...call(3, { evidencia_turno: evidence() }), input: { ...writer.input, ai_role: 'reviewer' } }
  const summaries = catalogSummaries([next, { ...retrieval, order: 6, output: { candidate_count: 99 } }, reviewer, writer, retrieval])
  assert.equal(summaries.length, 2)
  assert.deepEqual(summaries.map(s => s.units.length), [2, 0])
  assert.equal(summaries[0].candidateCount, 16)
  assert.equal(summaries[1].candidateCount, 16)
  assert.equal(hasCatalogSummary(call(7, {})), false)
})

test('missing or circular references remain unknown without borrowing other units', () => {
  const ev = evidence(); ev.groups[1].member_ids = { ref: 'evidencia_turno.groups.1.member_ids' }
  const [summary] = catalogSummaries([call(1, { evidencia_turno: ev })])
  assert.equal(summary.groups[0].members, null)
})

test('catalog node records saved evidence even when its writer fails and never invents a new execution step', () => {
  const spec = ARCHITECTURE_NODES.find(n => n.id === 'catalog_summary')!
  const writer = { ...call(19, { evidencia_turno: evidence() }), status: 'failed', errorCode: 'TIMEOUT' }
  assert.equal(nodeState(spec, [writer]), 'observed')
  assert.equal(nodeState(spec, [call(19, {})]), 'unknown')
  assert.deepEqual(nodeEvidence(spec, [writer]).map(s => s.order), [19])
})

test('optimized summaries distinguish all matches from examples and preserve unknown fields and unit numbers', () => {
  const ev = { ...evidence(), catalog_summary: { version: 'catalog-summary-v1', matching_count: 13, unknown_count: 3,
    exact_count: false, matching_unit_ids: ['one', 'outside-sample'], matching_unit_numbers: ['LC-02', 'LC-01'],
    unknown_units: [{ unit_number: 'LC-03', fields: ['area_exterior_m2'] }],
    statistics: { area_internal_m2: { min: 46.65, max: 137.98, known_count: 13, unknown_count: 0 } } },
    groups: [...evidence().groups, { id: 'group:catalog_query:all:range', source_scope: 'complete_query', category: 'local',
      aggregation: 'range', member_ids: ['one', 'outside-sample'], area_internal_m2: 46.65, upper_values: { area_internal_m2: 137.98 } }] }
  const [summary] = catalogSummaries([call(2, { evidencia_turno: ev, contexto_verificado: { catalog_context_scope: { kind: 'optimized_catalog', complete: false } } })])
  assert.equal(summary.optimized, true)
  assert.equal(summary.aggregate.matching_count, 13)
  assert.equal(summary.groups.length, 1)
  assert.deepEqual(summary.groups[0].members, ['LC-02', 'LC-01'])
  assert.equal(summary.statistics.find(s => s.field === 'area_internal_m2')?.max, 137.98)
  assert.equal(summary.unknownUnits[0].unit_number, 'LC-03')
})

test('exact reduced route is not presented as legacy fallback', () => {
  const step = { ...call(1, {}), key: 'catalog_embedding_search', output: { optimized: true, applied: false, method: 'structured_catalog' } }
  assert.equal(nodeState(ARCHITECTURE_NODES.find(n => n.id === 'catalog_exact')!, [step]), 'observed')
  assert.equal(nodeState(ARCHITECTURE_NODES.find(n => n.id === 'embedding_bypassed')!, [step]), 'not_selected')
})
