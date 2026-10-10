import test from 'node:test'
import assert from 'node:assert/strict'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { CONVERSATION_WRITING_STYLE_RULES } from './conversation-style'
import { CONTEXTUAL_NEEDS_GUIDANCE, CONTEXTUAL_NEEDS_WRITER_RULES } from './needs-guidance'
import { leadBudget } from './budget-state'
import { object, type Row } from './data'

const unit = { id: 'ph602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6,
  area_internal_m2: 142.09, area_exterior_m2: 25.3, published_commercial_price: 550000, is_published: true, status: 'disponible' }
const question = '¿Con qué entidad desea iniciar la revisión: Banco Pichincha o Cooperativa JEP?'
const plan = { action: 'continue_financing', question_id: 'financing_partner', question_act: 'financing', question,
  continuation_required: true, selected_unit_id: unit.id }
const metadata = { purpose: 'choose_financing_partner', role: 'optional_continuation', missing_datum: '',
  next_decision: 'Elegir la entidad para la revisión aceptada', continuation_id: 'financing_partner', continuation_act: 'financing' }
function inputFor(current: string, compact = false, multiple = false): Row {
  const requests = [{ domain: compact ? 'financing' : 'property', request: current, evidence: current, confidence: 'high' },
    ...(multiple ? [{ domain: 'property', request: '¿Permiten mascotas?', evidence: '¿Permiten mascotas?', confidence: 'high' }] : [])]
  return { catalogo: [unit], proyecto: { name: 'La Vilet' }, catalog_read: { complete: true },
    politica_comercial: { precios_autorizados: true }, perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' },
    hechos_confirmados: { budget: { status: 'initial_capital', amount: 200000, confidence: 'high', evidence: 'Tengo 200 mil para la entrada' } },
    financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'], current: {}, journey: { accepted: true } },
    siguiente_paso_comercial: plan, property_context: { selected_ids: [unit.id], offered_ids: [unit.id],
      query: { group: 'residential', category: 'penthouse', operation: 'details', scope: 'selected', filters: { bedrooms: 3 } } },
    instalaciones: [{ name: 'Ascensor', condition: 'Acceso según condiciones del proyecto' }],
    solicitudes_interpretadas: requests, contrato_turno: { objective: compact ? 'ask_financing' : 'project_information', requests },
    semantica_turno: { primary_intent: compact ? 'ask_financing' : 'project_information', confidence: 'high',
      budget: { status: 'not_discussed', amount: null }, property: { operation: compact ? 'none' : 'details', reference_kind: 'followup' },
      catalog_request: { purpose: compact ? 'none' : 'details', requirements: [], semantic_preferences: [] } } }
}

for (const mode of ['normal', 'observation', 'disabled', 'compact_financing'] as const) {
  test('needs guidance survives writer routing and retains PH602/down payment/financing step: '+mode, async () => {
    const compact = mode === 'compact_financing'
    const current = compact ? '¿Qué se necesita para revisar el financiamiento?' : 'Tengo cinco hijos; ¿caben dos camas en esa habitación?'
    const reply = (compact ? 'Para avanzar con la revisión necesitamos elegir la entidad.'
      : 'Para confirmar si caben dos camas necesitamos las medidas de esa habitación y de las camas; la superficie total del penthouse no basta.')+' '+question
    const verified = inputFor(current, compact), original = structuredClone(verified)
    const calls: string[] = []
    let writerContext: Row = {}
    const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: mode === 'observation', updatedAt: null }, () => completeTurnReply({
      current, baseReply: reply, verified,
      audit: { source: compact ? 'financing_intake' : 'property_details', semantic_review_enabled: true, business_risk_review_enabled: true,
        ...(compact ? { financing_collection: { collection_allowed: true, requested_fields: ['selected_partner_name'], pending_fields: ['selected_partner_name'] } } : {}) },
    }, async (rules, raw, _schema, _image, _file, _tone, task) => {
      calls.push(task || '')
      const context = object(raw)
      if (task === 'writing') {
        assert.ok(String(rules).includes(CONTEXTUAL_NEEDS_WRITER_RULES), 'shared reasoning reaches this writer route')
        assert.ok(String(rules).includes(CONVERSATION_WRITING_STYLE_RULES))
        writerContext = context
        return { reply, question: metadata, requests: [{ fragment: 'R1', intent: 'Consulta actual', request_type: 'specific_fact',
          status: 'answered', evidence: reply, fact_key: null }] }
      }
      return { review_contract: 'business-risk-v2', verdict: 'pass', facts: [], findings: [], question: { ...metadata, offered_action: 'none' } }
    }))
    assert.equal(result.reply, reply, JSON.stringify(result.audit))
    assert.equal(result.needsAdvisor, false)
    assert.deepEqual(calls, mode === 'disabled' ? ['writing'] : ['writing', 'review'])
    const reasoning = object(writerContext.razonamiento_contextual)
    assert.equal(reasoning.guidance, CONTEXTUAL_NEEDS_GUIDANCE, 'complete shared guidance reaches every writer route')
    assert.equal(object(reasoning.limits).can_confirm_fit, false)
    assert.equal(object(reasoning.limits).can_persist_assumptions, false)
    if (compact) assert.deepEqual(reasoning.facts, [], 'financial collection does not acquire unrelated spatial evidence')
    else assert.ok((reasoning.facts as Row[]).some(fact => fact.value === 142.09 && fact.unit === 'm2'))
    assert.equal(object(writerContext.contexto_verificado).razonamiento_contextual, undefined, 'one reasoning copy in the writer prompt')
    assert.deepEqual(object(result.audit.commercial_journey).selected_unit_id, unit.id)
    assert.equal(leadBudget(verified).status, 'initial_capital')
    assert.equal(leadBudget(verified).amount, 200000)
    assert.deepEqual(verified, original, 'reasoning must not persist hypotheses or change declared choices')
    if (compact) assert.equal(object(object(writerContext.contexto_verificado).prompt_context_selection).task, 'financing')
  })
}

test('multiple needs questions retain both requests and resume the bank choice without inventing pet rules', async () => {
  const current = '¿Caben dos camas? ¿Permiten mascotas?'
  const reply = 'Para comprobar la cabida hacen falta las medidas de la habitación y de las camas. No tengo una política de mascotas confirmada para comunicarle. '+question
  let sentRequests: Row[] = []
  const verified = inputFor(current, false, true)
  const result = await completeTurnReply({ current, baseReply: reply, verified,
    audit: { source: 'property_details', semantic_review_enabled: true, business_risk_review_enabled: true } },
  async (_rules, raw, _schema, _image, _file, _tone, task) => {
    const context = object(raw)
    if (task === 'writing') {
      sentRequests = context.referencias_solicitud as Row[]
      return { reply, question: metadata, requests: sentRequests.map(ref => ({ fragment: ref.id, intent: 'Consulta de distribución o mascotas',
        request_type: 'specific_fact', status: 'answered', evidence: reply, fact_key: null })) }
    }
    return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: { ...metadata, offered_action: 'none' } }
  })
  assert.equal(result.reply, reply, JSON.stringify(result.audit))
  assert.equal(sentRequests.length, 2)
  assert.equal(object(result.audit.question).continuation_id, 'financing_partner')
  assert.deepEqual(object(verified.property_context).selected_ids, ['ph602'])
  assert.equal(object(object(verified.financiamiento).journey).accepted, true)
})

for (const available of [true, false]) test('current stairs need reaches the final writer with only verified access facts; available=' + available, async () => {
  const current = 'Prefiero un piso bajo para no subir tantas gradas'
  const verified = inputFor(current), originalElevator = { amenity_name: '2 ascensores de última generación',
    description: 'Ascensores modernos y eficientes', access_condition: 'Sujetos a mantenimiento.' }
  verified.instalaciones = available ? [originalElevator, { amenity_name: 'Piscina', description: 'Uso común.' }] : []
  object(verified.semantica_turno).property = { operation: 'search', reference_kind: 'followup' }
  object(verified.semantica_turno).catalog_request = { purpose: 'search', requirements: [], semantic_preferences: [] }
  const original = structuredClone(verified)
  const reply = (available ? 'El proyecto cuenta con dos ascensores.' : 'Podemos revisar las opciones en plantas bajas.') + ' ' + question
  let writerCalls = 0
  let writerContext: Row = {}
  const result = await completeTurnReply({ current, verified, baseReply: reply,
    audit: { source: 'catalog_search', semantic_review_enabled: true, business_risk_review_enabled: true } },
  async (_rules, raw, _schema, _image, _file, _tone, task) => {
    if (task === 'writing') {
      writerCalls++
      writerContext = object(raw)
      return { reply, question: metadata, requests: [{ fragment: 'R1', intent: 'Necesidad de evitar gradas',
        request_type: 'specific_fact', status: 'answered', evidence: reply, fact_key: null }] }
    }
    return { review_contract: 'business-risk-v2', verdict: 'pass', facts: [], findings: [], question: { ...metadata, offered_action: 'none' } }
  })
  assert.equal(result.reply, reply, JSON.stringify(result.audit))
  assert.equal(result.needsAdvisor, false)
  assert.equal(writerCalls, 1)
  const evidence = object(writerContext.contexto_verificado)
  assert.deepEqual(evidence.instalaciones, available ? [originalElevator] : [])
  assert.match(String(object(writerContext.razonamiento_contextual).guidance), /existencia de ascensores no demuestra/)
  assert.deepEqual(object(object(verified.semantica_turno).catalog_request).semantic_preferences, [])
  assert.deepEqual(verified, original)
})

const bedMeasures = 'Dos camas de 0,90 m por 1,90 m: ¿qué superficie suman?'
const footprintProof = (result: number): Row => ({ operation: 'multiply', scope: 'grounded', operands: [
  { value: 0.9, unit: 'm', source: { kind: 'lead_current', reference: '', quote: bedMeasures } },
  { value: 1.9, unit: 'm', source: { kind: 'lead_current', reference: '', quote: bedMeasures } },
  { value: 2, unit: 'count', source: { kind: 'lead_current', reference: '', quote: bedMeasures } },
], result: { value: result, unit: 'm2' } })
const footprintReply = 'Con las medidas que indica, las dos camas suman 3.42 m² de huella. Eso no confirma que quepan: faltan las dimensiones y la distribución de la habitación para revisar la circulación. '+question
function footprintFact(calculation: Row): Row {
  return { statement: 'las dos camas suman 3.42 m² de huella', kind: 'other_calculation', subject_id: null,
    scope: null, field: 'derived_value', value: 3.42, upper_value: null, relation: 'eq', unit: 'm2', calculation }
}

for (const brokenMetadata of [false, true]) test('writer/reviewer verifies bed-footprint arithmetic without changing the property area; repaired metadata='+brokenMetadata, async () => {
  const calls: string[] = []
  let reviews = 0
  const result = await completeTurnReply({ current: bedMeasures, baseReply: footprintReply, verified: inputFor(bedMeasures),
    audit: { source: 'property_details', semantic_review_enabled: true, business_risk_review_enabled: true } },
  async (_rules, raw, _schema, _image, _file, _tone, task) => {
    calls.push(task || '')
    if (task === 'writing') return { reply: footprintReply, question: metadata, requests: [{ fragment: 'R1', intent: 'Superficie ocupada por camas',
      request_type: 'specific_fact', status: 'answered', evidence: 'Cálculo de huella y limitación de distribución', fact_key: null }] }
    reviews++
    assert.equal(object(raw).borrador, footprintReply)
    return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [],
      facts: [footprintFact(footprintProof(brokenMetadata && reviews === 1 ? 3.5 : 3.42))],
      question: { ...metadata, offered_action: 'none' } }
  })
  assert.equal(result.reply, footprintReply, JSON.stringify(result.audit))
  assert.equal(result.audit.status, 'checked')
  assert.deepEqual(calls, brokenMetadata ? ['writing', 'review', 'review'] : ['writing', 'review'])
  const checks = object(result.audit.semantic_review).fact_checks as Row[]
  assert.equal(checks[0].status, 'verified')
  assert.equal(object(checks[0].fact).field, 'derived_value')
  assert.equal(unit.area_internal_m2, 142.09)
  assert.equal(object(result.audit.question).continuation_id, 'financing_partner')
})

test('verified arithmetic never overrides a semantic finding about guaranteed fit', async () => {
  const badReply = 'Con las medidas que indica, las dos camas suman 3.42 m² de huella. Le garantizo que caben cómodamente en esa habitación. '+question
  const calls: string[] = []
  let drafts = 0, reviews = 0
  const result = await completeTurnReply({ current: bedMeasures, baseReply: footprintReply, verified: inputFor(bedMeasures),
    audit: { source: 'property_details', semantic_review_enabled: true, business_risk_review_enabled: true } },
  async (_rules, _raw, _schema, _image, _file, _tone, task) => {
    calls.push(task || '')
    if (task === 'writing') return { reply: ++drafts === 1 ? badReply : footprintReply, question: metadata,
      requests: [{ fragment: 'R1', intent: 'Huella de dos camas', request_type: 'specific_fact', status: 'answered', evidence: 'Cálculo', fact_key: null }] }
    const first = ++reviews === 1
    return { review_contract: 'business-risk-v2', verdict: first ? 'block' : 'pass',
      facts: [footprintFact(footprintProof(3.42))], question: { ...metadata, offered_action: 'none' },
      findings: first ? [{ category: 'hard_fact', statement: 'Le garantizo que caben cómodamente en esa habitación.',
        reason: 'La huella de las camas no demuestra cabida ni circulación sin medidas y distribución de la habitación.',
        authoritative_fact: 'Solo existen medidas de las camas; faltan dimensiones y distribución de la habitación.' }] : [] }
  })
  assert.equal(result.reply, footprintReply, JSON.stringify(result.audit))
  assert.deepEqual(calls, ['writing', 'review', 'writing', 'review'])
  assert.equal(result.needsAdvisor, false)
  assert.doesNotMatch(result.reply, /garantizo/)
  assert.equal(object(result.audit.question).continuation_id, 'financing_partner')
})
