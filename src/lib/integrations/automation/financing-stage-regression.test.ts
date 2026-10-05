import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { object, type Row } from './data'
import { interpretConversationTurn } from './turn-interpretation'
import { financingInputs, isFinancingTurn } from './financing'
import { financingPrerequisiteReply } from './property-selection'
import { financingJourney, financingStage, selectedFinancingUnit, canResumeFinancing } from './financing-stage'
import { taskVerifiedContext, taskModelEvidence } from './task-context'
import { turnEvidence } from './turn-evidence'
import { turnBudgetAssessment } from './turn-budget'
import { replyLinkContract, replyLinkIssues } from './response-plan'
import { completeTurnReply } from './turn-completeness'
import { resolvePropertyTurn } from './property-context'
import { reviewObligations } from './focused-review'
import { BUSINESS_RISK_REVIEW_VERSION } from './business-risk-review'
import { FINANCING_COLLECTION_WRITER_RULES } from './financing-prompt'

const fixture = JSON.parse(readFileSync('scripts/fixtures/financing-acceptance.json', 'utf8'))
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.map(object) : []
const units = [
  { id: 'local', unit_number: 'LC1', category: 'local', published_commercial_price: 145000 },
  { id: 'suite', unit_number: 'S1', category: 'suite', bedrooms: 1, published_commercial_price: 210000 },
  { id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3, floor_number: 2, published_commercial_price: 250000 },
  { id: 'd502', unit_number: '502', category: 'departamento', bedrooms: 3, floor_number: 5, published_commercial_price: 310000 },
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6, published_commercial_price: 550000 },
]
const finance = { partners: ['Banco Pichincha', 'Cooperativa JEP'], current: {} }
const query = { group: 'residential', category: null, operation: 'search', scope: 'catalog', filters: { bedrooms: 3 } }
function info(): Row {
  return { lead: {}, catalog_search: { embeddingsEnabled: true }, catalogo: units, catalog_read: { complete: true },
    property_context: { query, selected_ids: [] }, referencia_unidad: { matches: units.slice(2), query },
    financiamiento: finance, politica_comercial: { precios_autorizados: true }, politica_financiera: { credito_directo: false },
    instalaciones: [{ name: 'Piscina', description: 'Solo residentes' }], lugares_cercanos: [{ name: 'Parque' }],
    contexto_sector: [{ description: 'Sector residencial' }],
    estado_conversacion: { brochure_sent: true }, brochure_url: 'https://example.test/brochure.pdf',
    semantica_turno: { primary_intent: 'ask_financing', confidence: 'high', budget: { status: 'not_discussed' } },
    solicitudes_interpretadas: [{ domain: 'financing', confidence: 'high', request: 'Continuar financiamiento', evidence: fixture.message }],
    hechos_confirmados: { budget: { status: 'maximum_total', amount: 100000, confidence: 'high', evidence: '100 mil' } },
  }
}

test('legal-name collection uses selected-unit context, preserves the next field and one final writer/reviewer', async () => {
  const current = 'ya mi nombre es Carlos'
  const next = '¿Me indica todos sus nombres y apellidos tal como aparecen en su cédula?'
  const audit = { source: 'financing', semantic_review_enabled: true, business_risk_review_enabled: true,
    financing_collection: { state: 'nombre_pendiente', legal_name_complete: false, next_question: next } }
  const verified = { ...info(), property_context: { selected_ids: ['d502'] },
    solicitudes_interpretadas: [{ domain: 'financing', request: 'Proporcionar nombre', evidence: current, confidence: 'high' }] }
  const compact = taskVerifiedContext(verified, audit, current)
  assert.deepEqual(rows(compact.catalogo).map(u => u.id), ['d502'])
  assert.equal(rows(compact.instalaciones).length, 0)
  assert.equal(rows(compact.lugares_cercanos).length, 0)
  assert.equal(taskVerifiedContext({ ...verified, catalog_search: { embeddingsEnabled: false } }, audit, current).catalogo, verified.catalogo)
  const calls: string[] = [], failures: string[] = []
  const result = await completeTurnReply({ current, baseReply: next, verified: compact, audit },
    async (instructions, input, _schema, _image, _file, _tone, task = 'data') => {
      try {
        calls.push(task)
        const obligations = rows(object(input).obligaciones_del_turno)
        if (task === 'writing') {
          assert.ok(instructions.includes(FINANCING_COLLECTION_WRITER_RULES))
          assert.ok(instructions.length < 5000)
          assert.ok(obligations.some(o => o.id === 'financing_collection' && o.next_question === next))
          return { reply: next, requests: [{ fragment: 'R1', intent: 'Nombre', request_type: 'general_information',
            status: 'answered', evidence: 'Solicita nombre legal completo', fact_key: 'none' }],
          question: { role: 'required_collection', purpose: 'collect_financing_required', missing_datum: 'nombres y apellidos completos', next_decision: 'continuar recopilación' } }
        }
        assert.ok(obligations.some(o => o.id === 'financing_collection'))
        return { review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'pass', findings: [], facts: [], question: null }
      } catch (error) { failures.push(String(error)); throw error }
    })
  assert.deepEqual(failures, [])
  assert.equal(result.reply, next)
  assert.equal(result.audit.status, 'checked')
  assert.deepEqual(calls, ['writing', 'review'])
})

test('a deferred commercial draft can be completed and reviewed without an empty-response fallback', async () => {
  const current = '¿Cómo podemos continuar?', reply = 'Podemos seguir con la revisión. ¿Con cuál entidad desea continuar?'
  const calls: string[] = []
  const verified = { ...info(), property_context: { selected_ids: ['d502'] },
    financiamiento: { ...finance, journey: { accepted: true } },
    solicitudes_interpretadas: [{ domain: 'financing', request: 'Continuar revisión', evidence: current }] }
  const audit = { source: 'commercial', drafting_deferred_to_final_writer: true, semantic_review_enabled: true, business_risk_review_enabled: true }
  const result = await completeTurnReply({ current, baseReply: '', verified: taskVerifiedContext(verified, audit, current), audit },
    async (_instructions, _input, _schema, _image, _file, _tone, task = 'data') => {
      calls.push(task)
      return task === 'writing' ? { reply, requests: [{ fragment: 'R1', intent: 'Continuar', request_type: 'general_information',
        status: 'answered', evidence: 'Se pregunta entidad', fact_key: 'none' }],
      question: { role: 'required_collection', purpose: 'collect_financing_required', missing_datum: 'entidad', next_decision: 'continuar' } }
        : { review_contract: BUSINESS_RISK_REVIEW_VERSION, verdict: 'pass', findings: [], facts: [], question: null }
    })
  assert.equal(result.reply, reply)
  assert.equal(result.audit.status, 'checked')
  assert.deepEqual(calls, ['writing', 'review'])
})

test('recorded acceptance with a follow-up question stays in financing instead of requesting a human', async () => {
  const interpreted = await interpretConversationTurn({ mensaje_actual: fixture.message,
    resumen: { _last_operational_step: { kind: 'financing_consent', reply: fixture.last_question } } },
  { activePrompt: async () => '', aiJson: async () => structuredClone(fixture.extraction) })
  assert.equal(interpreted.extracted.requested_advisor, false)
  const extracted = { ...interpreted.extracted, turn_semantics: interpreted.semantics }
  const input = financingInputs(extracted, fixture.message, fixture.last_question, finance,
    { kind: 'financing_consent', reply: fixture.last_question })
  assert.equal(input.consent, true)
  assert.equal(isFinancingTurn(extracted, fixture.message, fixture.last_question, input), true)
  let journey = financingJourney({}, input, 'acceptance')
  const pending = { ...info(), financiamiento: { ...finance, journey } }
  assert.equal(financingStage(pending).stage, 'select_property')
  assert.equal(financingStage(pending).collection_allowed, false)
  assert.match(financingPrerequisiteReply(pending, fixture.message), /vivir o como inversión/)
  journey = financingJourney(journey, { consent: null }, 'choosing')
  const selected = { ...pending, property_context: { query, selected_ids: ['p602'] },
    referencia_unidad: { matches: [units[4]], query: { ...query, operation: 'select' } }, financiamiento: { ...finance, journey } }
  assert.equal(canResumeFinancing(selected, journey, {}), true)
  assert.equal(financingStage(selected).collection_allowed, true)
  assert.equal(selectedFinancingUnit(selected)?.id, 'p602')
  assert.equal(canResumeFinancing(selected, financingJourney(journey, { consent: null, declined: true }, 'no'), {}), false)
  assert.equal(canResumeFinancing(selected, journey, { requested_advisor: true }), false)
})

test('previous financial question or qualification cannot bypass choosing a unit', () => {
  for (const current of [{}, { explicit_consent: true }, { status: 'cedula_pendiente' }]) {
    const input = { ...info(), historial: [{ role: 'bot', content: fixture.last_question }],
      financiamiento: { ...finance, current, journey: { accepted: true } } }
    assert.ok(financingPrerequisiteReply(input, fixture.message))
    assert.equal(financingStage(input).collection_allowed, false)
  }
  assert.equal(selectedFinancingUnit({ ...info(), referencia_unidad: { matches: [units[2]] } }), null,
    'Only one result is not a selection.')
})

test('actual property resolution resumes accepted financing only after choosing, not after viewing a unit', () => {
  const journey = financingJourney({}, { consent: true }, 'accepted')
  const saved = { _financing_journey: journey, _property_context: { query,
    offered_ids: ['d202', 'p602'], selected_ids: [] } }
  for (const [message, operation, intent, resume] of [
    ['Quiero el penthouse 602', 'select', 'select_property', true],
    ['¿Qué medidas tiene el penthouse 602?', 'details', 'specific_fact', false],
  ] as const) {
    const reference = resolvePropertyTurn(units, message, saved, [], { primary_intent: intent,
      primary_evidence: message, confidence: 'high', property: { operation, category: 'penthouse',
        reference_kind: 'explicit', unit_numbers: ['602'], evidence: message, confidence: 'high' } })
    const verified = { ...info(), referencia_unidad: reference, property_context: reference.context,
      financiamiento: { ...finance, journey } }
    assert.equal(canResumeFinancing(verified, journey, {}), resume, message)
    assert.equal(financingStage(verified).collection_allowed, resume, message)
    if (resume) assert.equal(financingPrerequisiteReply(verified, message), '')
  }
  const input = financingInputs({ turn_requests: [{ domain: 'property' }] },
    'No, prefiero el penthouse', '¿Prefiere el departamento?', finance, {})
  assert.equal(financingJourney(journey, input, 'property-choice').accepted, true)
})

test('a new budget compares only residential requirements; financial continuation does not repeat it', () => {
  const input = info()
  assert.equal(turnBudgetAssessment(input, { source: 'financing_question' }), null)
  assert.equal(turnBudgetAssessment(input, { source: 'advisor_handoff' }), null)
  const changed = { ...input, solicitudes_interpretadas: [{ domain: 'property' }],
    semantica_turno: { budget: { status: 'maximum_total', amount: 100000, confidence: 'high', evidence: '100 mil' } } }
  const result = turnBudgetAssessment(changed, {})!
  assert.equal(result.minimum_price, 250000)
  assert.deepEqual(result.candidate_unit_ids, ['d202', 'd502', 'p602'])
  assert.equal(turnBudgetAssessment({ ...input, financiamiento: { ...finance, journey: { accepted: true } } }, { source: 'financing_selection_required' }), null)
  const ambiguous = turnBudgetAssessment({ ...changed,
    semantica_turno: { budget: { status: 'amount', amount: 100000, confidence: 'high', evidence: '100 mil' } } }, {})!
  assert.equal(ambiguous.continuation, 'offer_financing')
  assert.match(String(ambiguous.continuation_instruction), /entidades autorizadas/)
  assert.equal(result.continuation, 'offer_financing', 'An explicit total limit does not need the same clarification.')
})

test('brochure is sent once, omitted after delivery and allowed when explicitly requested again', () => {
  const input = info(), url = String(input.brochure_url)
  const initial = replyLinkContract('', { profile_introduction: { brochure_required: true, brochure_url: url } }, { verified: { ...input, estado_conversacion: {} } })
  assert.deepEqual(replyLinkIssues(url, initial), [])
  const later = replyLinkContract('', {}, { current: '¿Cómo financiamos?', verified: input })
  assert.equal(later.allowed_links.includes(url), false)
  const requested = replyLinkContract('', {}, { current: 'Envíeme otra vez el brochure', verified: input })
  assert.ok(requested.required_links.includes(url))
  assert.deepEqual(replyLinkIssues(url, requested), [])
})

test('task projection keeps complete price groups and selects context without embeddings or new model calls', () => {
  const original = info(), before = structuredClone(original)
  const reduced = taskVerifiedContext(original, { source: 'financing_question' }, '¿Qué planes tienen?')
  assert.deepEqual(reduced.catalogo, [])
  assert.deepEqual(reduced.instalaciones, [])
  assert.deepEqual(reduced.financiamiento, finance)
  assert.deepEqual(original, before)
  const off = { ...original, catalog_search: { embeddingsEnabled: false } }
  assert.equal(taskVerifiedContext(off, {}, fixture.message), off)
  const prices = taskVerifiedContext({ ...original, solicitudes_interpretadas: [{ domain: 'property' }],
    property_context: {}, referencia_unidad: {} }, { source: 'unit_price' }, '¿Qué precio tiene?')
  const evidence = turnEvidence(prices)
  const model = taskModelEvidence(evidence, prices)
  assert.equal(model.units.length, 0)
  const range = model.groups.find(g => g.id === 'group:context:all:range')!
  assert.equal(range.published_commercial_price, 145000)
  assert.equal(object(range.upper_values).published_commercial_price, 550000)
  assert.equal(evidence.units.length, units.length)
})

test('context reduction keeps authorized alternatives, comparisons and all current request domains', () => {
  const original = info()
  original.property_context = { query: { ...query, operation: 'compare', category: 'penthouse' }, selected_ids: [], comparison_ids: ['suite'] }
  original.solicitudes_interpretadas = [{ domain: 'property', request: 'Opciones de penthouse' }]
  original.presupuesto_del_turno = { alternatives: [units[2]] }
  const projected = taskVerifiedContext(original, {}, '¿Cuáles opciones tengo?')
  const evidence = turnEvidence(projected), model = taskModelEvidence(evidence, projected)
  assert.deepEqual(model.units.map(u => u.id), ['suite', 'd202', 'p602'])
  assert.ok(model.groups.some(g => g.source_scope === 'budget_alternatives'))
  const mixed = taskVerifiedContext({ ...original,
    solicitudes_interpretadas: [{ domain: 'financing', request: 'Explique el crédito' },
      { domain: 'property', request: '¿Tiene piscina y cómo reservo?' }],
    politicas_negocio: [{ topic: 'reserva', rule: 'La reserva requiere confirmación' }, { topic: 'cancelacion' }] },
  { source: 'financing_question' }, '¿Cómo funcionan el crédito y la piscina? ¿Cómo reservo?')
  assert.equal(object(mixed.prompt_context_selection).task, 'multiple_requests')
  assert.deepEqual(mixed.catalogo, units)
  assert.equal(rows(mixed.instalaciones).length, 1)
  assert.equal(rows(mixed.politicas_negocio).length, 1)
  const changedBudget = taskVerifiedContext({ ...info(), semantica_turno: {
    budget: { status: 'amount', amount: 300000, confidence: 'high', evidence: 'ahora tengo 300 mil' } } },
  { source: 'financing_question' }, 'Ahora tengo 300 mil, ¿me alcanza?')
  assert.deepEqual(changedBudget.catalogo, units, 'A financial question with a new budget still needs comparable prices.')
})

test('compact model context preserves full-query ranges even when only examples are listed', () => {
  const example = units[2]
  const projected = taskVerifiedContext({ ...info(), catalogo: [example],
    solicitudes_interpretadas: [{ domain: 'property', request: 'Rango de precios de tres dormitorios' }] },
  { verified_catalog: true, catalog_retrieval: { optimized: true } }, '¿Qué precios tienen?')
  const complete = { id: 'group:complete_query:range', source_scope: 'complete_query', aggregation: 'range',
    member_ids: ['d202', 'd502', 'p602'], published_commercial_price: 250000,
    upper_values: { published_commercial_price: 550000 } }
  const evidence = { units: [example], groups: [complete] }
  const model = taskModelEvidence(evidence, projected)
  assert.equal(model.units.length, 1)
  assert.deepEqual(model.groups, [complete], 'Complete aggregates are not narrowed to the example inventory.')
})

test('financing orientation and accepted review have different current obligations', () => {
  const original = info()
  const explain = { ...original, etapa_financiamiento: financingStage(original) }
  const orientation = reviewObligations({ source: 'financing_question' }, explain, {})
  assert.ok(orientation.some(o => o.id === 'financing_orientation'))
  const accepted = { ...original, financiamiento: { ...finance, journey: { accepted: true } } }
  const selecting = reviewObligations({ source: 'financing_selection_required' },
    { ...accepted, etapa_financiamiento: financingStage(accepted) }, {})
  assert.ok(selecting.some(o => o.id === 'financing_property_first'))
  assert.ok(!selecting.some(o => o.id === 'financing_orientation'))
})

test('acceptance pipeline asks for property selection in the first draft with shared review stage and no repeated budget goal', async () => {
  const original = info()
  original.financiamiento = { ...finance, journey: { accepted: true, source_message_id: 'acceptance' } }
  original.etapa_financiamiento = financingStage(original)
  const calls: string[] = [], failures: string[] = []
  const reply = 'Retomemos las viviendas de tres dormitorios para elegir la unidad que le interesa y después continuar el financiamiento. ¿Prefiere comparar departamentos o penthouses?'
  const result = await completeTurnReply({ current: fixture.message, baseReply: reply, verified: original,
    audit: { source: 'financing_selection_required', semantic_review_enabled: true, business_risk_review_enabled: true } },
  async (_rules, data, _schema, _image, _file, _tone, task) => {
    try {
      calls.push(task!)
      const input = object(data), obligations = rows(input.obligaciones_del_turno)
      assert.ok(obligations.some(o => o.id === 'financing_property_first'))
      assert.ok(!obligations.some(o => ['budget_continuation', 'current_budget_answer'].includes(String(o.id))))
      if (task === 'review') {
        assert.equal(object(object(input.estado_del_turno).etapa_financiamiento).collection_allowed, false)
        return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: {
          role: 'necessary_clarification', purpose: 'choose_property', missing_datum: 'Unidad', next_decision: 'Continuar financiamiento', offered_action: 'information' } }
      }
      assert.equal(object(object(input.contexto_verificado).etapa_financiamiento).stage, 'select_property')
      assert.deepEqual(rows(object(input.evidencia_turno).units).map(u => u.unit_number), ['202', '502', '602'])
      return { reply, question: { role: 'necessary_clarification', purpose: 'choose_property', missing_datum: 'Unidad', next_decision: 'Continuar financiamiento' },
        requests: rows(input.referencias_solicitud).map(ref => ({ fragment: ref.id, intent: 'Continuar financiamiento', status: 'answered', evidence: reply, fact_key: null, request_type: 'general_information' })) }
    } catch (error) { failures.push(String(error)); throw error }
  })
  assert.deepEqual(failures, [])
  assert.equal(result.audit.status, 'checked')
  assert.deepEqual(calls, ['writing', 'review'])
  assert.equal(result.reply, reply)
})
