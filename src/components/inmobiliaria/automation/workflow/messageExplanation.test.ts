import test from 'node:test'
import assert from 'node:assert/strict'
import { conversationGroups, explainStep, humanValue, stepTitle } from './messageExplanation'
import type { WorkflowExecution, WorkflowExecutionStep } from './executionWorkflow'
import { promptContextParts } from './promptContext'

test('prompt colors preserve the captured JSON and identify nested conversational context only', () => {
  const data = { mensaje_actual: 'Y los precios?', contexto_verificado: {
    historial: [{ role: 'bot', content: 'Departamentos y penthouses. <script>literal</script>' }],
    property_context: { offered_ids: ['a', 'b'] }, catalogo: [{ id: 'a', bedrooms: 3 }],
    lead: { presupuesto: '[dato protegido]' }, historial_reciente: '[resumen limitado]',
  }, respuesta_base: 'Una propuesta, no historial.' }
  const parts = promptContextParts(data)
  assert.equal(parts.map(p => p.text).join(''), JSON.stringify(data, null, 2))
  assert.ok(parts.some(p => p.kind === 'current' && p.text.includes('Y los precios?')))
  assert.ok(parts.some(p => p.kind === 'history' && p.text.includes('Departamentos y penthouses')))
  assert.ok(parts.some(p => p.kind === 'history' && p.text.includes('[resumen limitado]')))
  assert.ok(parts.some(p => p.kind === 'memory' && p.text.includes('[dato protegido]')))
  assert.ok(parts.some(p => p.kind === 'other' && p.text.includes('bedrooms')))
  assert.ok(parts.some(p => p.kind === 'other' && p.text.includes('Una propuesta, no historial.')))
})

const step = (order: number, key: string, output: Record<string, unknown> = {}, input: Record<string, unknown> = {}): WorkflowExecutionStep => ({ order, key, label: key, category: 'decision', status: 'succeeded', source: 'test', startedAt: '', completedAt: '', durationMs: 2, errorCode: null, input, output })

test('pending messages remain alongside lead history before a conversation is assigned', () => {
  const old = { ...execution([]), id: 'old', leadGroupId: 'tenant:project:42', conversationId: 'conversation-1' }
  const pending = { ...old, id: 'new', conversationId: null, status: 'processing' }
  const unrelated = { ...pending, id: 'other', leadGroupId: 'tenant:other-project:42' }
  const groups = conversationGroups([pending, old, unrelated])
  assert.equal(groups.length, 2)
  assert.equal(groups[0].batches.length, 2)
  assert.equal(groups[0].batches[0].execution.status, 'processing')
  assert.equal(conversationGroups([{ ...pending, conversationId: 'conversation-1', status: 'completed' }, old])[0].id, groups[0].id)
})

test('AI labels use recorded function and do not mislabel historical scope calls as writers', () => {
  assert.match(stepTitle(step(1, 'model_request', {}, { ai_role: 'scope', task: 'writing' })), /Clasificador/)
  assert.match(stepTitle(step(1, 'model_request', {}, { ai_role: 'writer', task: 'writing' })), /Redactor/)
  assert.match(stepTitle(step(1, 'model_request', {}, { ai_role: 'extractor' })), /Extractor/)
  assert.match(stepTitle(step(1, 'model_request', {}, { task: 'writing' })), /histórica/)
})

test('invalid writer metadata separates rejection from advisor decision and never claims complete coverage', () => {
  const item = step(1, 'response_coverage', { status: 'invalid_coverage', requests: [], issues: ['requests[1].fragment: pregunta del bot'],
    needs_advisor: false, base_preview: 'Base', proposed_preview: 'Propuesta', final_preview: 'Base',
    decision: { reason: 'No se identificó un dato faltante que requiera derivación.' } })
  const result = explainStep(execution([item]), item)
  const sections = result.coverageSections!
  assert.equal(sections.length, 6)
  assert.match(sections[0].facts[0].value, /no se completó/)
  assert.match(sections[1].facts[0].value, /requests\[1\]/)
  assert.match(sections[3].facts[0].value, /No se registró/)
  assert.match(sections[4].facts[1].value, /Lista rechazada/)
  assert.match(sections[5].facts[0].value, /no solicitó/)
  assert.equal(result.reason, 'No se identificó un dato faltante que requiera derivación.')
})

test('repair outcome and incomplete historical evidence remain distinct', () => {
  const item = step(1, 'response_coverage', { status: 'checked', repair_attempts: [{ status: 'invalid_coverage', issues: ['fragment'], final_status: 'checked' }],
    requests: [{ fragment: 'Quiero información', status: 'answered', evidence: 'Descripción del proyecto' }] })
  const sections = explainStep(execution([item]), item).coverageSections!
  assert.match(sections[3].facts[0].value, /Resultado final: Revisión completada/)
  assert.match(sections[4].facts[1].value, /Descripción del proyecto/)
  const old = step(2, 'response_coverage')
  const historical = explainStep(execution([old]), old).coverageSections!
  assert.match(historical[0].facts[0].value, /no se puede determinar/)
  assert.match(historical[5].facts[0].value, /No quedó registrado/)
  const other = step(3, 'message_delivery')
  assert.equal(explainStep(execution([other]), other).coverageSections, null)
})

test('reviewer metadata rejection exposes the literal fragment and bounded repair outcome', () => {
  const detail = { kind: 'review_metadata', code: 'review_fragment_not_in_reply', fragment: 'Texto tomado de la base', field: 'area_internal_m2', received: 120.83 }
  const item = step(1, 'response_coverage', { status: 'rejected_review', issues: ['invalid_review_metadata'],
    semantic_review: { validation_details: [detail] }, repair_attempts: [{ target: 'review_metadata', status: 'invalid_review_metadata', issues: [detail], final_status: 'rejected_review' }] })
  const sections = explainStep(execution([item]), item).coverageSections!
  assert.match(sections[1].facts[0].value, /Ficha interna/)
  assert.match(sections[1].facts[1].value, /Texto tomado de la base/)
  assert.match(sections[3].facts[0].label, /conservando el mensaje/)
})
const execution = (steps: WorkflowExecutionStep[], extra: Partial<WorkflowExecution> = {}): WorkflowExecution => ({ id: 'event-a', workflowId: 'overview', path: [], status: 'completed', action: 'accepted', outcome: 'Kommo aceptó el envío', occurredAt: '', leadName: 'Consulta', message: 'Compare estas opciones', traceAvailable: true, steps, ...extra })

test('a comparison explains unlocked coverage without inventing a handoff reason', () => {
  const decision = step(3, 'dialogue_decision', { source: 'catalog_compare', catalog_query: { group: 'residential', category: 'departamento', operation: 'compare', filters: { bedrooms: null, floor_number: null } }, result_unit_ids: ['old-id'], coverage_locked: false, pending_question: { id: 'none' } })
  const explained = explainStep(execution([decision]), decision)
  assert.match(explained.reason, /No se guardó un motivo/)
  assert.match(explained.found.find(item => item.label === 'Revisión posterior')!.value, /no significa.*asesor/)
  assert.match(explained.found.find(item => item.label === 'Unidades encontradas')!.value, /sin número registrado/)
  assert.equal(explained.cause, null)
  assert.deepEqual(explained.linkedActions, [])
})

test('historical snapshots resolve unit numbers without reading future or live catalogue facts', () => {
  const snapshot = step(2, 'catalog_resolution', { catalog_snapshot: [{ id: 'unit-502', unit_number: '502', category: 'departamento', bedrooms: 3, area_internal_m2: 120.83 }] })
  const decision = step(3, 'dialogue_decision', { result_unit_ids: ['unit-502', 'unknown'] })
  const future = step(5, 'catalog_resolution', { catalog_snapshot: [{ id: 'unknown', unit_number: '999', category: 'local' }] })
  const explained = explainStep(execution([snapshot, decision, future]), decision)
  assert.equal(explained.units.length, 1)
  assert.equal(explained.units[0].unit_number, '502')
  const result = explained.found.find(item => item.label === 'Unidades encontradas')!.value
  assert.match(result, /departamento 502/)
  assert.match(result, /1 unidad sin número/)
  assert.doesNotMatch(result, /999/)
})

test('only an explicit causal step links a decision and a handoff, including incomplete actions', () => {
  const decision = step(3, 'response_coverage', { decision: { reason: 'Falta política verificada' } })
  const handoff = step(4, 'advisor_handoff', {}, { decision: { caused_by_step: 3, origin: 'coverage_review', reason: 'Verificar la política', rule_id: 'missing_fact', setting: { kind: 'data', label: 'Estado del proyecto', href: '/inmobiliaria/automatizacion/proyecto' } } })
  const unrelated = step(5, 'advisor_handoff', { decision: { reason: 'Otra solicitud' } })
  const run = execution([decision, handoff, unrelated])
  assert.deepEqual(explainStep(run, decision).linkedActions.map(item => item.order), [4])
  assert.equal(explainStep(run, handoff).cause?.order, 3)
  assert.equal(explainStep(run, handoff).origin, 'Revisión de cobertura')
  assert.equal(explainStep(run, handoff).setting?.href, '/inmobiliaria/automatizacion/proyecto')
  assert.equal(explainStep(run, unrelated).cause, null)
})

test('missing causal evidence stays missing and unsafe setting links are never actionable', () => {
  const handoff = step(4, 'advisor_handoff', { decision: { caused_by_step: 99, setting: { kind: 'prompt', href: 'javascript:alert(1)' } } })
  const explained = explainStep(execution([handoff]), handoff)
  assert.equal(explained.cause, null)
  assert.equal(explained.missingCause, true)
  assert.equal(explained.setting?.href, null)
  assert.match(humanValue('12345678-abcd-1234-abcd-123456789abc'), /Identificador interno/)
})

test('groups only recorded conversations and exact batches, never same-name contacts or nearby timestamps', () => {
  const input = [execution([], { id: '1', conversationId: 'c1', batchId: 'b1', batchSize: 3 }), execution([], { id: '2', conversationId: 'c1', batchId: 'b1', batchSize: 3 }), execution([], { id: '3', conversationId: 'c2' }), execution([], { id: '4' }), execution([], { id: '5' })]
  const groups = conversationGroups(input)
  assert.equal(groups.length, 4)
  assert.equal(groups[0].batches.length, 1)
  assert.equal(groups[0].batches[0].members.length, 2)
  assert.equal(groups[0].batches[0].total, 3)
  assert.equal(groups[2].known, false)
  assert.notEqual(groups[2].id, groups[3].id)
})

test('provider acceptance is never presented as delivery confirmation', () => {
  const delivery = step(6, 'message_delivery', { action: 'accepted', delivery_confirmed: false })
  assert.match(explainStep(execution([delivery]), delivery).summary, /no confirma entrega ni lectura/)
})
