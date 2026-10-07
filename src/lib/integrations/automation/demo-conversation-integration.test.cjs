/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS loads the TypeScript test hook and replaces external module boundaries before the conversation runs. */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const folder = __dirname
const lib = name => require(path.join(folder, name+'.ts'))

// Exercise the real conversation and writer/reviewer pipeline with only the
// external boundaries replaced. No HTTP, paid inference, or database writes.
async function conversationHarness({ current, extractionFails = false, reviewFails = false, permittedAtDelivery = true, storedSummary = {}, history = [], financeState = { partners: [], current: {} }, visitDraft = null, proposals = [] }) {
  const replacements = []
  const replace = (module, key, value) => { const previous = module[key]; module[key] = value; replacements.push(() => { module[key] = previous }) }
  const data = lib('data'), ai = lib('ai'), config = lib('config'), kommo = lib('kommo'), sdr = lib('sdr')
  const finance = lib('financing'), interpretation = lib('turn-interpretation'), scope = lib('business-scope')
  const tracing = lib('execution-trace'), tone = lib('tone-settings'), settings = lib('response-review-settings')
  const rpcCalls = [], dbWrites = [], sent = [], tasks = [], steps = [], writerInputs = []
  const now = new Date().toISOString()
  const lead = { ...data.scope, id: '00000000-0000-4000-8000-000000000001', kommo_id: 101, bot_enabled: true, tracking_opt_out_at: null,
    name: 'Carlos', preferred_category: 'departamento', behavior_signals: {} }
  const conversation = { ...data.scope, id: '00000000-0000-4000-8000-000000000002', lead_id: lead.id, summary: storedSummary }
  const catalog = [{ id: '00000000-0000-4000-8000-000000000202', category: 'departamento', unit_number: '202', floor_number: 2,
    bedrooms: 3, is_published: true, status: 'disponible', area_internal_m2: 120.83 },
    { id: '00000000-0000-4000-8000-000000000602', category: 'penthouse', unit_number: '602', floor_number: 6,
      bedrooms: 3, is_published: true, status: 'disponible', area_internal_m2: 140.53 }]
  const reply = 'Podemos revisar los departamentos de tres dormitorios disponibles en las plantas segunda a quinta.'
  const context = { historial: history, resumen: storedSummary, proyecto: { name: 'La Vilet' }, propuestas: proposals }
  const configRow = { enabled: true, dry_run: false, test_only: false }
  function query(table) {
    const builder = new Proxy({}, { get(_target, property) {
      if (property === 'then') return (resolve, reject) => Promise.resolve({ data: table === 'projects' ? { policies_json: {} } : [], error: null, count: 0 }).then(resolve, reject)
      if (property === 'update' || property === 'insert') return payload => { dbWrites.push({ table, payload }); return builder }
      if (property === 'select') return () => builder
      if (property === 'single' || property === 'maybeSingle') return async () => ({ data: table === 'lv_visit_intakes' ? visitDraft : table === 'projects' ? { policies_json: {} } : null, error: null })
      return () => builder
    } })
    return builder
  }
  try {
    replace(data, 'db', () => ({ from: query }))
    replace(data, 'autoConfig', async () => configRow)
    replace(data, 'one', async table => table === 'leads' ? lead : conversation)
    let permissionChecks = 0
    replace(data, 'permitted', () => ++permissionChecks === 1 || permittedAtDelivery)
    replace(data, 'rpc', async (name, args = {}) => {
      rpcCalls.push({ name, args })
      if (name === 'register_inbound_message') return { lead_id: lead.id, conversation_id: conversation.id, is_duplicate: false }
      if (name === 'lv_app_conversation_context') return context
      if (name === 'save_lead_declarations') return {}
      if (name === 'lv_evaluate_message_interest_v2') return { action: 'continue', score: 0 }
      if (name === 'register_outbound_message') return { id: 'outbound' }
      throw Error('Unexpected operational RPC: '+name)
    })
    replace(config, 'assertLive', () => {})
    replace(config, 'automationSettings', () => ({ testLeadId: lead.id }))
    replace(kommo, 'getKommoLead', async () => ({ id: 101, _embedded: { contacts: [{ id: 102 }] } }))
    replace(kommo, 'getKommoContact', async () => ({ id: 102, name: 'Carlos', custom_fields_values: [{ field_code: 'PHONE', values: [{ value: '+593000000000' }] }] }))
    replace(kommo, 'botStopped', () => false)
    replace(kommo, 'setKommoField', async (_lead, field, value) => sent.push({ field, value }))
    replace(kommo, 'launchSalesbot', async () => sent.push({ launched: true }))
    replace(tone, 'withConversationTone', work => work())
    replace(tone, 'conversationToneAudit', () => ({ source: 'fixture' }))
    replace(settings, 'loadResponseReviewPolicy', async () => ({ enabled: true, observationOnly: true, updatedAt: null }))
    replace(sdr, 'publishedUnitCatalog', async () => catalog)
    replace(sdr, 'catalogSearchConfiguration', async () => ({ embeddingsEnabled: false }))
    replace(sdr, 'commercialContext', async () => ({ catalogo: catalog, proyecto: { name: 'La Vilet' }, historial: [],
      politica_comercial: { precios_autorizados: false }, perfil_lead: {}, catalog_read: { complete: true }, financiamiento: { partners: [], current: {} } }))
    replace(sdr, 'commercialReply', async () => ({ reply: 'Podemos revisar las opciones del proyecto.', audit: { source: 'commercial' } }))
    replace(finance, 'financingContext', async () => financeState)
    replace(scope, 'classifyBusinessScope', async message => ({ kind: 'property', property_message: message, reply: '', uncertain: false }))
    replace(scope, 'reconcileConversationScope', async previous => previous)
    replace(tracing, 'traceForEvents', () => ({
      start: (...args) => { const id = steps.length+1; steps.push({ id, args }); return id },
      add: (...args) => { const id = steps.length+1; steps.push({ id, args }); return id },
      finish: (id, status, output, error) => { steps.find(step => step.id === id).result = { status, output, error } },
      setContext: () => {}, setVersions: () => {}, failOpenSteps: error => { steps.push({ failure: error.message }) },
      flush: async () => ({ status: 'complete' }),
    }))
    const { TurnInterpretationError } = lib('turn-interpretation-input')
    replace(interpretation, 'interpretConversationTurn', async input => {
      if (extractionFails) throw new TurnInterpretationError(['non_current_evidence:property'])
      const result = interpretation.observedInterpretationFailure(input, new TurnInterpretationError([]))
      result.method = 'model'
      result.diagnostic = { method: 'model' }
      return result
    })
    replace(ai, 'activePrompt', async () => 'Fixture del prompt publicado')
    replace(ai, 'aiJson', async (_rules, raw, _schema, _image, _file, _tone, task = 'data') => {
      tasks.push(task)
      if (task === 'review') {
        if (reviewFails) throw Error('OPENAI_INVALID_JSON')
        return { review_contract: 'business-risk-v2', verdict: 'block', findings: [{ category: 'hard_fact', statement: 'tres dormitorios',
          reason: 'Hallazgo de demostración', authoritative_fact: 'Catálogo actual' }], facts: [], question: null }
      }
      assert.equal(task, 'writing')
      writerInputs.push(raw)
      assert.equal(raw.mensaje_actual, current)
      assert.ok(raw.evidencia_turno || raw.contexto_verificado)
      return { reply, question: { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' },
        requests: [{ fragment: raw.referencias_solicitud[0].id, intent: 'Atender consulta', request_type: 'general_information', status: 'answered', evidence: 'Respuesta', fact_key: null }] }
    })
    replace(lib('ctwa-lead-store'), 'preserveCtwaForContact', async () => {})
    for (const [moduleName, functionName] of [['nutrition','scheduleNutrition24h'], ['nutrition-week-one','scheduleNutritionWeekOne'], ['nutrition-later','scheduleNutritionLater']])
      replace(lib(moduleName), functionName, async () => ({ scheduled: false }))
    const result = await lib('conversation').processConversation([{ id: 'fixture-event', received_at: now, payload: {
      origin: 'whatsapp', externalId: 'fixture-message', kommoId: 101, contactId: 102, name: 'Carlos', text: current, sentAt: now } }], async () => {})
    return { result, rpcCalls, dbWrites, sent, tasks, steps, writerInputs, reply }
  } finally { replacements.reverse().forEach(restore => restore()) }
}

test('the real conversation delivers a rejected draft in observation while retaining the review findings', async () => {
  const execution = await conversationHarness({ current: 'Quiero conocer los departamentos de tres dormitorios' })
  assert.equal(execution.result.action, 'accepted')
  const receipt = execution.rpcCalls.find(call => call.name === 'register_outbound_message')
  assert.ok(receipt)
  assert.ok(receipt.args.p_content.includes(execution.reply))
  assert.equal(receipt.args.p_tool_calls.turn_completeness.status, 'review_observed')
  assert.equal(receipt.args.p_tool_calls.turn_completeness.semantic_review.status, 'rejected')
  assert.equal(receipt.args.p_tool_calls.turn_completeness.final_validation.passed, false)
  assert.equal(receipt.args.p_tool_calls.turn_completeness.recovery.pending, false)
  assert.deepEqual(execution.tasks, ['writing','review'])
  assert.equal(execution.sent.some(message => message.launched), true)
})

for (const current of [
  'a ver yo prefiero los pisos bajos, mejor sería en el primer piso',
  'que pasó?',
  'Quiero reservar la unidad 202, agendar una visita mañana y financiar con JEP',
]) test('invalid extraction still reaches writer and monitoring without executing operations: '+current, async () => {
  const execution = await conversationHarness({ current, extractionFails: true })
  assert.equal(execution.result.action, 'accepted')
  const receipt = execution.rpcCalls.find(call => call.name === 'register_outbound_message')
  assert.ok(receipt)
  assert.equal(receipt.args.p_tool_calls.interpretation.method, 'observation_degraded')
  assert.equal(receipt.args.p_tool_calls.interpretation.interpretation_recovery.actions_allowed, false)
  assert.deepEqual(receipt.args.p_tool_calls.interpretation.interpretation_recovery.issues, ['non_current_evidence:property'])
  assert.deepEqual(execution.tasks, ['writing','review'])
  assert.deepEqual(execution.rpcCalls.map(call => call.name), ['register_inbound_message','lv_app_conversation_context','register_outbound_message'])
  assert.equal(execution.sent.some(message => message.launched), true)
  assert.equal(execution.dbWrites.some(write => !['messages','conversations'].includes(write.table)), false)
})

test('review service failure retains a deliverable draft through the real conversation boundary', async () => {
  const execution = await conversationHarness({ current: 'Quiero información de los departamentos', extractionFails: true, reviewFails: true })
  assert.equal(execution.result.action, 'accepted')
  const receipt = execution.rpcCalls.find(call => call.name === 'register_outbound_message')
  assert.equal(receipt.args.p_tool_calls.turn_completeness.semantic_review.status, 'unavailable')
  assert.equal(receipt.args.p_tool_calls.turn_completeness.semantic_review.error_code, 'OPENAI_INVALID_JSON')
  assert.deepEqual(execution.tasks, ['writing','review'])
})

test('observation does not bypass the final authorization gate or launch Salesbot for a paused contact', async () => {
  const execution = await conversationHarness({ current: 'Quiero información de los departamentos', extractionFails: true, permittedAtDelivery: false })
  assert.equal(execution.result.action, 'paused_before_reply')
  assert.equal(execution.sent.length, 0)
  assert.equal(execution.rpcCalls.some(call => call.name === 'register_outbound_message'), false)
})


for (const current of ['Sí, autorizo continuar con JEP', 'Mañana a las 10 quiero la visita', 'Prefiero el penthouse 602 y reservémoslo'])
  test('degraded interpretation preserves existing selection, financial facts and visit progress without operational writes: '+current, async () => {
    const unitId = '00000000-0000-4000-8000-000000000202'
    const storedSummary = {
      _property_context: { selected_ids: [unitId], offered_ids: [unitId], comparison_ids: [],
        query: { group: 'residential', category: 'departamento', scope: 'catalog', operation: 'select', filters: { bedrooms: 3, floor_number: 2 } } },
      _interpretation_memory: { budget: { status: 'amount', amount: 100000, confidence: 'high', evidence: 'Tengo cien mil', source_message_id: 'old-budget' } },
      _commercial_journey: { purpose: 'vivir', stage: 'financing' },
      _financing_journey: { accepted: true, status: 'accepted', source_message_id: 'old-consent',
        partner_preference: { name: 'JEP', evidence: 'Prefiero JEP', source_message_id: 'old-lender' } },
      _financing_identity: { given_names: 'Carlos', surnames: 'Pérez', document: '0100000000' },
      _financing_amounts: { cash_available: { amount: 100000, source_message_id: 'old-budget' } },
      _visit_dialogue: { status: 'collecting', target: 'office', preference: { day: 'mañana', source_message_id: 'old-date' } },
      _last_operational_step: { kind: 'financing_consent', reply: '¿Desea continuar con el proceso de financiamiento?' },
      _pending_question: { id: 'financing_invitation', act: 'financing', question: '¿Desea continuar con el proceso de financiamiento?' },
    }
    const history = [{ role: 'bot', content: '¿Desea continuar con el proceso de financiamiento?', sent_at: new Date(Date.now()-60000).toISOString() }]
    const execution = await conversationHarness({ current, extractionFails: true, storedSummary, history,
      financeState: { partners: ['JEP'], current: { explicit_consent: true, selected_partner_name: 'JEP', status: 'collecting',
        unit_id: unitId, applicant_type: 'dependiente', monthly_income: 2000 } },
      visitDraft: { status: 'collecting', preferred_period: 'morning', preferred_location_type: 'office' },
      proposals: [{ id: 'proposal-old', status: 'awaiting_client', request_id: 'visit-old' }] })
    assert.equal(execution.result.action, 'accepted')
    assert.deepEqual(execution.rpcCalls.map(call => call.name), ['register_inbound_message','lv_app_conversation_context','register_outbound_message'])
    assert.equal(execution.dbWrites.some(write => !['messages','conversations'].includes(write.table)), false)
    const saved = JSON.parse(execution.dbWrites.find(write => write.table === 'conversations').payload.summary)
    assert.deepEqual(execution.writerInputs[0].property_context.selected_ids, ['202'])
    assert.deepEqual(saved._property_context.selected_ids, [unitId])
    assert.equal(saved._property_context.query.category, 'departamento')
    assert.deepEqual(saved._interpretation_memory, storedSummary._interpretation_memory)
    assert.deepEqual(saved._financing_journey, storedSummary._financing_journey)
    assert.deepEqual(saved._financing_identity, storedSummary._financing_identity)
    assert.deepEqual(saved._financing_amounts, storedSummary._financing_amounts)
    assert.deepEqual(saved._visit_dialogue, storedSummary._visit_dialogue)
  })
