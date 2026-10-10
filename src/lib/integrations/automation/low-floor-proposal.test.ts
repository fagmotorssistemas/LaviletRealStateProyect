import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogDialogueReply, catalogQuery, catalogRequirementAlternative } from './catalog-dialogue'
import { commercialJourneyPlan, journeyPendingQuestion } from './commercial-journey'
import { resolvePropertyTurn, rememberPropertyReply } from './property-context'
import { normalizedPendingQuestion, normalizeTurnSemantics, propertyFiltersFromText } from './turn-semantics'
import { object, type Row } from './data'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { progressivePendingQuestion } from './progressive-options'
import { actualContinuation } from './continuation-validation'

const catalog: Row[] = [
  { id: 's001', category: 'suite', unit_number: '001', bedrooms: 1, floor_number: 0, floor: 'Planta baja', published_commercial_price: 160000 },
  { id: 'd101', category: 'departamento', unit_number: '101', bedrooms: 2, floor_number: 1, floor: 'Primera planta alta', published_commercial_price: 240000 },
  { id: 'd202', category: 'departamento', unit_number: '202', bedrooms: 3, floor_number: 2, floor: 'Segunda planta alta', area_internal_m2: 120.83, area_exterior_m2: 27.03, published_commercial_price: 250000 },
  { id: 'd203', category: 'departamento', unit_number: '203', bedrooms: 3, floor_number: 2, floor: 'Segunda planta alta', area_internal_m2: 120.83, area_exterior_m2: 27.03, published_commercial_price: 260000 },
  { id: 'd302', category: 'departamento', unit_number: '302', bedrooms: 3, floor_number: 3, floor: 'Tercera planta alta', area_internal_m2: 120.83, area_exterior_m2: 27.03, published_commercial_price: 270000 },
  { id: 'p602', category: 'penthouse', unit_number: '602', bedrooms: 3, floor_number: 6, floor: 'Sexta planta alta', published_commercial_price: 550000 },
]
const query = () => catalogQuery({ group: 'residential', category: 'departamento', operation: 'search', filters: { bedrooms: 3, floor_number: 0 } })
function info(): Row {
  return { catalogo: catalog, catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true },
    lead: { purchase_purpose: 'vivir', preferred_bedrooms: 3 },
    hechos_confirmados: { budget: { status: 'maximum_total', amount: 300000, confidence: 'high', evidence: 'mi presupuesto total es 300 mil' } },
    property_context: { query: query(), category_preference: { category: 'departamento', confirmed: true } },
    semantica_turno: { primary_intent: 'select_property', budget: { status: 'not_discussed' } },
    financiamiento: { journey: {} }, recorrido_comercial: {} }
}
function receipt(input = info()) {
  const plan = commercialJourneyPlan(input)
  const reply = `No hay opciones de tres dormitorios en planta baja. ${String(plan.question)}`
  const pending = normalizedPendingQuestion(journeyPendingQuestion(reply, plan, true), catalog)
  const context = rememberPropertyReply(catalog, object(input.property_context), reply,
    { pending_question: pending, original_query: plan.requested_query })
  return { plan, pending, context }
}
function answer(current: string, pending: Row, kind = 'affirmative') {
  return normalizeTurnSemantics({ turn_semantics: { primary_intent: 'answer_previous', primary_evidence: current, confidence: 'high',
    property: { operation: 'none', reference_kind: 'followup', evidence: current, confidence: 'high' },
    answer_to_previous: { question_id: pending.id, kind, evidence: current, confidence: 'high' } } }, current, pending)
}

test('unavailable ground floor proposes the lowest compatible floor before fewer bedrooms', () => {
  const alternative = catalogRequirementAlternative(catalog, query(), new Set())
  assert.equal(alternative?.field, 'floor_number')
  assert.equal(alternative?.query.filters.floor_number, 2)
  assert.equal(alternative?.query.filters.bedrooms, 3)
  assert.deepEqual(alternative?.units.map(unit => unit.id), ['d202', 'd203'])
  assert.equal(query().filters.floor_number, 0)
})

test('planner and catalogue propose the same concrete floor with its official label', () => {
  const input = info(), plan = commercialJourneyPlan(input), draft = catalogDialogueReply(input)
  assert.equal(plan.action, 'clarify_requirements')
  assert.equal(plan.question_id, 'property_requirements')
  assert.equal(plan.question_act, 'explore_alternatives')
  assert.match(String(plan.question), /Segunda planta alta/)
  assert.doesNotMatch(String(plan.question), /plantas diferentes|baja|dormitorios/)
  assert.equal(object(object(plan.proposed_query).filters).floor_number, 2)
  assert.deepEqual(plan.alternative_unit_ids, ['d202', 'd203'])
  assert.equal(object(draft?.audit.pending_question).question, plan.question)
  assert.deepEqual(object(draft?.audit.alternative_results).unit_ids, plan.alternative_unit_ids)
  assert.match(String(plan.instruction), /No dé esa propuesta por elegida/)
})

test('accepted floor proposal keeps bedrooms and budget without selecting a unit', () => {
  const { pending, context } = receipt(), current = 'Sí, revisemos esa segunda planta'
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], answer(current, pending))
  assert.equal(object(resolved.query.filters).floor_number, 2)
  assert.equal(object(resolved.query.filters).bedrooms, 3)
  assert.deepEqual(resolved.matches.map(unit => unit.id), ['d202', 'd203'])
  assert.deepEqual(resolved.context.selected_ids, [])
  assert.equal(object(object(resolved.context.original_query).filters).floor_number, 0)
  assert.ok(!(resolved.query.requirements as Row[] | undefined)?.some(r => r.field === 'published_commercial_price'))
  const next = commercialJourneyPlan({ ...info(), property_context: resolved.context })
  assert.equal(next.question_id, 'unit_choice')
  assert.deepEqual(object(next.selection_scope).unit_ids, ['d202', 'd203'])
})

test('declining the proposed floor never accepts fewer bedrooms or repeats the proposal', () => {
  const { pending, context } = receipt(), current = 'No, gracias'
  const semantics = answer(current, pending, 'negative')
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], semantics)
  assert.equal(object(resolved.query.filters).floor_number, 0)
  assert.equal(object(resolved.query.filters).bedrooms, 3)
  assert.deepEqual(resolved.context.selected_ids, [])
  const input = { ...info(), property_context: resolved.context, semantica_turno: semantics }
  const next = commercialJourneyPlan(input), draft = catalogDialogueReply(input)
  assert.equal(object(object(next.proposed_query).filters).bedrooms, 2)
  assert.equal(object(object(next.proposed_query).filters).floor_number, 1)
  assert.deepEqual(next.alternative_unit_ids, ['d101'])
  assert.match(String(next.question), /2 dormitorios en Primera planta alta/)
  assert.equal(object(draft?.audit.pending_question).question, next.question)
  assert.match(String(next.instruction), /no aceptó reducir dormitorios/)
  assert.equal(object(resolved.query.filters).bedrooms, 3)
  assert.equal(object(resolved.query.filters).floor_number, 0)
})

test('indispensable bedrooms permit a floor change that preserves the same rooms', () => {
  const input = info()
  object(object(object(input.property_context).query).filters).bedrooms_required = true
  const { plan, pending, context } = receipt(input), current = 'Sí, está bien'
  assert.equal(object(object(plan.proposed_query).filters).bedrooms, 3)
  assert.equal(object(object(plan.proposed_query).filters).bedrooms_required, true)
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], answer(current, pending))
  assert.equal(object(resolved.query.filters).floor_number, 2)
  assert.equal(object(resolved.query.filters).bedrooms_required, true)
  assert.deepEqual(resolved.matches.map(unit => unit.id), ['d202', 'd203'])
})

test('the nearest compatible floor preserves unrelated modeled requirements and exclusions', () => {
  const input = catalogQuery({ ...query(), category: null, filters: { bedrooms: 3 }, requirements: [
    { field: 'floor_number', operator: 'lte', value: 1, strength: 'required', evidence: 'no más de un piso' },
    { field: 'published_commercial_price', operator: 'lte', value: 255000, strength: 'required', evidence: 'hasta 255 mil' },
  ] })
  const result = catalogRequirementAlternative(catalog, input, new Set(['penthouse']))
  assert.equal(result?.query.filters.floor_number, 2)
  assert.equal(result?.query.filters.bedrooms, 3)
  assert.deepEqual(result?.units.map(unit => unit.id), ['d202'])
  assert.ok(result?.query.requirements?.some(r => r.field === 'published_commercial_price' && r.value === 255000))
})

test('a confirmed total cap filters the offered units without becoming a durable price condition', () => {
  const capped = info()
  object(object(capped.hechos_confirmados).budget).amount = 255000
  const plan = commercialJourneyPlan(capped)
  assert.deepEqual(plan.alternative_unit_ids, ['d202'])
  assert.ok(!(object(plan.proposed_query).requirements as Row[] | undefined)?.some(r => r.field === 'published_commercial_price'))
  const entry = info()
  object(entry.hechos_confirmados).budget = { status: 'initial_capital', amount: 200000, confidence: 'high', evidence: '200 mil para la entrada' }
  const next = commercialJourneyPlan(entry)
  assert.deepEqual(next.alternative_unit_ids, ['d202', 'd203'])
  assert.ok(!(object(next.proposed_query).requirements as Row[] | undefined)?.some(r => r.field === 'published_commercial_price'))
})

test('no verified option within a confirmed cap cannot silently reduce bedrooms or raise the budget', () => {
  const input = info()
  object(object(input.hechos_confirmados).budget).amount = 200000
  const plan = commercialJourneyPlan(input)
  assert.equal(plan.action, 'clarify_requirements')
  assert.equal(plan.proposed_query, undefined)
  assert.equal(object(object(plan.requested_query).filters).bedrooms, 3)
  assert.equal(object(object(plan.requested_query).filters).floor_number, 0)
  assert.equal(object(object(plan.readiness).budget).amount, 200000)
  assert.equal(plan.financing_offer_allowed, false)
  const explicitCap = catalogQuery({ ...query(), requirements: [
    { field: 'published_commercial_price', operator: 'lte', value: 200000, strength: 'required', evidence: 'hasta 200 mil' },
  ] })
  assert.equal(catalogRequirementAlternative(catalog, explicitCap, new Set()), null)
})

test('unpublished and unavailable lower floors do not establish a proposal', () => {
  const units = catalog.map(unit => Number(unit.floor_number) === 2 ? { ...unit, status: 'reservado' } : unit)
  const nearest = catalogRequirementAlternative(units, query(), new Set())
  assert.equal(nearest?.query.filters.floor_number, 3)
  const none = catalogRequirementAlternative(catalog.filter(unit => Number(unit.bedrooms) === 3).map(unit => ({ ...unit, is_published: false })), query(), new Set())
  assert.equal(none, null)
})

test('accepting an affordable floor proposal does not widen it, and a changed budget leaves no stale price filter', () => {
  const input = info()
  object(object(input.hechos_confirmados).budget).amount = 255000
  const { pending, context } = receipt(input), current = 'Sí, revisemos esa opción'
  assert.deepEqual(pending.candidate_ids, ['d202'])
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], answer(current, pending))
  assert.deepEqual(resolved.matches.map(unit => unit.id), ['d202'])
  assert.ok(!(resolved.query.requirements as Row[] | undefined)?.some(r => r.field === 'published_commercial_price'))
  const changed = { ...input, property_context: resolved.context,
    semantica_turno: { primary_intent: 'answer_previous', budget: { status: 'maximum_total', amount: 300000,
      confidence: 'high', evidence: 'puedo subir mi presupuesto total a 300 mil' } } }
  const next = commercialJourneyPlan(changed)
  assert.deepEqual(object(next.selection_scope).unit_ids, ['d202', 'd203'])
  assert.equal(object(object(next.readiness).budget).amount, 300000)
})

test('a missing lowest unit does not revive unavailable inventory and ties stay open', () => {
  const next = catalogRequirementAlternative(catalog.filter(unit => Number(unit.floor_number) !== 2), query(), new Set())
  assert.equal(next?.query.filters.floor_number, 3)
  assert.deepEqual(next?.units.map(unit => unit.id), ['d302'])
  const tied = catalogRequirementAlternative(catalog.filter(unit => unit.id !== 'd302').map(unit => unit.id === 'p602' ? { ...unit, category: 'departamento' } : unit),
    catalogQuery({ ...query(), filters: { bedrooms: 3, floor_number: 4 } }), new Set())
  assert.equal(tied?.query.filters.floor_number, null)
  assert.deepEqual(tied?.units.map(unit => unit.id), ['d202', 'd203', 'p602'])
})

test('relative low-floor preferences do not invent ground floor or an exact floor', () => {
  for (const current of ['Prefiero los pisos bajos', 'Me gustan las plantas bajas para no subir gradas']) {
    assert.equal(propertyFiltersFromText(current).floor_number, null)
  }
  assert.equal(propertyFiltersFromText('Me gustaría una planta baja para no subir gradas').floor_number, 0)
})

test('a pending floor proposal keeps the concrete question when the lead asks for information', () => {
  const { pending, context } = receipt()
  const input = { ...info(), property_context: { ...context, pending_question: pending } }
  const next = commercialJourneyPlan(input)
  assert.match(String(next.question), /Segunda planta alta/)
  assert.equal(object(object(next.proposed_query).filters).floor_number, 2)
})

function afterFloorDecline(input = info(), current = 'No, gracias') {
  const { pending, context } = receipt(input), semantics = answer(current, pending, 'negative')
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], semantics)
  return { ...input, property_context: resolved.context, semantica_turno: semantics }
}

test('a second, different proposal remains pending until yes and a second no never creates a third offer', () => {
  const input = afterFloorDecline(), plan = commercialJourneyPlan(input)
  const reply = `Podemos revisar un departamento con menos dormitorios en una planta inferior. ${String(plan.question)}`
  const pending = journeyPendingQuestion(reply, plan, true, { purpose: 'clarify_request', continuation_id: 'property_requirements', continuation_act: 'explore_alternatives' })
  const context = rememberPropertyReply(catalog, object(input.property_context), reply, { pending_question: pending, original_query: plan.requested_query })
  const waiting = commercialJourneyPlan({ ...input, property_context: context,
    semantica_turno: { primary_intent: 'project_information', budget: { status: 'not_discussed' } } })
  assert.equal(waiting.question, plan.question)
  assert.equal(object(object(context.query).filters).bedrooms, 3)
  assert.equal(object(object(context.query).filters).floor_number, 0)
  const yes = 'Sí, veamos esa alternativa'
  const accepted = resolvePropertyTurn(catalog, yes, { _property_context: context, _pending_question: pending }, [], answer(yes, pending))
  assert.equal(object(accepted.query.filters).bedrooms, 2)
  assert.equal(object(accepted.query.filters).floor_number, 1)
  assert.deepEqual(accepted.matches.map(unit => unit.id), ['d101'])
  assert.deepEqual(accepted.context.selected_ids, [])
  assert.equal(object(object(accepted.context.original_query).filters).bedrooms, 3)
  const no = 'No, prefiero no elegir esa opción'
  const rejected = resolvePropertyTurn(catalog, no, { _property_context: context, _pending_question: pending }, [], answer(no, pending, 'negative'))
  const closed = commercialJourneyPlan({ ...input, property_context: rejected.context, semantica_turno: answer(no, pending, 'negative') })
  assert.equal(closed.question, '')
  assert.equal(closed.proposed_query, undefined)
  assert.equal(object(rejected.query.filters).bedrooms, 3)
})

test('general refusal, indispensable bedrooms, missing verification and missing lower alternatives leave the conversation open', () => {
  const strict = info()
  object(object(object(strict.property_context).query).filters).bedrooms_required = true
  const incomplete = afterFloorDecline()
  incomplete.catalog_read = { complete: false }
  const noLower = afterFloorDecline()
  noLower.catalogo = catalog.filter(unit => unit.id !== 'd101')
  const budgetTooLow = afterFloorDecline()
  budgetTooLow.hechos_confirmados = { budget: { status: 'maximum_total', amount: 200000, confidence: 'high', evidence: 'mi presupuesto total es 200 mil' } }
  for (const input of [afterFloorDecline(info(), 'No quiero seguir revisando opciones'), afterFloorDecline(strict), incomplete, noLower, budgetTooLow]) {
    const plan = commercialJourneyPlan(input)
    assert.equal(plan.question, '')
    assert.equal(plan.proposed_query, undefined)
    assert.equal(object(object(object(input.property_context).query).filters).bedrooms, 3)
    assert.equal(object(object(object(input.property_context).query).filters).floor_number, 0)
  }
})

for (const mode of ['normal', 'demonstration', 'disabled'] as const)
  test(`${mode}: lower floor with fewer bedrooms survives writer, review, receipt and the next yes`, async () => {
    const input = afterFloorDecline(), current = 'No, gracias'
    input.perfil_lead = { full_name: 'Carlos', residence_city: 'Cuenca', residence_status: 'confirmed' }
    const plan = commercialJourneyPlan(input), draft = catalogDialogueReply(input, current)!
    const reply = `Entiendo. Podemos revisar una alternativa en la primera planta alta con dos dormitorios. ${String(plan.question)}`
    const metadata = { role: 'necessary_clarification', purpose: 'clarify_request', missing_datum: 'Aceptar menos dormitorios en una planta inferior',
      next_decision: 'Explorar esa alternativa sin seleccionar una unidad', continuation_id: 'property_requirements', continuation_act: 'explore_alternatives' }
    assert.equal(actualContinuation(reply).id, plan.question_id)
    assert.equal(actualContinuation(reply).act, plan.question_act)
    const tasks: string[] = [], audit = { ...draft.audit, semantic_review_enabled: true, business_risk_review_enabled: true, commercial_journey: plan }
    const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: mode === 'demonstration', updatedAt: null },
      () => completeTurnReply({ current, baseReply: draft.reply, verified: { ...input, siguiente_paso_comercial: plan }, audit },
        async (_rules, raw, _schema, _image, _file, _tone, task) => {
          const context = object(raw); tasks.push(task || '')
          const obligations = Array.isArray(context.obligaciones_del_turno) ? context.obligaciones_del_turno.map(object) : []
          assert.equal(obligations.find(value => value.id === 'commercial_next_step')?.question_id, 'property_requirements')
          if (task === 'writing') return { reply, question: metadata,
            requests: (Array.isArray(context.referencias_solicitud) ? context.referencias_solicitud.map(object) : []).map(ref => ({ fragment: ref.id,
              intent: 'Mantener la segunda propuesta pendiente de aceptación', request_type: 'general_information', status: 'answered', evidence: reply, fact_key: null })) }
          return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: { ...metadata, offered_action: 'none' } }
        }))
    assert.equal(result.reply, reply, JSON.stringify(result.audit.final_validation))
    assert.equal(result.needsAdvisor, false)
    assert.deepEqual(tasks, mode === 'disabled' ? ['writing'] : ['writing', 'review'])
    const pending = progressivePendingQuestion(result.reply, { ...audit, turn_completeness: result.audit })
    assert.equal(pending.id, 'property_requirements')
    assert.equal(pending.act, 'explore_alternatives')
    assert.deepEqual(pending.candidate_ids, ['d101'])
    assert.equal(object(object(pending.proposed_query).filters).bedrooms, 2)
    assert.equal(object(object(pending.proposed_query).filters).floor_number, 1)
    const context = rememberPropertyReply(catalog, object(input.property_context), result.reply, { pending_question: pending, original_query: plan.requested_query })
    const yes = 'Sí, está bien'
    const resolved = resolvePropertyTurn(catalog, yes, { _property_context: context, _pending_question: pending }, [], answer(yes, pending))
    assert.equal(object(resolved.query.filters).bedrooms, 2)
    assert.equal(object(resolved.query.filters).floor_number, 1)
    assert.deepEqual(resolved.matches.map(unit => unit.id), ['d101'])
    assert.deepEqual(resolved.context.selected_ids, [])
  })
