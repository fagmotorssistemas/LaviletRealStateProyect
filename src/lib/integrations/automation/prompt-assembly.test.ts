import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { interpretConversationTurn } from './turn-interpretation'
import { completeTurnReply } from './turn-completeness'
import { configuredToneInstructions } from './tone-settings'
import { DEFAULT_TONE } from '@/lib/inmobiliaria/conversationTone'
import { BUSINESS_RISK_REVIEW_VERSION } from './business-risk-review'
import { COMMERCIAL_ACCURACY_RULES } from './commercial-accuracy'
import { aiJson } from './ai'
import { AutomationExecutionTrace } from './execution-trace'
import { withAIExecutionTrace } from './ai-execution-trace'
import { sanitizePromptSnapshot } from './trace-summary'
import { promptExport } from '@/components/inmobiliaria/automation/workflow/promptExport'
import type { WorkflowExecutionStep } from '@/components/inmobiliaria/automation/workflow/executionWorkflow'
import { object, type Row } from './data'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const exported = (snapshot: Row, rest: Row = {}) => promptExport({ order: 1,
  input: { prompt_snapshot: snapshot, ...rest } } as WorkflowExecutionStep)!

test('extractor instructions describe one input and use the current schema including penthouses', async () => {
  const message = 'Quiero conocer un penthouse'
  const configured = readFileSync('supabase/prompts/extractor-eventos.md', 'utf8')
  await interpretConversationTurn({ mensaje_actual: message, mensaje_accion: '', alcance_negocio_incierto: true }, {
    activePrompt: async () => configured, aiJson: async (instructions, input, schema) => {
      assert.equal(object(input).mensaje_actual, message)
      assert.equal(object(input).mensaje_accion, undefined)
      assert.doesNotMatch(instructions, /mensaje_accion contiene/)
      assert.match(instructions, /# Fuente del turno/)
      assert.match(instructions, /## Contrato de salida/)
      assert.ok((object(object(schema).properties).preferred_category as Row).enum)
      assert.ok((object(object(object(schema).properties).preferred_category).enum as unknown[]).includes('penthouse'))
      return { requests: [{ request: message, domain: 'property', evidence: message, confidence: 'high' }] }
    },
  })
})

test('final writer gets one precision block and the same obligations as the business reviewer', async () => {
  let writerObligations: unknown
  const reply = 'Podemos revisar las opciones publicadas del proyecto.'
  const errors: string[] = [], tasks: string[] = []
  const result = await completeTurnReply({ current: 'Quiero conocer opciones', baseReply: reply,
    verified: {}, audit: { semantic_review_enabled: true, business_risk_review_enabled: true } }, async (instructions, input, _schema, _image, _file, _tone, task) => {
    try {
      const context = object(input)
      tasks.push(String(task))
      if (task === 'writing') {
        const composed = await configuredToneInstructions(instructions, DEFAULT_TONE, 'writing')
        assert.equal(composed.split(COMMERCIAL_ACCURACY_RULES.trim()).length - 1, 1)
        assert.doesNotMatch(composed, /factual_values\.unit_id|opening_property_type_sentence_ids|REVISOR:|fuente project_fact|Para departamentos amplios, pregunte la planta/)
        assert.match(composed, /# Prioridades y obligaciones/)
        writerObligations = context.obligaciones_del_turno
        return { reply, requests: rows(context.referencias_solicitud).map(ref => ({ fragment: ref.id,
          intent: 'Informar', request_type: 'general_information', status: 'answered', evidence: 'Opciones', fact_key: null })),
          question: { purpose: 'none', role: 'none', missing_datum: '', next_decision: '' } }
      }
      assert.deepEqual(context.obligaciones_del_turno, writerObligations)
      assert.match(instructions, /No cree obligaciones adicionales/)
      return { review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'pass', findings: [], facts: [], question: null }
    } catch (error) { errors.push(String(error)); throw error }
  })
  assert.deepEqual(errors, [])
  assert.deepEqual(tasks, ['writing', 'review'])
  assert.equal(result.audit.status, 'checked')
})

test('new captured text exports the actual request including Markdown, schema and settings', async t => {
  for (const key of ['OPENAI_API_KEY', 'OPENAI_MODEL']) {
    const previous = process.env[key]
    process.env[key] = 'synthetic'
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
  let sent: Row = {}, stored: Row[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }] }), { status: 200 })
  })
  const field = { type: 'string' }, schema = { type: 'object', properties: { full_name: field, preferred_category: field } }
  const trace = new AutomationExecutionTrace([{ id: '00000000-0000-4000-8000-000000000001' }], { persist: async value => { stored = value; return { error: null } } })
  await withAIExecutionTrace(trace, () => aiJson('# Rol\n\n  - Primera regla\n  - Segunda regla',
    { mensaje_actual: 'Tengo un presupuesto de 100', optional: undefined }, schema))
  await trace.flush()
  const input = object(stored.find(item => item.step_key === 'model_request')!.input_summary)
  const capture = exported(object(input.prompt_snapshot), input)
  assert.equal(capture.exact, true, capture.notice)
  assert.deepEqual(JSON.parse(capture.text).request, sent)
  assert.equal(object(object(object(input.prompt_snapshot).response_schema).properties).full_name instanceof Object, true)
})

test('protected data, old snapshots, truncation and attachments never claim an exact export', () => {
  const raw = { capture_version: 2, instructions: '# Rol\n  - Conservar sangría', user_prefix: 'Datos:\n',
    data: { full_name: 'Dato personal', secret: 'secret-value' }, response_schema: null,
    request_parameters: { model: 'synthetic', max_output_tokens: 2000 } }
  const protectedCopy = sanitizePromptSnapshot(raw)
  assert.equal(exported(protectedCopy).exact, false)
  assert.doesNotMatch(exported(protectedCopy).text, /Dato personal|secret-value/)
  assert.deepEqual(sanitizePromptSnapshot(protectedCopy), protectedCopy)
  const complete = sanitizePromptSnapshot({ ...raw, data: { message: 'x'.repeat(130000) } })
  assert.equal(complete.limited, false)
  assert.equal(exported(complete).exact, true)
  assert.equal(exported(complete, { attachments_omitted: true }).exact, false)
  assert.equal(exported({ instructions: 'Texto antiguo', data: {} }).exact, false)
  const limited = sanitizePromptSnapshot({ ...raw, data: { message: 'x'.repeat(1_000_010) } })
  assert.equal(exported(limited).partial, true)
  assert.equal(exported(limited).exact, false)
})
