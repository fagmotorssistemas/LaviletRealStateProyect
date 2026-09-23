import test from 'node:test'
import assert from 'node:assert/strict'
import { AutomationExecutionTrace, TRACE_SCHEMA_VERSION } from './execution-trace'
import { sanitizeTraceSummary, traceText } from './trace-summary'
import { beginModelTrace, withAIExecutionTrace } from './ai-execution-trace'
import { decisionRecord, catalogSnapshot } from './decision-record'

const event = { id: '00000000-0000-4000-8000-000000000001' }

test('model trace stores provider token counts without prompt or response bodies', async () => {
  let stored: Record<string, unknown>[] = []
  const trace = new AutomationExecutionTrace([event], { persist: async rows => { stored = rows; return { error: null } } })
  await withAIExecutionTrace(trace, async () => {
    beginModelTrace('private prompt content', 'configured-model', 'review').finish(undefined, {
      input_tokens: 120, output_tokens: 30, total_tokens: 150, input_tokens_details: { cached_tokens: 80 },
    })
  })
  await trace.flush()
  const request = stored.find(item => item.step_key === 'model_request' || (item.output_summary as Record<string, unknown>)?.task === 'review')!
  assert.deepEqual((request.output_summary as Record<string, unknown>).token_usage, { input_tokens: 120, output_tokens: 30, total_tokens: 150, cached_input_tokens: 80 })
  assert.ok(!JSON.stringify(stored).includes('private prompt content'))
})

test('trace captures actual versions and sanitized steps without modifying decisions', async () => {
  let stored: Record<string, unknown>[] = []
  const trace = new AutomationExecutionTrace([event, event], {
    persist: async rows => { stored = rows; return { error: null } },
    report: () => assert.fail('unexpected trace failure'),
  })
  trace.setVersions({ contractVersion: 'dialogue-v2', model: 'configured-model', promptVersions: { extractor_eventos: 'sha256:abc123' } })
  const step = trace.start('catalog_resolution', 'Resolver catálogo', 'decision', 'property-context.ts', {
    message: 'Mi sueldo es 2000 y mi cédula 0102030405',
    api_key: 'private-value', nested: { email: 'customer@example.com', candidate_unit_ids: ['unit-502'] },
  })
  trace.finish(step, 'succeeded', { filters: { bedrooms: 3 }, candidate_unit_ids: ['unit-502'], reference_reason: 'filtered_catalog' })
  await trace.flush()
  assert.equal(stored.length, 2)
  assert.deepEqual(stored[0].output_summary, {
    trace_schema: TRACE_SCHEMA_VERSION,
    code_version: (stored[0].output_summary as Record<string, unknown>).code_version,
    contract_version: 'dialogue-v2', model: 'configured-model', prompt_versions: { extractor_eventos: 'sha256:abc123' },
    batch_id: event.id, batch_event_ids: [event.id],
  })
  const serialized = JSON.stringify(stored)
  for (const secret of ['private-value', 'customer@example.com', '0102030405', '2000']) assert.ok(!serialized.includes(secret))
  assert.deepEqual((stored[1].output_summary as Record<string, unknown>).candidate_unit_ids, ['unit-502'])
  assert.equal(stored[1].status, 'succeeded')
})

test('returned database errors and thrown errors are reported safely without failing the conversation', async () => {
  for (const thrown of [false, true]) {
    const reports: Record<string, unknown>[] = []
    let attempts = 0
    const trace = new AutomationExecutionTrace([event], {
      persist: async () => {
        attempts++
        if (thrown) throw new Error('provider body with private-value')
        return { error: { code: '42501', message: 'provider body with private-value' } }
      },
      report: record => reports.push(record),
    })
    trace.add('message_delivery', 'Aceptación', 'output', 'kommo.ts', 'succeeded', {}, { action: 'accepted', delivery_confirmed: false })
    await assert.doesNotReject(() => trace.flush())
    assert.equal(attempts, 1)
    assert.equal(reports[0].event, 'AUTOMATION_TRACE_FLUSH_FAILED')
    assert.equal(reports[0].code, thrown ? 'PROCESSING_FAILED' : '42501')
    assert.ok(!JSON.stringify(reports).includes('private-value'))
  }
})

test('unfinished steps are visible as incomplete and invalid event ids never write', async () => {
  let stored: Record<string, unknown>[] = []
  const persist = async (rows: Record<string, unknown>[]) => { stored = rows; return { error: null } }
  const trace = new AutomationExecutionTrace([event], { persist })
  trace.start('semantic_extraction', 'Interpretar', 'ai', 'turn-interpretation.ts')
  await trace.flush()
  assert.equal(stored[1].status, 'failed')
  assert.equal(stored[1].error_code, 'TRACE_STEP_NOT_FINISHED')
  const invalid = new AutomationExecutionTrace([{ id: 'not-an-event' }], { persist: async () => { assert.fail('invalid id must not persist') } })
  await invalid.flush()
})

test('legacy audit summaries strip credentials, URL secrets and personal financial fields recursively', () => {
  const sanitized = sanitizeTraceSummary({
    source: 'catalog', filters: { bedrooms: 3, budget: 12345 },
    link: 'https://example.com/api?key=private-value', authorization: 'Bearer private-value',
    notes: ['customer@example.com', '+593 999 123 456'],
  })
  const serialized = JSON.stringify(sanitized)
  assert.ok(!serialized.includes('private-value'))
  assert.ok(!serialized.includes('12345'))
  assert.equal((sanitized.filters as Record<string, unknown>).bedrooms, 3)
  assert.equal(traceText('Departamento 502 tiene 120.83 m²'), 'Departamento 502 tiene 120.83 m²')
  assert.deepEqual(sanitizeTraceSummary(sanitized), sanitized)
})

test('internal UUIDs survive redaction without exposing phone-like values or protected fields', () => {
  const summary = sanitizeTraceSummary({ batch_id: event.id, batch_event_ids: [event.id],
    catalog_snapshot: [{ id: event.id, unit_number: '502' }],
    candidate_ids: ['+593 999 123 456'], phone: event.id, national_id: event.id })
  assert.equal(summary.batch_id, event.id)
  assert.deepEqual(summary.batch_event_ids, [event.id])
  assert.equal((summary.catalog_snapshot as Record<string, unknown>[])[0].id, event.id)
  assert.doesNotMatch(JSON.stringify(summary.candidate_ids), /593|999|456/)
  assert.equal(summary.phone, '[dato protegido]')
  assert.equal(summary.national_id, '[dato protegido]')
  assert.deepEqual(sanitizeTraceSummary(summary), summary)
})

test('a handoff records its actual triggering step, evidence and outcome with safe catalogue names', async () => {
  let stored: Record<string, unknown>[] = []
  const trace = new AutomationExecutionTrace([event], { persist: async rows => { stored = rows; return {} }, report: () => {} })
  const review = trace.start('response_coverage', 'Revisar cobertura', 'decision', 'turn-completeness.ts')
  trace.finish(review, 'succeeded', { needs_advisor: true, unresolved: ['¿Aceptan mascotas?'] })
  const decision = decisionRecord({ rule_id: 'advisor.verified_information_gap', origin: 'coverage_review', reason: 'Política de mascotas por verificar', caused_by_step: review,
    facts: { email: 'private@example.com', unresolved: ['¿Aceptan mascotas?'] }, outcome: 'queued' })
  trace.add('advisor_handoff', 'Derivar al asesor', 'action', 'conversation.ts', 'succeeded', {}, { decision,
    catalog_snapshot: catalogSnapshot([{ id: 'u502', unit_number: '502', category: 'departamento', bedrooms: 3, owner_email: 'private@example.com', description: 'private description' }]) })
  await trace.flush()
  const output = stored.at(-1)!.output_summary as Record<string, unknown>
  assert.equal((output.decision as Record<string, unknown>).caused_by_step, review)
  assert.equal((output.catalog_snapshot as Record<string, unknown>[])[0].unit_number, '502')
  assert.doesNotMatch(JSON.stringify(stored), /private@example|private description/)
})

test('actual composed prompt hashes and AI failures are recorded per execution without storing instructions', async () => {
  let stored: Record<string, unknown>[] = []
  const trace = new AutomationExecutionTrace([event], { persist: async rows => { stored = rows; return {} }, report: () => {} })
  const parent = trace.start('response_coverage', 'Revisar', 'decision', 'turn-completeness.ts')
  await withAIExecutionTrace(trace, async () => {
    beginModelTrace('private instructions one', 'test-model', 'writing').finish()
    beginModelTrace('private instructions two', 'test-model', 'review').finish(Error('OPENAI_INCOMPLETE'))
  })
  trace.finish(parent, 'succeeded', { retained_verified_reply: true })
  await trace.flush()
  const requests = stored.filter(row => row.step_key === 'model_request')
  assert.equal(requests.length, 2)
  assert.equal((requests[0].input_summary as Record<string, unknown>).caused_by_step, parent)
  assert.notEqual((requests[0].input_summary as Record<string, unknown>).prompt_revision, (requests[1].input_summary as Record<string, unknown>).prompt_revision)
  assert.equal(requests[1].status, 'failed')
  assert.equal(requests[1].error_code, 'OPENAI_INCOMPLETE')
  assert.doesNotMatch(JSON.stringify(stored), /private instructions/)
})
