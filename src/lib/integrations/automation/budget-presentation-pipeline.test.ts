import { writerFixture } from './fixtures/writer-response.fixture'
import assert from 'node:assert/strict'
import test from 'node:test'
import { object, text, type Row } from './data'
import { commercialJourneyPlan } from './commercial-journey'
import { catalogDialogueReply, budgetRecommendationBase } from './catalog-dialogue'
import { budgetRecommendationPresentation } from './budget-presentation'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { taskModelEvidence, taskVerifiedContext } from './task-context'
import { turnEvidence } from './turn-evidence'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const catalog: Row[] = [
  { id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3, floor_number: 2, floor: 'Segunda planta alta', published_commercial_price: 250000 },
  { id: 'd302', unit_number: '302', category: 'departamento', bedrooms: 3, floor_number: 3, floor: 'Tercera planta alta', published_commercial_price: 270000 },
  { id: 'd402', unit_number: '402', category: 'departamento', bedrooms: 3, floor_number: 4, floor: 'Cuarta planta alta', published_commercial_price: 290000 },
  { id: 'd502', unit_number: '502', category: 'departamento', bedrooms: 3, floor_number: 5, floor: 'Quinta planta alta', published_commercial_price: 310000 },
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6, floor: 'Sexta planta alta', published_commercial_price: 550000 },
  { id: 'p605', unit_number: '605', category: 'penthouse', bedrooms: 3, floor_number: 6, floor: 'Sexta planta alta', published_commercial_price: 539900 },
].map(unit => ({ ...unit, area_internal_m2: unit.category === 'departamento' ? 120.83 : unit.unit_number === '602' ? 142.09 : 140.53,
  area_exterior_m2: unit.category === 'departamento' ? 27.03 : 25.3, bathrooms_full: 2, status: 'disponible', is_published: true }))

function info(): Row {
  return { catalogo: structuredClone(catalog), catalogo_verificacion: structuredClone(catalog),
    catalog_read: { complete: true }, catalog_verification_read: { complete: true },
    lead: { full_name: 'Carlos', residence_city: 'Cuenca', purchase_purpose: 'vivir' },
    perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca', residence_confirmed: true, status: 'confirmed' },
    recorrido_comercial: {}, politica_comercial: { precios_autorizados: true },
    hechos_confirmados: { budget: { status: 'maximum_total', amount: 400000, confidence: 'high', evidence: 'Tengo unos 400 mil más o menos' } },
    property_context: { query: { group: 'residential', category: null, operation: 'search', scope: 'catalog', filters: { bedrooms: 3 } }, selected_ids: [] },
    semantica_turno: { primary_intent: 'answer_previous', primary_evidence: 'Unos tres dormitorios', confidence: 'high',
      budget: { status: 'not_discussed' }, property: { group: 'residential', category: null, operation: 'search',
        reference_kind: 'none', filters: { bedrooms: 3 }, evidence: 'Unos tres dormitorios', confidence: 'high' } },
    solicitudes_interpretadas: [{ domain: 'property', request: 'Unos tres dormitorios', evidence: 'Unos tres dormitorios', confidence: 'high' }] }
}

function planned(data: Row) {
  return { ...data, siguiente_paso_comercial: commercialJourneyPlan(data) }
}

test('budget recommendation base excludes outside PH while the catalogue audit and original query remain complete', () => {
  const data = planned(info()), original = structuredClone(data)
  const presentation = budgetRecommendationPresentation(data)!
  assert.deepEqual(presentation.unit_ids, ['d202', 'd302', 'd402', 'd502'])
  const draft = catalogDialogueReply(data, 'Unos tres dormitorios')!
  assert.match(draft.reply, /Departamentos de 3 dormitorios/)
  assert.doesNotMatch(draft.reply, /penthouse|140|142/i)
  assert.match(draft.reply, /¿Le gustaría que exploremos los departamentos\?/)
  assert.deepEqual(rows(object(draft.audit.catalog_results).units).map(unit => unit.unit_number), ['202', '302', '402', '502', '602', '605'])
  assert.deepEqual(draft.audit.offered_unit_ids, ['d202', 'd302', 'd402', 'd502'])
  assert.deepEqual(data, original, 'the recommendation does not modify the durable query or catalogue')
})

for (const mode of ['normal', 'demonstration', 'disabled'] as const)
  test(`${mode}: an early full-catalogue draft is realigned after planning and its writer facts contain only affordable recommendations`, async () => {
    const data = info(), draft = catalogDialogueReply(data, 'Unos tres dormitorios')!
    assert.match(draft.reply, /penthouses/i, 'the route draft predates the shared plan')
    const original = structuredClone(data)
    let writer: Row = {}
    const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: mode === 'demonstration', updatedAt: null },
      () => completeTurnReply({ current: 'Unos tres dormitorios', baseReply: draft.reply, verified: data,
        audit: { ...draft.audit, semantic_review_enabled: true, business_risk_review_enabled: true } },
      async (_rules, raw, _schema, _image, _file, _tone, task) => {
        const context = object(raw)
        const question = { role: 'necessary_clarification', purpose: 'choose_property', missing_datum: '',
          next_decision: 'Explorar departamentos', continuation_id: 'property_category', continuation_act: 'choose_category' }
        if (task === 'review') return { review_contract: 'content-review-v1', verdict: 'pass', findings: [] }
        writer = context
        return writerFixture({ reply: 'Podemos revisar los departamentos de tres dormitorios. ¿Le gustaría que exploremos los departamentos?',
          question, requests: rows(context.referencias_solicitud).map(ref => ({ fragment: ref.id, intent: 'Orientar por dormitorios',
            request_type: 'general_information', status: 'answered', evidence: 'Podemos revisar los departamentos de tres dormitorios.', fact_key: null })) })
      }))
    assert.deepEqual(rows(object(writer.evidencia_turno).units).map(unit => unit.unit_number), ['202', '302', '402', '502'])
    assert.ok(rows(object(writer.evidencia_turno).groups).every(group => group.category !== 'penthouse'))
    assert.deepEqual(object(object(writer.response_content_scope).property_presentation).available_residential_categories, ['departamento'])
    assert.equal(object(object(writer.evidencia_turno).presentation_scope).canonical_query_unchanged, true)
    assert.equal(object(object(writer.property_context).query).category, null)
    assert.doesNotMatch(text(result.audit.base_preview), /penthouses|140,53|142,09/i)
    assert.doesNotMatch(result.reply, /penthouses/i)
    assert.deepEqual(data, original, 'the complete canonical input remains available for validation')
  })

test('an explicit PH request retains its real options above budget rather than replacing the desired category', () => {
  const data = info(), context = object(data.property_context), semantics = object(data.semantica_turno)
  object(context.query).category = 'penthouse'
  context.category_preference = { category: 'penthouse', confirmed: true }
  object(semantics.property).category = 'penthouse'
  const input = planned(data)
  assert.equal(budgetRecommendationPresentation(input), null)
  assert.equal(budgetRecommendationBase(input), null)
  const draft = catalogDialogueReply(input, 'Quiero explorar los penthouses')!
  assert.ok(rows(object(draft.audit.catalog_results).units).every(unit => unit.category === 'penthouse'))
  const canonical = turnEvidence(input, draft.audit)
  const projected = taskModelEvidence(canonical, taskVerifiedContext(input, draft.audit, 'Quiero explorar los penthouses'))
  assert.deepEqual(projected.units.map(unit => unit.unit_number), ['602', '605'])
  assert.equal(object(object(input.property_context).query).category, 'penthouse')
})

test('accepted financing preserves PH selection above the original total budget', () => {
  const data = info(), context = object(data.property_context)
  object(context.query).category = 'penthouse'
  context.category_preference = { category: 'penthouse', confirmed: true }
  data.financiamiento = { journey: { accepted: true, status: 'accepted' }, entry: { status: 'amount', amount: 200000 } }
  data.financing_amounts = { down_payment: { amount: 200000, evidence: 'Puedo poner 200 mil de entrada' } }
  const input = planned(data), draft = catalogDialogueReply(input, 'Revisemos esas opciones para el crédito')!
  assert.equal(budgetRecommendationPresentation(input), null)
  const projected = taskModelEvidence(turnEvidence(input, draft.audit), taskVerifiedContext(input, draft.audit, 'Revisemos esas opciones para el crédito'))
  assert.deepEqual(projected.units.map(unit => unit.unit_number), ['602', '605'])
  assert.equal(object(object(input.siguiente_paso_comercial).readiness).financing_accepted, true)
})

test('a deferred budget and a comparison keep full pertinent information', () => {
  const uncertain = info()
  uncertain.hechos_confirmados = { budget: { status: 'unknown', amount: null, confidence: 'high', evidence: 'Todavía no sé cuánto invertir' } }
  const unknown = planned(uncertain), draft = catalogDialogueReply(unknown)!
  assert.equal(budgetRecommendationPresentation(unknown), null)
  assert.match(draft.reply, /penthouses/i)
  const projected = taskModelEvidence(turnEvidence(unknown, draft.audit), taskVerifiedContext(unknown, draft.audit, 'Unos tres dormitorios'))
  assert.equal(projected.units.length, 6)
  const comparison = planned(info())
  object(object(comparison.property_context).query).operation = 'compare'
  assert.equal(budgetRecommendationPresentation(comparison), null)
  assert.equal(budgetRecommendationBase(comparison), null)
})

test('partial price evidence, contradictory membership and new explicit requests do not become recommendation filters', () => {
  const missingPrice = planned(info())
  object(object(missingPrice.siguiente_paso_comercial).budget_guidance).price_evidence_complete = false
  assert.equal(budgetRecommendationPresentation(missingPrice), null)
  const wrongMembership = planned(info())
  object(object(wrongMembership.siguiente_paso_comercial).selection_scope).unit_ids = ['d202', 'p602']
  assert.equal(budgetRecommendationPresentation(wrongMembership), null, 'an outside option cannot masquerade as an affordable recommendation')
  const explicit = planned(info())
  object(object(explicit.semantica_turno).property).category = 'penthouse'
  assert.equal(budgetRecommendationPresentation(explicit), null, 'a new explicit category outranks a pending recommendation')
  const compound = planned(info())
  compound.solicitudes_interpretadas = [...rows(compound.solicitudes_interpretadas),
    { domain: 'property', request: 'Compare también los penthouses', confidence: 'high' }]
  assert.equal(budgetRecommendationPresentation(compound), null, 'a recommendation cannot suppress a second independent request')
})

test('an answer without a new search command still uses the verified recommendation before categories', () => {
  const data = info()
  object(object(data.property_context).query).operation = 'none'
  object(object(data.semantica_turno).property).operation = 'none'
  const input = planned(data), originalQuery = structuredClone(object(input.property_context).query)
  const plan = object(input.siguiente_paso_comercial)
  assert.equal(plan.action, 'select_property')
  assert.equal(plan.question_id, 'property_category')
  assert.deepEqual(object(plan.selection_scope).unit_ids, ['d202', 'd302', 'd402', 'd502'])
  const presentation = budgetRecommendationPresentation(input)!
  assert.deepEqual(presentation.unit_ids, ['d202', 'd302', 'd402', 'd502'])
  const base = budgetRecommendationBase(input, { source: 'catalog_search' })!
  assert.match(base, /Departamentos de 3 dormitorios/)
  assert.doesNotMatch(base, /penthouse/i)
  const projected = taskModelEvidence(turnEvidence(input), taskVerifiedContext(input, { source: 'catalog_search' }, 'Unos tres dormitorios'))
  assert.deepEqual(projected.units.map(unit => unit.unit_number), ['202', '302', '402', '502'])
  assert.deepEqual(object(input.property_context).query, originalQuery)
  assert.equal(object(object(input.property_context).query).operation, 'none')
})
