import assert from 'node:assert/strict'
import test from 'node:test'
import { object, type Row } from './data'
import { commercialJourneyPlan, journeyPendingQuestion } from './commercial-journey'
import { rememberPropertyReply, resolvePropertyTurn } from './property-context'
import { normalizedPendingQuestion } from './turn-semantics'
import { commercialReply } from './sdr'
import { retrieveCatalogByEmbeddings } from './catalog-embeddings'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { responseReviewSettings } from '@/lib/inmobiliaria/responseReview'

const units: Row[] = [
  { id: 'd302', unit_number: '302', category: 'departamento', bedrooms: 3, floor_number: 3,
    area_internal_m2: 120.83, published_commercial_price: 300000 },
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6,
    area_internal_m2: 142.09, published_commercial_price: 550000 },
  { id: 's303', unit_number: '303', category: 'suite', bedrooms: 1, floor_number: 3,
    area_internal_m2: 70, published_commercial_price: 210000 },
].map(unit => ({ ...unit, status: 'disponible', is_published: true }))
const requirement = { field: 'bedrooms', operator: 'eq', value: 5, strength: 'required', evidence: 'unos 5 cuartos' }
const originalQuery = { group: 'residential', category: null, operation: 'search', scope: 'catalog',
  filters: { bedrooms: 5 }, requirements: [requirement] }

function proposal() {
  const info: Row = { catalogo: units, catalog_read: { complete: true },
    lead: { purchase_purpose: 'vivir', preferred_bedrooms: 5 },
    property_context: { query: originalQuery, optimized_catalog_request: {
      group: 'residential', category: null, requirements: [requirement] } },
    semantica_turno: { confidence: 'high', budget: { status: 'not_discussed' } } }
  const plan = commercialJourneyPlan(info)
  const pending = normalizedPendingQuestion(journeyPendingQuestion(String(plan.question), plan, true), units)
  const context = rememberPropertyReply(units, object(info.property_context), String(plan.question), {
    pending_question: pending, original_query: plan.requested_query })
  return { context, pending }
}

test('price follow-up keeps the proposed subject through retrieval, writing, review and memory', async () => {
  for (const literal of [false, true]) for (const enabled of [false, true]) for (const reviewed of [false, true]) {
    const current = literal ? 'que precio tiene el departamento 302?' : 'oh pero que precios tienen??'
    const expectedIds = literal ? ['d302'] : ['d302', 'p602']
    const expectedNumbers = literal ? ['302'] : ['302', '602']
    const { context, pending } = proposal()
    // Recorded failure: the model recognized prices but incorrectly marked a
    // broad search. The pending proposal must resolve the subject in code.
    const semantics: Row = { primary_intent: 'ask_price', confidence: 'high',
      property: { group: 'residential', category: null, operation: 'search', query_scope: 'catalog',
        reference_kind: literal ? 'explicit' : 'none', unit_numbers: literal ? ['302'] : [],
        confidence: 'high', evidence: current, filters: {} },
      catalog_request: { version: 'catalog-request-v1', purpose: 'range', metric: 'published_commercial_price',
        requirements: [], semantic_preferences: [], confidence: 'high', evidence: current },
      catalog_request_status: 'validated', budget: { status: 'not_discussed' },
      answer_to_previous: { question_id: 'property_requirements', kind: 'uncertain', confidence: 'high', evidence: current } }
    const summary = { _property_context: context, _pending_question: pending }
    const reference = resolvePropertyTurn(units, current, summary, [], semantics)
    assert.deepEqual(reference.matches.map(unit => unit.id), expectedIds)
    const info: Row = { catalogo: units, catalogo_verificacion: units, catalog_read: { complete: true },
      catalog_search: { embeddingsEnabled: enabled }, politica_comercial: { precios_autorizados: true },
      lead: { purchase_purpose: 'vivir', preferred_bedrooms: 5 }, financiamiento: { partners: ['Cooperativa JEP', 'Banco Pichincha'] },
      property_context: reference.context, referencia_unidad: reference, semantica_turno: semantics,
      recorrido_comercial: {}, contrato_turno: { objective: 'ask_price', current_message: current, required_facts: ['price'],
        requests: [{ domain: 'property', request: current, evidence: current, confidence: 'high' }], pending_question: pending } }
    const retrieval = await retrieveCatalogByEmbeddings(info, current, {
      embed: async () => { assert.fail('An exact price query needs no embedding call') },
      match: async () => { assert.fail('An exact price query needs no index call') },
    })
    assert.equal(retrieval.audit.optimized, true)
    assert.equal(retrieval.audit.embedding_requested, false)
    assert.equal(object(retrieval.audit.catalog_summary).matching_count, expectedIds.length)
    const base = await commercialReply(info, current, summary, async () => {})
    assert.equal(base.audit.source, 'unit_price')
    assert.deepEqual(object(base.audit.unit_reference).numbers, expectedNumbers)
    const calls: { task: string; data: Row }[] = []
    const reply = (literal ? 'El departamento 302 tiene 3 dormitorios y un precio de referencia de $300.000.'
      : 'Los departamentos de 3 dormitorios tienen un precio de referencia de $300.000 y los penthouses de 3 dormitorios, de $550.000.')
      + ' Con esos valores como referencia, ¿le interesa revisar estas alternativas de 3 dormitorios?'
    const result = await withResponseReviewPolicy(responseReviewSettings({ response_review: { enabled: reviewed } }),
      () => completeTurnReply({ current, baseReply: base.reply, verified: info,
      audit: { ...base.audit, semantic_review_enabled: true, business_risk_review_enabled: true } },
      async (_rules, data, _schema, _image, _file, _tone, task) => {
        calls.push({ task: String(task), data: object(data) })
        if (task === 'writing') return { reply,
          requests: [{ fragment: 'R1', intent: 'ask_price', request_type: 'specific_fact', status: 'answered', evidence: reply, fact_key: 'price' }],
          question: { purpose: 'permission_to_continue', role: 'optional_continuation', missing_datum: '', next_decision: 'Aceptar explorar la propuesta' } }
        return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
      }))
    assert.equal(result.needsAdvisor, false)
    assert.equal(result.reply, reply)
    assert.deepEqual(calls.map(call => call.task), reviewed ? ['writing', 'review'] : ['writing'])
    const writer = calls[0].data
    const plan = object(object(writer.contexto_verificado).siguiente_paso_comercial)
    assert.equal(plan.question_id, 'property_requirements')
    assert.equal(plan.financing_offer_allowed, false)
    assert.deepEqual((object(writer.evidencia_turno).units as Row[]).map(unit => unit.unit_number).sort(), expectedNumbers)
    if (reviewed) {
      const reviewSources = object(calls[1].data.fuentes_autorizadas)
      assert.equal(object(reviewSources.siguiente_paso_comercial).question_id, plan.question_id)
      assert.deepEqual((reviewSources.unidades as Row[]).map(unit => unit.unit_number).sort(), expectedNumbers)
    }
    const remembered = rememberPropertyReply(units, reference.context, result.reply,
      { ...base.audit, pending_question: journeyPendingQuestion(result.reply, object(result.audit.commercial_journey), true) })
    assert.equal(object(object(remembered.query).filters).bedrooms, 5)
    assert.equal(object(remembered.pending_question).id, 'property_requirements')
    assert.deepEqual(object(remembered.pending_question).candidate_ids, ['d302', 'p602'])
    assert.deepEqual(remembered.selected_ids, [])
  }
})
