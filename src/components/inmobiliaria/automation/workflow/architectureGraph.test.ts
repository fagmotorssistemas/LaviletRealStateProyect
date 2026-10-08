import { CONVERSATION_EVENTS } from '@/lib/integrations/automation/event-contract'
import { candidateEventSteps } from './eventEvidence'
import test from 'node:test'
import assert from 'node:assert/strict'
import { ARCHITECTURE_NODES as nodes, ARCHITECTURE_LINKS as links, architectureEventFocus, nodeEvidence, nodeState, linkObserved } from './architectureGraph'
import type { WorkflowExecutionStep } from './executionWorkflow'
const node = (id: string) => nodes.find(n => n.id === id)!
const step = (key: string, output: Record<string, unknown> = {}, input: Record<string, unknown> = {}, order = 1, status = 'succeeded'): WorkflowExecutionStep =>
  ({ key, output, input, order, status, label: key, category: 'decision', source: 'fixture', startedAt: '', completedAt: '', durationMs: 0, errorCode: null })

test('all functional branches have unique nodes and resolvable connections', () => {
  assert.equal(new Set(nodes.map(n => n.id)).size, nodes.length)
  for (const link of links) { assert.ok(node(link.from), link.from); assert.ok(node(link.to), link.to) }
  assert.ok(nodes.every(n => n.title && n.description && n.owner && n.source))
})
test('price objective does not prove a price was found, a writer ran or delivery happened', () => {
  const steps = [step('turn_intent', { objective: 'ask_price', needs_reference: true })]
  assert.equal(nodeState(node('intent_ask_price'), steps), 'observed')
  assert.equal(nodeState(node('intent_discuss_budget'), steps), 'not_selected')
  assert.equal(nodeState(node('reference_missing'), steps), 'observed')
  for (const id of ['catalog', 'writer', 'reviewer', 'delivery']) assert.equal(nodeState(node(id), steps), 'unknown')
  assert.equal(linkObserved({ from: 'intent', to: 'intent_ask_price' }, steps), true)
})
test('missing, abbreviated and failed decisions never imply a branch was skipped', () => {
  for (const steps of [[], [step('turn_intent', {})], [step('turn_intent', { objective: '[resumen limitado]' })], [step('turn_intent', { objective: 'ask_price' }, {}, 1, 'failed')]]) {
    assert.equal(nodeState(node('intent_ask_price'), steps), 'unknown')
    assert.equal(nodeState(node('intent_discuss_budget'), steps), 'unknown')
  }
})
test('a directly resolved scope is not a classifier call; paused reason is explicit evidence', () => {
  assert.equal(nodeState(node('scope_property'), [step('scope_classification', { scope: 'property' })]), 'observed')
  assert.equal(nodeState(node('scope_ai'), [step('scope_classification', { scope: 'property' })]), 'unknown')
  const steps = [step('response_permission', { reason: 'MANUAL_STOP' }, {}, 1, 'paused')]
  assert.equal(nodeState(node('permission_MANUAL_STOP'), steps), 'paused')
  assert.equal(nodeState(node('permission_OPT_OUT'), steps), 'not_selected')
})
test('two observed agents do not prove a causal edge; every retry remains accessible', () => {
  const steps = [step('model_request', {}, { ai_role: 'writer' }, 2), step('model_request', {}, { ai_role: 'reviewer' }, 3), step('model_request', {}, { ai_role: 'writer' }, 4)]
  assert.equal(linkObserved({ from: 'writer', to: 'reviewer' }, steps), false)
  assert.deepEqual(nodeEvidence(node('writer'), steps).map(s => s.order), [2, 4])
  steps[1].input.caused_by_step = 2
  assert.equal(linkObserved({ from: 'writer', to: 'reviewer' }, steps), true)
})
test('recovery is read from its structured result, never inferred from an error string', () => {
  assert.equal(nodeState(node('review_recovery'), [step('response_coverage', { recovery: { pending: true } })]), 'rejected')
  assert.equal(nodeState(node('review_recovery'), [step('response_coverage', { issues: ['invalid_review_metadata'] })]), 'unknown')
  const steps = [step('response_coverage', { repair_attempts: [{ target: 'review_metadata' }] })]
  assert.equal(nodeEvidence(node('repair_metadata'), steps).length, 1)
  assert.equal(nodeEvidence(node('repair_draft'), steps).length, 0)
})
test('budget decision distinguishes incomplete evidence from verified unaffordability', () => {
  const steps = [step('budget_resolution', { status: 'incomplete_prices' })]
  assert.equal(nodeState(node('budget_incomplete_prices'), steps), 'observed')
  assert.equal(nodeState(node('budget_below_available_prices'), steps), 'not_selected')
  assert.equal(nodeState(node('budget_incomplete_prices'), []), 'unknown')
})

test('exact filtering can reduce context without selecting the vector or fallback route', () => {
  const steps = [step('catalog_embedding_search', { optimized: true, applied: false, method: 'structured_catalog',
    embedding_model_planned: 'text-embedding-3-small', embedding_model_consulted: null, embedding_requested: false })]
  assert.equal(nodeState(node('catalog_exact'), steps), 'observed')
  assert.equal(nodeState(node('embedding_applied'), steps), 'not_selected')
  assert.equal(nodeState(node('embedding_bypassed'), steps), 'not_selected')
  assert.equal(linkObserved({ from: 'embedding_search', to: 'catalog_exact' }, steps), true)
  assert.equal(linkObserved({ from: 'embedding_search', to: 'embedding_bypassed' }, steps), false)
  assert.match(node('embedding_search').description, /reducirse sin consultar embeddings/)
  assert.doesNotMatch(node('embedding_bypassed').description, /Conservar el recorrido y contexto anteriores/)
})

test('vector ranking and historical fallback stay distinct without asserting full context or a model call', () => {
  const vector = [step('catalog_embedding_search', { optimized: true, applied: true, method: 'structured_catalog_and_embeddings' })]
  const fallback = [step('catalog_embedding_search', { applied: false, method: 'current_catalog', reason: 'budget_context' }, {}, 1, 'skipped')]
  assert.equal(nodeState(node('embedding_applied'), vector), 'observed')
  assert.equal(nodeState(node('embedding_bypassed'), fallback), 'skipped')
  assert.match(node('embedding_bypassed').description, /contexto puede reducirse después/)
  assert.equal(links.find(link => link.from === 'embedding_search' && link.to === 'catalog_exact')?.label, 'Filtros exactos')
})

test('all contract events branch simultaneously after interpretation and before interest consumption', () => {
  for (const event of CONVERSATION_EVENTS) {
    const eventNode = node(`event_${event}`)
    assert.equal(eventNode.kind, 'event')
    assert.equal(eventNode.event, event)
    assert.ok(eventNode.column > node('events_validated').column)
    assert.ok(eventNode.column < node('interest').column)
    assert.ok(links.some(link => link.from === 'events_validated' && link.to === eventNode.id))
    assert.ok(links.some(link => link.from === eventNode.id && link.to === 'interest'))
  }
  assert.equal(links.some(link => node(link.from)?.event && node(link.to)?.event), false)
})

test('several accepted events coexist without implying an operational action', () => {
  const interpreted = step('semantic_extraction', { events: ['first_response', 'asked_price', 'asked_financing'] })
  const interest = step('interest_evaluation', { action_executed: false }, { events: interpreted.output.events, caused_by_step: interpreted.order }, 2)
  const steps = [interpreted, interest]
  for (const event of ['first_response', 'asked_price', 'asked_financing']) {
    assert.equal(nodeState(node(`event_${event}`), steps), 'observed')
    assert.equal(linkObserved({ from: 'events_validated', to: `event_${event}` }, steps), true)
    assert.equal(linkObserved({ from: `event_${event}`, to: 'interest' }, steps), true)
  }
  assert.equal(nodeState(node('event_requested_visit'), steps), 'not_detected')
  assert.equal(nodeState(node('visit'), steps), 'unknown')
  assert.equal(nodeState(node('handoff'), steps), 'unknown')
  assert.equal(nodeState(node('delivery'), steps), 'unknown')
})

test('raw extractor events remain candidates when interpretation is invalid or acceptance is unrecorded', () => {
  const failed = { ...step('semantic_extraction', {}, {}, 1, 'failed'), errorCode: 'TURN_INTERPRETATION_INVALID' }
  const raw = step('model_request', { output_snapshot: { data: { events: ['asked_price', 'requested_visit'] } } }, { ai_role: 'extractor', caused_by_step: 1 }, 2)
  for (const steps of [[failed, raw], [raw]]) {
    assert.equal(nodeState(node('event_asked_price'), steps), 'candidate')
    assert.equal(nodeState(node('event_requested_visit'), steps), 'candidate')
    assert.equal(nodeEvidence(node('event_asked_price'), steps).length, 0)
    assert.equal(candidateEventSteps('asked_price', steps).length, 1)
    assert.equal(linkObserved({ from: 'events_validated', to: 'event_asked_price' }, steps), false)
    assert.equal(linkObserved({ from: 'event_requested_visit', to: 'interest' }, steps), false)
  }
})

test('rejected raw candidates are not shown as accepted after successful normalization', () => {
  const semantic = step('semantic_extraction', { events: ['asked_price'] }, {}, 1)
  const raw = step('model_request', { output_snapshot: { data: { events: ['asked_price', 'requested_visit'] } } }, { ai_role: 'extractor', caused_by_step: 1 }, 2)
  assert.equal(nodeState(node('event_requested_visit'), [semantic, raw]), 'not_detected')
  assert.deepEqual(candidateEventSteps('requested_visit', [semantic, raw]), [])
  assert.equal(nodeState(node('event_asked_price'), [semantic, raw]), 'observed')
  assert.equal(nodeState(node('event_asked_price'), [step('semantic_extraction', { events: '[resumen limitado]' })]), 'unknown')
})

test('event shortcut focuses accepted events and their recorded consumers without hiding possible nodes', () => {
  const semantic = step('semantic_extraction', { events: ['asked_price', 'asked_financing'] }, {}, 1)
  const interest = step('interest_evaluation', {}, { caused_by_step: 1 }, 2)
  const focus = architectureEventFocus([semantic, interest])
  assert.deepEqual(focus.ids, ['events_validated', 'interest', 'event_asked_price', 'event_asked_financing'])
  assert.equal(focus.accepted, 2)
  assert.equal(focus.candidates, 0)
  assert.equal(focus.isGeneral, false)
  assert.equal(nodes.filter(node => node.event).length, CONVERSATION_EVENTS.length)
})

test('event shortcut focuses unvalidated candidates and otherwise retains the general overview', () => {
  const failed = step('semantic_extraction', {}, {}, 1, 'failed')
  const raw = step('model_request', { output_snapshot: { data: { events: ['requested_visit'] } } }, { ai_role: 'extractor', caused_by_step: 1 }, 2)
  const focus = architectureEventFocus([failed, raw])
  assert.deepEqual(focus.ids, ['events_validated', 'event_requested_visit'])
  assert.equal(focus.accepted, 0)
  assert.equal(focus.candidates, 1)
  assert.equal(focus.isGeneral, false)
  for (const steps of [[], [step('semantic_extraction', { events: [] })]]) {
    const overview = architectureEventFocus(steps)
    assert.equal(overview.isGeneral, true)
    assert.equal(overview.ids.length, CONVERSATION_EVENTS.length + 2)
  }
})
