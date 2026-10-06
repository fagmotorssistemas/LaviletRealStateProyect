import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commercialJourneyPlan, journeyPendingQuestion } from './commercial-journey'
import { object, type Row } from './data'
import { resolvePropertyTurn, rememberPropertyReply } from './property-context'
import { normalizedPendingQuestion, normalizeTurnSemantics } from './turn-semantics'
import { resolvedCatalogQuery } from './resolved-catalog-query'
import { completeCatalogResult } from './catalog-result'
import { retrieveCatalogByEmbeddings } from './catalog-embeddings'
import { interpretationInput } from './turn-interpretation-input'
import { unitPriceQuote } from './price-reply'

const catalog: Row[] = [
  { id: 'd302', unit_number: '302', category: 'departamento', bedrooms: 3, floor_number: 3, area_internal_m2: 120.83, published_commercial_price: 270000 },
  { id: 'd502', unit_number: '502', category: 'departamento', bedrooms: 3, floor_number: 5, area_internal_m2: 120.83, published_commercial_price: 310000 },
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6, area_internal_m2: 142.09, published_commercial_price: 550000 },
  { id: 'p605', unit_number: '605', category: 'penthouse', bedrooms: 3, floor_number: 6, area_internal_m2: 140.53, published_commercial_price: 539900 },
  { id: 'd304', unit_number: '304', category: 'departamento', bedrooms: 2, floor_number: 3, area_internal_m2: 109.69, published_commercial_price: 200000 },
]
const five = { field: 'bedrooms', operator: 'eq', value: 5, strength: 'required', evidence: 'cinco dormitorios' }
const proposalIds = ['d302', 'd502', 'p602', 'p605']
function offered(category: string | null = null): { context: Row; pending: Row } {
  const input = { catalogo: catalog, catalog_read: { complete: true }, lead: { purchase_purpose: 'vivir', preferred_bedrooms: 5 },
    property_context: { query: { group: 'residential', category, scope: 'catalog', operation: 'search', filters: { bedrooms: 5 }, requirements: [five] },
      optimized_catalog_request: { group: 'residential', category, requirements: [five] } },
    financiamiento: { partners: [] } }
  const plan = commercialJourneyPlan(input)
  const reply = `Como alternativa, podemos revisar departamentos y penthouses de tres dormitorios. ${String(plan.question)}`
  const pending = normalizedPendingQuestion(journeyPendingQuestion(reply, plan, true), catalog)
  return { pending, context: rememberPropertyReply(catalog, input.property_context, reply,
    { pending_question: pending, original_query: plan.requested_query }) }
}
function semantics(current: string, pending: Row, purpose = 'range', metric: string | null = 'published_commercial_price', property: Row = {}): Row {
  const normalized = normalizeTurnSemantics({ turn_semantics: { primary_intent: metric === 'published_commercial_price' ? 'ask_price' : 'project_information',
    primary_evidence: current, confidence: 'high', property: { operation: 'search', reference_kind: 'none', query_scope: 'catalog',
      evidence: current, confidence: 'high', ...property },
    answer_to_previous: { question_id: pending.id, kind: 'other', evidence: current, confidence: 'high' } } }, current, pending)
  return { ...normalized, catalog_request: { version: 'catalog-request-v1', purpose, metric, requirements: [],
    semantic_preferences: [], evidence: current, confidence: 'high' }, catalog_request_status: 'validated' }
}
function inputFor(resolved: ReturnType<typeof resolvePropertyTurn>, current: string, semantic: Row, extras: Row = {}): Row {
  return { catalogo: catalog, catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true, precios_aproximados: true },
    alcance_negocio: 'property', modo_comercial: 'lanzamiento', lead: { purchase_purpose: 'vivir', preferred_bedrooms: 5 },
    property_context: resolved.context, referencia_unidad: resolved, semantica_turno: semantic,
    solicitudes_interpretadas: [{ domain: 'property', confidence: 'high', evidence: current, request: current }],
    contrato_turno: { objective: object(semantic).primary_intent, required_facts: ['price'] }, ...extras }
}

test('price follow-ups resolve the proposed subject despite a search/catalog extraction and both review/vector settings', async () => {
  for (const current of ['oh pero que precios tienen??', '¿Cuáles son sus valores?', '¿En cuánto están esas alternativas?']) {
    for (const embeddingsEnabled of [false, true]) for (const semantic_review_enabled of [false, true]) {
      const { context, pending } = offered(), before = structuredClone(context)
      const semantic = semantics(current, pending)
      const resolved = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], semantic)
      assert.equal(resolved.reason, 'pending_proposal_information')
      assert.deepEqual(resolved.matches.map(unit => unit.id), proposalIds)
      assert.equal(object(resolved.query.filters).bedrooms, 3)
      assert.equal(object(object(resolved.context.query).filters).bedrooms, 5)
      assert.deepEqual(resolved.context.pending_question, pending)
      assert.deepEqual(resolved.context.selected_ids, [])
      assert.deepEqual(context, before)
      const input = inputFor(resolved, current, semantic, { catalog_search: { embeddingsEnabled }, semantic_review_enabled })
      const query = resolvedCatalogQuery(input)
      assert.equal(query.source, 'pending_proposal')
      assert.deepEqual(query.scopedIds, proposalIds)
      assert.ok(!(query.request.requirements as Row[]).some(requirement => requirement.value === 5))
      const result = completeCatalogResult(input, query.query, query.request, query.scopedIds)
      assert.deepEqual(result.units.map(unit => unit.id), proposalIds)
      assert.equal(object(result.summary.statistics).published_commercial_price && object(object(result.summary.statistics).published_commercial_price).min, 270000)
      const retrieved = await retrieveCatalogByEmbeddings(input, current, {
        embed: async () => { assert.fail('An exact price query requires no remote embedding call') },
        match: async () => { assert.fail('An exact price query requires no remote index call') },
      })
      assert.equal(retrieved.audit.optimized, true)
      assert.equal(retrieved.audit.embedding_requested, false)
      assert.equal(retrieved.audit.matched_count, 4)
      const quote = unitPriceQuote(input, current, {})
      assert.equal(quote?.quoted, true)
      assert.deepEqual(quote?.units?.map(unit => unit.id), proposalIds)
      assert.match(quote?.reply || '', /270/)
      assert.match(quote?.reply || '', /550/)
    }
  }
})

test('sizes, counts, ranges and comparisons share a temporary proposal query, not acceptance', () => {
  for (const [purpose, metric] of [['range', 'area_internal_m2'], ['count', null], ['details', null], ['compare', null], ['max', 'area_internal_m2']] as const) {
    const current = 'Necesito conocer esas características antes de decidir', { context, pending } = offered()
    const semantic = semantics(current, pending, purpose, metric)
    const resolved = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], semantic)
    assert.equal(resolved.reason, 'pending_proposal_information')
    assert.equal(object(resolved.context.proposal_information).requested_operation, purpose)
    assert.deepEqual(resolved.matches.map(unit => unit.id), proposalIds)
    assert.equal(object(object(resolved.context.query).filters).bedrooms, 5)
    assert.equal(object(resolved.context.pending_question).act, 'explore_alternatives')
    const input = inputFor(resolved, current, semantic)
    const query = resolvedCatalogQuery(input), result = completeCatalogResult(input, query.query, query.request, query.scopedIds)
    assert.equal(result.summary.matching_count, 4)
    assert.equal(object(object(result.summary.statistics).area_internal_m2).min, 120.83)
    assert.equal(object(object(result.summary.statistics).area_internal_m2).max, 142.09)
  }
})

test('an informative category refinement retains the proposed set and does not treat naming a category as consent', () => {
  const current = '¿Qué características tienen los penthouses?', { context, pending } = offered()
  const semantic = semantics(current, pending, 'details', null, { category: 'penthouse', operation: 'details', reference_kind: 'followup', query_scope: 'offered' })
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], semantic)
  assert.deepEqual(resolved.matches.map(unit => unit.id), ['p602', 'p605'])
  assert.equal(object(object(resolved.context.query).filters).bedrooms, 5)
  assert.equal(object(resolved.context.pending_question).act, 'explore_alternatives')
  assert.deepEqual(resolved.context.selected_ids, [])
  const input = inputFor(resolved, current, semantic), query = resolvedCatalogQuery(input)
  assert.deepEqual(completeCatalogResult(input, query.query, query.request, query.scopedIds).units.map(unit => unit.id), ['p602', 'p605'])
})

test('a literal price or details question keeps exactly that proposed unit as the subject and preserves consent', () => {
  for (const category of [null, 'departamento']) for (const asksPrice of [false, true]) {
    const { context, pending } = offered(category)
    const current = asksPrice ? '¿Qué precio tiene el departamento 502?' : '¿Qué distribución tiene el departamento 502?'
    const semantic = semantics(current, pending, 'details', asksPrice ? 'published_commercial_price' : null,
      { category: 'departamento', operation: asksPrice ? 'search' : 'details', reference_kind: 'explicit', query_scope: 'catalog', unit_numbers: ['502'] })
    const resolved = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], semantic)
    assert.equal(resolved.reason, 'pending_proposal_information')
    assert.deepEqual(resolved.matches.map(unit => unit.id), ['d502'])
    assert.deepEqual(object(resolved.context.proposal_information).subject_ids, ['d502'])
    assert.deepEqual(object(resolved.context.proposal_information).candidate_ids, pending.candidate_ids)
    assert.equal(object(object(resolved.context.query).filters).bedrooms, 5)
    assert.deepEqual(resolved.context.pending_question, pending)
    assert.deepEqual(resolved.context.selected_ids, [])
    const input = inputFor(resolved, current, semantic), query = resolvedCatalogQuery(input)
    assert.deepEqual(query.scopedIds, ['d502'])
    assert.ok(!(query.request.requirements as Row[]).some(requirement => requirement.value === 5))
    assert.deepEqual(completeCatalogResult(input, query.query, query.request, query.scopedIds).units.map(unit => unit.id), ['d502'])
    if (asksPrice) {
      const quote = unitPriceQuote(input, current, {})
      assert.equal(quote?.quoted, true)
      assert.deepEqual(quote?.units?.map(unit => unit.id), ['d502'])
      assert.deepEqual(quote?.prices, [310000])
    }
    const plan = commercialJourneyPlan(input)
    assert.equal(plan.action, 'clarify_requirements')
    assert.equal(plan.question_id, 'property_requirements')
    const reply = `La unidad 502 tiene esa información verificada. ${String(plan.question)}`
    const afterPending = journeyPendingQuestion(reply, plan, true)
    const delivered = rememberPropertyReply(catalog, resolved.context, reply, {
      catalog_query: resolved.query, catalog_retrieval: { optimized: true }, catalog_summary: { request: { requirements: [] } },
      pending_question: afterPending, offered_unit_ids: ['d502'],
    })
    assert.equal(object(object(delivered.query).filters).bedrooms, 5)
    assert.deepEqual(object(delivered.pending_question).candidate_ids, pending.candidate_ids)
    assert.deepEqual(delivered.selected_ids, [])
    assert.deepEqual(object(delivered.optimized_catalog_request).requirements, [five])
  }
})

test('a withdrawn or unpriced literal proposed subject cannot expand to its other candidates', () => {
  const { context, pending } = offered(), current = '¿Qué precio tiene el departamento 502?'
  const semantic = semantics(current, pending, 'details', 'published_commercial_price',
    { category: 'departamento', operation: 'details', reference_kind: 'explicit', query_scope: 'offered', unit_numbers: ['502'] })
  const withdrawn = resolvePropertyTurn(catalog.map(unit => unit.id === 'd502' ? { ...unit, status: 'vendido' } : unit), current,
    { _property_context: context, _pending_question: pending }, [], semantic)
  assert.equal(withdrawn.needsClarification, true)
  assert.deepEqual(withdrawn.matches, [])
  assert.deepEqual(object(withdrawn.context.proposal_information).subject_ids, ['d502'])
  assert.deepEqual(object(withdrawn.context.proposal_information).missing_ids, ['d502'])
  assert.deepEqual(withdrawn.context.pending_question, pending)
  const unpriced = catalog.map(unit => unit.id === 'd502' ? { ...unit, published_commercial_price: null } : unit)
  const resolved = resolvePropertyTurn(unpriced, current, { _property_context: context, _pending_question: pending }, [], semantic)
  const input = inputFor(resolved, current, semantic, { catalogo: unpriced }), query = resolvedCatalogQuery(input)
  const result = completeCatalogResult(input, query.query, query.request, query.scopedIds)
  assert.deepEqual(result.units.map(unit => unit.id), ['d502'])
  assert.equal(object(object(result.summary.statistics).published_commercial_price).unknown_count, 1)
  assert.equal(unitPriceQuote(input, current, {})?.quoted, false)
})

test('an explicit choice accompanied by a price request remains a choice, rather than informational exploration', () => {
  const { context, pending } = offered(), current = 'Elijo el departamento 502, dígame su precio'
  const semantic = semantics(current, pending, 'range', 'published_commercial_price', {
    category: 'departamento', operation: 'select', reference_kind: 'explicit', query_scope: 'selected', unit_numbers: ['502'],
  })
  semantic.primary_intent = 'select_property'
  const selected = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], semantic)
  assert.equal(selected.reason, 'semantic_explicit')
  assert.equal(selected.query.operation, 'select')
  assert.deepEqual(selected.context.selected_ids, ['d502'])
  assert.deepEqual(selected.context.pending_question, {})
  assert.equal(selected.context.proposal_information, undefined)
})

test('new follow-up conditions refine the proposal while retaining its unrelated requirements', () => {
  const { context, pending } = offered(), current = '¿Cuánto cuestan las opciones de tercera planta?'
  object(pending.proposed_query).requirements = [{ field: 'area_internal_m2', operator: 'gte', value: 120, strength: 'required', evidence: 'mínimo 120 m2' }]
  const semantic = semantics(current, pending, 'range', 'published_commercial_price', {
    operation: 'details', reference_kind: 'followup', query_scope: 'offered', filters: { floor_number: 3 }, filter_evidence: { floor_number: 'tercera planta' },
  })
  object(semantic.catalog_request).requirements = [{ field: 'floor_number', operator: 'eq', value: 3, strength: 'required', evidence: 'tercera planta' }]
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], semantic)
  assert.deepEqual(resolved.matches.map(unit => unit.id), ['d302'])
  assert.ok((resolved.query.requirements as Row[]).some(requirement => requirement.field === 'area_internal_m2'))
  assert.ok((resolved.query.requirements as Row[]).some(requirement => requirement.field === 'floor_number'))
  assert.ok(!(resolved.query.requirements as Row[]).some(requirement => requirement.field === 'bedrooms' && requirement.value === 5))
})

test('delivery cannot persist a temporary query as acceptance, and a later yes can accept the same proposal', () => {
  const { context, pending } = offered(), current = '¿Y los precios?', semantic = semantics(current, pending)
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], semantic)
  const remembered = rememberPropertyReply(catalog, resolved.context, 'Los precios van desde $270.000. ¿Aceptaría revisar tres dormitorios?', {
    catalog_query: resolved.query, catalog_retrieval: { optimized: true }, catalog_summary: { request: { requirements: [] } },
    offered_unit_ids: proposalIds, pending_question: pending,
  })
  assert.equal(object(object(remembered.query).filters).bedrooms, 5)
  assert.deepEqual(object(remembered.optimized_catalog_request).requirements, [five])
  assert.deepEqual(remembered.pending_question, pending)
  const yes = 'Sí, revisemos esas alternativas'
  const accepted = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'answer_previous', primary_evidence: yes, confidence: 'high',
    property: { operation: 'details', reference_kind: 'followup', query_scope: 'offered', evidence: yes, confidence: 'high' },
    answer_to_previous: { question_id: pending.id, kind: 'affirmative', evidence: yes, confidence: 'high' } } }, yes, pending)
  const next = resolvePropertyTurn(catalog, yes, { _property_context: remembered, _pending_question: pending }, [], accepted)
  assert.equal(next.reason, 'accepted_alternative_query')
  assert.equal(object(next.query.filters).bedrooms, 3)
  assert.deepEqual(next.context.pending_question, {})
  assert.equal(next.context.proposal_information, undefined)
  assert.deepEqual(next.context.selected_ids, [])
})

test('withdrawn candidates and unknown attributes never become absence or a substitute proposal', () => {
  const { context, pending } = offered(), current = '¿Y sus medidas?', semantic = semantics(current, pending, 'range', 'area_internal_m2')
  const withdrawn = resolvePropertyTurn(catalog.filter(unit => unit.id !== 'p602'), current,
    { _property_context: context, _pending_question: pending }, [], semantic)
  assert.equal(withdrawn.needsClarification, true)
  assert.deepEqual(object(withdrawn.context.proposal_information).missing_ids, ['p602'])
  assert.deepEqual(withdrawn.context.pending_question, pending)
  assert.equal(object(object(withdrawn.context.query).filters).bedrooms, 5)
  const unknownCatalog = catalog.map(unit => unit.id === 'p602' ? { ...unit, area_internal_m2: null } : unit)
  const unknown = resolvePropertyTurn(unknownCatalog, current, { _property_context: context, _pending_question: pending }, [], semantic)
  const input = inputFor(unknown, current, semantic, { catalogo: unknownCatalog }), query = resolvedCatalogQuery(input)
  const result = completeCatalogResult(input, query.query, query.request, query.scopedIds)
  assert.equal(result.summary.matching_count, 4)
  assert.equal(object(object(result.summary.statistics).area_internal_m2).complete, false)
  assert.equal(object(object(result.summary.statistics).area_internal_m2).unknown_count, 1)
  assert.deepEqual(unknown.context.pending_question, pending)
})

test('ambiguous interpretation and a new explicit search are not silently rebound to the pending proposal', () => {
  const { context, pending } = offered()
  const uncertain = { ...semantics('¿Qué opciones?', pending), confidence: 'low' }
  const unresolved = resolvePropertyTurn(catalog, '¿Qué opciones?', { _property_context: context, _pending_question: pending }, [], uncertain)
  assert.equal(unresolved.context.proposal_information, undefined)
  const invalid = { ...semantics('¿Y los precios?', pending), catalog_request_status: 'invalid' }
  assert.equal(resolvePropertyTurn(catalog, '¿Y los precios?', { _property_context: context, _pending_question: pending }, [], invalid)
    .context.proposal_information, undefined)
  const current = 'Ahora busco dos dormitorios'
  const changed = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'select_property', primary_evidence: current, confidence: 'high',
    property: { operation: 'search', group: 'residential', reference_kind: 'none', query_scope: 'catalog',
      filters: { bedrooms: 2 }, filter_evidence: { bedrooms: 'dos dormitorios' }, evidence: current, confidence: 'high' } } }, current, pending)
  const next = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], changed)
  assert.equal(next.context.proposal_information, undefined)
  assert.deepEqual(next.context.pending_question, {})
  assert.deepEqual(next.matches.map(unit => unit.id), ['d304'])
})

test('the interpretation input exposes compact proposed identities separately from the original requirements', () => {
  const { context } = offered(), input = interpretationInput({ contexto_propiedades: context, catalogo_unidades: catalog }, '¿Y los precios?')
  const proposal = object(input.propuesta_pendiente)
  assert.equal(proposal.consent_status, 'pending')
  assert.equal(object(object(proposal.original_query).filters).bedrooms, 5)
  assert.equal(object(object(proposal.proposed_query).filters).bedrooms, 3)
  assert.deepEqual((proposal.candidate_units as Row[]).map(unit => unit.id), proposalIds)
  assert.ok((proposal.candidate_units as Row[]).every(unit => !Object.hasOwn(unit, 'published_commercial_price')))
})
