/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS loads the TypeScript test hook and replaces external module boundaries before the conversation runs. */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const folder = __dirname
const lib = name => require(path.join(folder, name+'.ts'))
const profileFixture = require('./fixtures/extractor-profile-turn.json')
const { BROCHURE_URL } = lib('project-material')
const noQuestion = { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' }

function extractionFixture(input, invalid = false) {
  const current = input.mensaje_actual
  const raw = structuredClone(profileFixture)
  raw.full_name = null
  raw.residence_city = null
  raw.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  raw.turn_semantics.primary_intent = 'other'
  raw.turn_semantics.primary_evidence = current
  raw.turn_semantics.answer_to_previous = { question_id: null, kind: 'none', evidence: '', confidence: 'high' }
  if (current === 'Algo para vivienda') {
    // This is the production-shaped extraction that exposed the opening gap:
    // current evidence declares a purpose although broad intent is "other".
    raw.purchase_purpose = 'vivir'
    raw.declaration_evidence.purchase_purpose = current
    raw.turn_semantics.property.group = 'residential'
    raw.turn_semantics.property.evidence = current
  } else if (current === 'Me llamo Carlos') {
    raw.full_name = 'Carlos'
    raw.profile_evidence.full_name = current
    raw.turn_semantics.primary_intent = 'answer_previous'
    raw.turn_semantics.answer_to_previous = { question_id: 'lead_profile', kind: 'value', evidence: current, confidence: 'high' }
  } else if (current === 'Vivo en Cuenca') {
    raw.residence_city = 'Cuenca'
    raw.profile_evidence.residence_city = current
    raw.turn_semantics.primary_intent = 'answer_previous'
    raw.turn_semantics.answer_to_previous = { question_id: 'lead_profile_residence', kind: 'value', evidence: current, confidence: 'high' }
  } else {
    raw.requests = [{ request: current, domain: 'property', evidence: current, confidence: 'high' }]
  }
  if (invalid) {
    raw.turn_semantics.property.group = 'residential'
    raw.turn_semantics.property.category = 'departamento'
    raw.turn_semantics.property.operation = 'search'
    raw.turn_semantics.property.evidence = 'Necesito cinco dormitorios'
  }
  return raw
}

// Run the real conversation, extractor normalization and writer/reviewer path.
// Only external boundaries are replaced: no HTTP, paid inference, or live DB.
async function conversationHarness({ current, messages, extractionFails = false, reviewFails = false, reviewRejects = true,
  observationOnly = true, permittedAtDelivery = true, startedAt = Date.now(), storedSummary = {}, history = [],
  financeState = { partners: [], current: {} }, visitDraft = null, proposals = [] }) {
  const replacements = []
  const replace = (module, key, value) => { const previous = module[key]; module[key] = value; replacements.push(() => { module[key] = previous }) }
  const data = lib('data'), ai = lib('ai'), config = lib('config'), kommo = lib('kommo'), sdr = lib('sdr')
  const finance = lib('financing'), interpretation = lib('turn-interpretation'), scope = lib('business-scope')
  const realInterpret = interpretation.interpretConversationTurn
  const tracing = lib('execution-trace'), tone = lib('tone-settings'), settings = lib('response-review-settings')
  const rpcCalls = [], dbWrites = [], sent = [], tasks = [], steps = [], writerInputs = [], extractorInputs = [], turns = []
  const lead = { ...data.scope, id: '00000000-0000-4000-8000-000000000001', kommo_id: 101, bot_enabled: true, tracking_opt_out_at: null,
    name: 'Carlos', preferred_category: 'departamento', behavior_signals: {} }
  const conversation = { ...data.scope, id: '00000000-0000-4000-8000-000000000002', lead_id: lead.id, summary: structuredClone(storedSummary) }
  const catalog = [{ id: '00000000-0000-4000-8000-000000000202', category: 'departamento', unit_number: '202', floor_number: 2,
    bedrooms: 3, is_published: true, status: 'disponible', area_internal_m2: 120.83 },
    { id: '00000000-0000-4000-8000-000000000602', category: 'penthouse', unit_number: '602', floor_number: 6,
      bedrooms: 3, is_published: true, status: 'disponible', area_internal_m2: 140.53 }]
  const reply = 'Podemos revisar los departamentos de tres dormitorios disponibles en las plantas segunda a quinta.'
  const context = { historial: structuredClone(history), resumen: conversation.summary, proyecto: { name: 'La Vilet' }, propuestas: proposals }
  const configRow = { enabled: true, dry_run: false, test_only: false }
  let permissionChecks = 0, activeCurrent = current, lastQuestion = noQuestion
  function query(table) {
    const builder = new Proxy({}, { get(_target, property) {
      if (property === 'then') return (resolve, reject) => Promise.resolve({ data: table === 'projects' ? { policies_json: {} } : [], error: null, count: 0 }).then(resolve, reject)
      if (property === 'update' || property === 'insert') return payload => {
        dbWrites.push({ table, payload: structuredClone(payload) })
        if (table === 'conversations' && payload.summary) {
          conversation.summary = typeof payload.summary === 'string' ? JSON.parse(payload.summary) : structuredClone(payload.summary)
          context.resumen = conversation.summary
        }
        if (table === 'leads') Object.assign(lead, payload)
        return builder
      }
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
    replace(data, 'permitted', () => ++permissionChecks === 1 || permittedAtDelivery)
    replace(data, 'rpc', async (name, args = {}) => {
      rpcCalls.push({ name, args: structuredClone(args) })
      if (name === 'register_inbound_message') return { lead_id: lead.id, conversation_id: conversation.id, is_duplicate: false }
      if (name === 'lv_app_conversation_context') return context
      if (name === 'save_lead_declarations') {
        if (args.p_preferred_category) lead.preferred_category = args.p_preferred_category
        if (args.p_purchase_purpose) lead.purchase_purpose = args.p_purchase_purpose
        return { preferred_category: lead.preferred_category, purchase_purpose: lead.purchase_purpose }
      }
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
    replace(settings, 'loadResponseReviewPolicy', async () => ({ enabled: true, observationOnly, updatedAt: null }))
    replace(sdr, 'publishedUnitCatalog', async () => catalog)
    replace(sdr, 'catalogSearchConfiguration', async () => ({ embeddingsEnabled: false }))
    replace(sdr, 'commercialContext', async (_lead, historical, profile) => ({ lead: structuredClone(_lead), catalogo: catalog, proyecto: { name: 'La Vilet' }, historial: historical || [],
      politica_comercial: { precios_autorizados: false }, perfil_lead: profile || {}, catalog_read: { complete: true }, financiamiento: { partners: [], current: {} } }))
    replace(sdr, 'commercialReply', async () => ({ reply: 'Podemos revisar las opciones del proyecto. ¿Cuántos dormitorios necesita?', audit: { source: 'commercial' } }))
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
    replace(interpretation, 'interpretConversationTurn', input => realInterpret(input, {
      activePrompt: async () => 'Fixture del extractor publicado',
      aiJson: async (_rules, raw) => {
        extractorInputs.push(structuredClone(raw))
        return extractionFixture(input, extractionFails)
      },
    }))
    replace(ai, 'activePrompt', async name => name === 'saludo_inicial' ? 'Hola, un gusto saludarle. ¿En qué podemos ayudarle?' : 'Fixture del prompt publicado')
    replace(ai, 'aiJson', async (_rules, raw, _schema, _image, _file, _tone, task = 'data') => {
      tasks.push(task)
      if (task === 'review') {
        if (reviewFails) throw Error('OPENAI_INVALID_JSON')
        return { review_contract: 'business-risk-v2', verdict: reviewRejects ? 'block' : 'pass',
          findings: reviewRejects ? [{ category: 'hard_fact', statement: 'tres dormitorios',
            reason: 'Hallazgo de demostración', authoritative_fact: 'Catálogo actual' }] : [],
          facts: [], question: lastQuestion.purpose === 'none' ? null : { ...lastQuestion, offered_action: 'none' } }
      }
      assert.equal(task, 'writing')
      writerInputs.push(structuredClone(raw))
      assert.equal(raw.mensaje_actual, activeCurrent)
      assert.ok(raw.evidencia_turno || raw.contexto_verificado)
      let proposed = reply
      lastQuestion = noQuestion
      if (messages) {
        const introduction = raw.estado_operativo.profile_introduction || {}
        const decision = raw.estado_operativo.profile_collection_decision || introduction.collection_decision || raw.contrato_redaccion.estado_comercial.profile_collection_decision || {}
        const profileId = decision.allowed_question_ids?.[0]
        if (profileId) {
          proposed = [introduction.name_acknowledgement,
            introduction.generic_introduction ? 'La Vilet está ubicada en Puertas del Sol, Cuenca.' : '', introduction.question].filter(Boolean).join('\n\n')
          lastQuestion = { purpose: 'collect_lead_profile', role: 'required_collection', missing_datum: decision.allowed_fields.join(', '),
            next_decision: 'Continuar la guía personalizada.', continuation_id: profileId, continuation_act: 'profile' }
        } else {
          proposed = 'Gracias. ¿Cuántos dormitorios necesita?'
          lastQuestion = { purpose: 'choose_property', role: 'optional_continuation', missing_datum: 'Dormitorios',
            next_decision: 'Identificar las opciones compatibles.', continuation_id: 'property_bedrooms', continuation_act: 'confirm_bedrooms' }
        }
      }
      return { reply: proposed, question: lastQuestion,
        requests: raw.referencias_solicitud.map(reference => ({ fragment: reference.id, intent: 'Atender consulta',
          request_type: 'general_information', status: 'answered', evidence: 'Respuesta', fact_key: null })) }
    })
    replace(lib('ctwa-lead-store'), 'preserveCtwaForContact', async () => {})
    for (const [moduleName, functionName] of [['nutrition','scheduleNutrition24h'], ['nutrition-week-one','scheduleNutritionWeekOne'], ['nutrition-later','scheduleNutritionLater']])
      replace(lib(moduleName), functionName, async () => ({ scheduled: false }))
    for (const [index, message] of (messages || [current]).entries()) {
      activeCurrent = message
      permissionChecks = 0
      const now = new Date(startedAt + index).toISOString()
      const callStart = rpcCalls.length, sentStart = sent.length, taskStart = tasks.length, writeStart = dbWrites.length, extractorStart = extractorInputs.length, stepStart = steps.length
      let result, failure
      try {
        result = await lib('conversation').processConversation([{ id: 'fixture-event-'+index, received_at: now, payload: {
          origin: 'whatsapp', externalId: 'fixture-message-'+index, kommoId: 101, contactId: 102, name: 'Carlos', text: message, sentAt: now } }], async () => {})
      } catch (error) { failure = error }
      const receipt = rpcCalls.slice(callStart).find(call => call.name === 'register_outbound_message')
      turns.push({ current: message, result, failure, receipt, summary: structuredClone(conversation.summary),
        rpcCalls: rpcCalls.slice(callStart), sent: sent.slice(sentStart), tasks: tasks.slice(taskStart), dbWrites: dbWrites.slice(writeStart),
        extractionCalls: extractorInputs.length-extractorStart, steps: steps.slice(stepStart) })
      context.historial.push({ role: 'cliente', content: message, sent_at: now })
      if (receipt) context.historial.push({ role: 'bot', content: receipt.args.p_content, sent_at: now })
    }
    return { ...turns.at(-1), rpcCalls, dbWrites, sent, tasks, steps, writerInputs, extractorInputs, turns, reply }
  } finally { replacements.reverse().forEach(restore => restore()) }
}

const outbound = execution => execution.rpcCalls.find(call => call.name === 'register_outbound_message')
const assertExtractionBlocked = execution => {
  assert.equal(execution.failure?.message, 'PRE_REPLY_SEND_FAILED')
  assert.equal(execution.failure.original?.name, 'Error')
  assert.equal(execution.failure.original?.message, 'TURN_INTERPRETATION_INVALID')
  assert.ok(execution.extractionCalls >= 2, 'the same bounded extractor repair is used in both modes')
  assert.deepEqual(execution.tasks, [])
  assert.equal(execution.writerInputs.length, 0)
  assert.equal(execution.sent.length, 0)
  assert.equal(outbound(execution), undefined)
  assert.equal(execution.dbWrites.some(write => write.table !== 'messages'), false)
}

test('the real conversation delivers a rejected writer draft in observation and retains the review findings', async () => {
  const execution = await conversationHarness({ current: 'Quiero conocer los departamentos de tres dormitorios' })
  assert.equal(execution.result?.action, 'accepted', execution.failure?.stack)
  const receipt = outbound(execution)
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
]) test('writer observation preserves normal upstream extraction failure: '+current, async () => {
  const demo = await conversationHarness({ current, extractionFails: true })
  const normal = await conversationHarness({ current, extractionFails: true, observationOnly: false })
  assertExtractionBlocked(demo)
  assertExtractionBlocked(normal)
  assert.deepEqual(demo.failure.original.issues, normal.failure.original.issues)
  assert.deepEqual(demo.rpcCalls.map(call => call.name), normal.rpcCalls.map(call => call.name))
})

test('review service failure retains a deliverable writer draft through the real conversation boundary', async () => {
  const execution = await conversationHarness({ current: 'Quiero información de los departamentos', reviewFails: true })
  assert.equal(execution.result?.action, 'accepted', execution.failure?.stack)
  const receipt = outbound(execution)
  assert.equal(receipt.args.p_tool_calls.turn_completeness.semantic_review.status, 'unavailable')
  assert.equal(receipt.args.p_tool_calls.turn_completeness.semantic_review.error_code, 'OPENAI_INVALID_JSON')
  assert.deepEqual(execution.tasks, ['writing','review'])
})

test('observation does not bypass final authorization or launch Salesbot for a paused contact', async () => {
  const execution = await conversationHarness({ current: 'Quiero información de los departamentos', permittedAtDelivery: false })
  assert.equal(execution.result?.action, 'paused_before_reply', execution.failure?.stack)
  assert.equal(execution.sent.length, 0)
  assert.equal(outbound(execution), undefined)
})

for (const current of ['Sí, autorizo continuar con JEP', 'Mañana a las 10 quiero la visita', 'Prefiero el penthouse 602 y reservémoslo'])
  test('an extractor failure cannot change existing selection, financial consent or visit progress: '+current, async () => {
    const unitId = '00000000-0000-4000-8000-000000000202'
    const storedSummary = {
      _property_context: { selected_ids: [unitId], offered_ids: [unitId], comparison_ids: [],
        query: { group: 'residential', category: 'departamento', scope: 'catalog', operation: 'select', filters: { bedrooms: 3, floor_number: 2 } } },
      _interpretation_memory: { budget: { status: 'amount', amount: 100000, confidence: 'high', evidence: 'Tengo cien mil', source_message_id: 'old-budget' } },
      _commercial_journey: { purpose: 'vivir', stage: 'financing' },
      _financing_journey: { accepted: true, status: 'accepted', source_message_id: 'old-consent', partner_preference: { name: 'JEP', evidence: 'Prefiero JEP', source_message_id: 'old-lender' } },
      _financing_identity: { given_names: 'Carlos', surnames: 'Pérez', document: '0100000000' },
      _financing_amounts: { cash_available: { amount: 100000, source_message_id: 'old-budget' } },
      _visit_dialogue: { status: 'collecting', target: 'office', preference: { day: 'mañana', source_message_id: 'old-date' } },
      _last_operational_step: { kind: 'financing_consent', reply: '¿Desea continuar con el proceso de financiamiento?' },
      _pending_question: { id: 'financing_invitation', act: 'financing', question: '¿Desea continuar con el proceso de financiamiento?' },
    }
    const execution = await conversationHarness({ current, extractionFails: true, storedSummary,
      history: [{ role: 'bot', content: '¿Desea continuar con el proceso de financiamiento?', sent_at: new Date(Date.now()-60000).toISOString() }],
      financeState: { partners: ['JEP'], current: { explicit_consent: true, selected_partner_name: 'JEP', status: 'collecting', unit_id: unitId, applicant_type: 'dependiente', monthly_income: 2000 } },
      visitDraft: { status: 'collecting', preferred_period: 'morning', preferred_location_type: 'office' },
      proposals: [{ id: 'proposal-old', status: 'awaiting_client', request_id: 'visit-old' }] })
    assertExtractionBlocked(execution)
    assert.deepEqual(execution.summary, storedSummary)
    assert.equal(execution.rpcCalls.some(call => /reservation|financing|visit/i.test(call.name)), false)
  })

test('normal and observation keep the same greeting, profile capture, one residence reminder and brochure receipts over four turns', async () => {
  const messages = ['Hola', 'Algo para vivienda', 'Me llamo Carlos', 'Vivo en Cuenca']
  const startedAt = Date.now()
  const normal = await conversationHarness({ messages, startedAt, observationOnly: false, reviewRejects: false })
  const demo = await conversationHarness({ messages, startedAt, observationOnly: true, reviewRejects: false })
  for (const execution of [normal, demo]) {
    assert.equal(execution.turns.length, 4)
    for (const turn of execution.turns) {
      assert.equal(turn.result?.action, 'accepted', turn.current + ': ' + (turn.failure?.original?.stack || turn.failure?.stack))
      assert.equal(turn.steps.find(step => step.args?.[0] === 'semantic_extraction')?.result?.status, 'succeeded', turn.current)
    }
    const [greeting, interest, named, resident] = execution.turns
    assert.deepEqual(greeting.tasks, [])
    assert.equal(greeting.extractionCalls, 0)
    assert.equal(greeting.receipt.args.p_tool_calls.source, 'minimal_greeting')
    assert.match(greeting.receipt.args.p_content, /Hola/)
    assert.doesNotMatch(greeting.receipt.args.p_content, /nombre|reside|brochure/)
    const opening = interest.receipt.args.p_tool_calls
    assert.equal(opening.profile_collection_decision.action, 'capture')
    assert.equal(opening.profile_introduction.generic_introduction, true)
    assert.deepEqual(opening.profile_collection_decision.allowed_fields, ['full_name','current_residence'])
    assert.match(interest.receipt.args.p_content, /nombre.*ciudad o país reside actualmente/)
    assert.doesNotMatch(interest.receipt.args.p_content, /departamentos|suites|penthouses|120|140/)
    assert.equal(interest.receipt.args.p_content.includes(BROCHURE_URL), false)
    assert.equal(interest.summary._lead_introduction.request_sent, true)
    assert.equal(interest.summary._pending_question.id, 'lead_profile')
    assert.equal(named.receipt.args.p_tool_calls.profile_collection_decision.action, 'remind')
    assert.deepEqual(named.receipt.args.p_tool_calls.profile_collection_decision.allowed_fields, ['current_residence'])
    assert.match(named.receipt.args.p_content, /Mucho gusto, Carlos/)
    assert.match(named.receipt.args.p_content, /en qué ciudad o país reside actualmente/)
    assert.equal(named.receipt.args.p_content.includes(BROCHURE_URL), true)
    assert.equal(named.summary._lead_introduction.reminder_count, 1)
    assert.equal(named.summary._lead_introduction.brochure_sent, true)
    assert.equal(named.summary._pending_question.id, 'lead_profile_residence')
    assert.equal(resident.summary._lead_profile.full_name, 'Carlos')
    assert.equal(resident.summary._lead_profile.residence_city, 'Cuenca')
    assert.equal(resident.summary._lead_introduction.collection_status, 'complete')
    assert.equal(resident.summary._lead_introduction.reminder_count, 1)
    assert.equal(resident.receipt.args.p_content.includes(BROCHURE_URL), false)
    assert.doesNotMatch(resident.receipt.args.p_content, /reside|ciudad|su nombre/)
    assert.deepEqual(execution.extractorInputs.map(raw => raw.mensaje_actual), messages.slice(1))
  }
  for (let index = 0; index < messages.length; index++) {
    const normalTurn = normal.turns[index], demoTurn = demo.turns[index]
    assert.equal(demoTurn.receipt.args.p_content, normalTurn.receipt.args.p_content)
    assert.deepEqual(demoTurn.receipt.args.p_tool_calls.profile_collection_decision, normalTurn.receipt.args.p_tool_calls.profile_collection_decision)
    assert.deepEqual(demoTurn.summary._lead_introduction, normalTurn.summary._lead_introduction)
    assert.deepEqual(demoTurn.summary._lead_profile, normalTurn.summary._lead_profile)
    assert.deepEqual(demoTurn.summary._pending_question, normalTurn.summary._pending_question)
  }
})
