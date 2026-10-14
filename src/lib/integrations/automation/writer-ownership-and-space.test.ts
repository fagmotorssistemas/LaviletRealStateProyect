import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { type Row, object } from './data'
import { normalizeTurnSemantics, emptyPropertyFilters } from './turn-semantics'
import { rememberInterpretationFacts } from './interpretation-memory'
import { resolvePropertyTurn, rememberPropertyReply } from './property-context'
import { commercialJourneyPlan, commercialSelectionQuery } from './commercial-journey'
import { deliveredPendingQuestion } from './continuation-question'
import { resolvedCatalogQuery } from './resolved-catalog-query'
import { completeCatalogResult } from './catalog-result'
import { catalogDialogueReply } from './catalog-dialogue'
import { brochureDeliveryIntent, BROCHURE_URL } from './project-material'
import { replyLinkContract, includeRequiredBrochure } from './response-plan'
import { completeRequiredContinuation, continuationContentIssues, validContinuationMetadata } from './continuation-validation'
import { writerObjectiveContext } from './writer-objectives'
import { responseContentScope } from './response-content-scope'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { publishedBusinessPolicies, changeBusinessPolicy, businessPolicies } from '@/lib/inmobiliaria/businessPolicies'
import { reviewResponsibilities } from '@/components/inmobiliaria/automation/workflow/reviewResponsibilities'

const catalog: Row[] = [
  { id: 'd202', unit_number: '202', category: 'departamento', floor_number: 2, bedrooms: 3, bathrooms_full: 2, area_internal_m2: 120.83, published_commercial_price: 250000 },
  { id: 'd504', unit_number: '504', category: 'departamento', floor_number: 5, bedrooms: 2, bathrooms_full: 2, area_internal_m2: 109.69, published_commercial_price: 230000 },
  { id: 'p602', unit_number: '602', category: 'penthouse', floor_number: 6, bedrooms: 3, bathrooms_full: 2, area_internal_m2: 142.09, published_commercial_price: 550000 },
  { id: 'p605', unit_number: '605', category: 'penthouse', floor_number: 6, bedrooms: 3, bathrooms_full: 3, area_internal_m2: 140.53, published_commercial_price: 539900 },
  { id: 'p606', unit_number: '606', category: 'penthouse', floor_number: 6, bedrooms: 2, bathrooms_full: 2, area_internal_m2: 124.41, published_commercial_price: 400000 },
]
const prefs = (message: string) => ({ bedrooms: { kind: 'unrestricted', evidence: message, confidence: 'high' },
  priority: { kind: 'interior_space', evidence: message, confidence: 'high' } })
function semantic(message: string, property: Row = {}, extra: Row = {}, pending: Row = {}) {
  return normalizeTurnSemantics({ turn_semantics: { primary_intent: 'select_property', primary_evidence: message, confidence: 'high',
    property: { group: 'residential', operation: 'search', filters: emptyPropertyFilters(), confidence: 'high', evidence: message, ...property },
    answer_to_previous: { question_id: 'none', kind: 'none', evidence: '', confidence: 'high' }, ...extra } }, message, pending)
}
function info(reference: Row, summary: Row, semantics: Row): Row {
  return { catalogo: catalog, catalogo_verificacion: catalog, catalog_read: { complete: true },
    property_context: reference.context, referencia_unidad: reference, hechos_confirmados: summary._interpretation_memory,
    semantica_turno: semantics, solicitudes_interpretadas: [{ domain: 'property', confidence: 'high', evidence: semantics.primary_evidence, topics: ['property_options'] }],
    perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' }, lead: { purchase_purpose: 'vivir', preferred_bedrooms: 5 },
    politica_comercial: { precios_autorizados: true }, financiamiento: { partners: ['Banco Pichincha'], current: {},
      journey: { accepted: true, status: 'accepted' }, entry: { status: 'amount', amount: 60000, evidence: '60 mil como entrada', source_message_id: 'entry' } } }
}

test('space priority waives bedroom capture, category choice presents largest PH, unit facts do not become needs', () => {
  const summary: Row = { _interpretation_memory: { property: { group: 'residential', filters: { bedrooms: 5 }, confidence: 'high', evidence: 'cinco cuartos' } },
    _property_context: { query: { group: 'residential', filters: { bedrooms: 5 }, operation: 'search', scope: 'offered' }, offered_ids: [] },
    _pending_question: { id: 'property_bedrooms', act: 'confirm_bedrooms', question: '¿Cinco dormitorios?' } }
  const message = 'la cantidad de dormitorios no es importante, busco algo espacioso'
  let turn = semantic(message, { query_scope: 'offered' }, { selection_preferences: prefs(message),
    answer_to_previous: { question_id: 'property_bedrooms', kind: 'negative', evidence: message, confidence: 'high' } }, object(summary._pending_question))
  let reference = resolvePropertyTurn(catalog, message, summary, [], turn)
  assert.equal(reference.needsClarification, false)
  assert.equal(reference.query.scope, 'catalog')
  summary._interpretation_memory = rememberInterpretationFacts(summary, message, {}, turn)
  let verified = info(reference, summary, turn)
  let plan = commercialJourneyPlan(verified)
  assert.equal(plan.question_id, 'property_category')
  assert.deepEqual(object(plan.selection_scope).categories, ['departamento', 'penthouse'])
  assert.equal(commercialSelectionQuery(verified).filters.bedrooms, null)
  assert.equal(object(object(summary._interpretation_memory).property).filters && object(object(object(summary._interpretation_memory).property).filters).bedrooms, null)
  const reply = 'Podemos explorar departamentos o penthouses. ¿Cuál de los dos le gustaría conocer?'
  const pending = deliveredPendingQuestion(reply, { plan, metadata: { text: '¿Cuál de los dos le gustaría conocer?',
    purpose: 'choose_property', continuation_id: 'property_category', continuation_act: 'choose_category' } }, catalog)
  summary._property_context = rememberPropertyReply(catalog, reference.context, reply, { pending_question: pending })
  summary._pending_question = pending
  turn = semantic('penthouse', { category: 'penthouse', operation: 'select', query_scope: 'offered' }, {}, pending)
  reference = resolvePropertyTurn(catalog, 'penthouse', summary, [], turn)
  summary._interpretation_memory = rememberInterpretationFacts(summary, 'penthouse', {}, turn)
  verified = info(reference, summary, turn)
  plan = commercialJourneyPlan(verified)
  assert.equal(plan.question_id, 'unit_choice')
  assert.deepEqual(object(plan.selection_scope).unit_ids, ['p602', 'p605'])
  assert.equal(commercialSelectionQuery(verified).filters.bedrooms, null)
  assert.equal(object(object(summary._interpretation_memory).selection_preferences).bedrooms && object(object(object(summary._interpretation_memory).selection_preferences).bedrooms).kind, 'unrestricted')
})

test('minimum two replaces waiver, retains space priority and all query consumers find the same real options', () => {
  const summary: Row = { _interpretation_memory: { selection_preferences: prefs('quiero espacio') },
    _property_context: { query: { group: 'residential', operation: 'search', scope: 'offered', filters: {} }, offered_ids: [] } }
  const message = 'mínimo 2 dormitorios'
  const turn = semantic(message, { query_scope: 'offered', filters: { bedrooms: 2, bedrooms_operator: 'gte' },
    filter_evidence: { bedrooms: message, bedrooms_operator: message } }, { housing_quantities: [{ dimension: 'bedrooms', values: [2], role: 'requirement', count_basis: 'unspecified', confidence: 'high', evidence: message }] })
  const reference = resolvePropertyTurn(catalog, message, summary, [], turn)
  summary._interpretation_memory = rememberInterpretationFacts(summary, message, {}, turn)
  assert.equal(reference.query.scope, 'catalog')
  assert.equal(reference.matches.length, 5)
  const verified = info(reference, summary, turn)
  const resolved = resolvedCatalogQuery(verified)
  assert.equal(resolved.reason, 'eligible')
  assert.equal(completeCatalogResult(verified, resolved.query, resolved.request, resolved.scopedIds).units.length, 5)
  assert.ok(!catalogDialogueReply(verified, message)?.reply.includes('no hay'))
  assert.notEqual(commercialJourneyPlan(verified).action, 'discover_bedrooms')
  assert.equal(object(object(object(summary._interpretation_memory).selection_preferences).priority).kind, 'interior_space')
  assert.equal(commercialSelectionQuery(verified).filters.bedrooms_operator, 'gte')
})

test('invalid/currently absent preference evidence cannot waive needs or introduce a ranking', () => {
  const turn = semantic('hola', {}, { selection_preferences: prefs('prefiero amplitud') })
  assert.deepEqual(turn.selection_preferences, {})
})

test('a typed acceptance of space priority advances category choice without an empty alternative query or a bedroom count', () => {
  const summary: Row = { _interpretation_memory: { selection_preferences: prefs('quiero espacio') },
    _property_context: { selection_preferences: prefs('quiero espacio'), query: { group: 'residential', filters: {}, scope: 'catalog', operation: 'search' } } }
  const initialReference = { context: summary._property_context }
  const plan = commercialJourneyPlan(info(initialReference, summary, {}))
  const reply = '¿Le parece bien que prioricemos la amplitud interior?'
  const pending = deliveredPendingQuestion(reply, { plan, metadata: { text: reply, purpose: 'choose_property',
    continuation_id: 'property_priority', continuation_act: 'confirm_priority' } }, catalog)
  assert.equal(pending.id, 'property_priority')
  assert.ok((pending.candidate_ids as string[]).length > 0)
  summary._pending_question = pending
  const turn = semantic('sí me parece bien', { operation: 'none' }, { primary_intent: 'answer_previous',
    answer_to_previous: { question_id: 'property_priority', kind: 'affirmative', confidence: 'high', evidence: 'sí me parece bien' } }, pending)
  const reference = resolvePropertyTurn(catalog, 'sí me parece bien', summary, [], turn)
  assert.equal(reference.reason, 'accepted_selection_priority')
  assert.equal(reference.needsClarification, false)
  assert.equal(commercialJourneyPlan(info(reference, summary, turn)).question_id, 'property_category')
  assert.equal(object(reference.query.filters).bedrooms, null)
})

test('a lost relative ranking set remains unresolved instead of claiming no stock or silently ranking the project', () => {
  const message = 'cuál de estas es la más amplia'
  const turn = semantic(message, { operation: 'rank', query_scope: 'offered', reference_kind: 'relative', selector: 'largest' })
  const reference = resolvePropertyTurn(catalog, message, { _property_context: { offered_ids: [], query: { group: 'residential', scope: 'offered' } } }, [], turn)
  assert.equal(reference.needsClarification, true)
  assert.deepEqual(reference.matches, [])
  assert.notEqual(reference.reason, 'catalog_no_match')
})

test('mentioning received brochure and common-area fees is not resend or a purchase-price request', () => {
  const current = 'Estoy viendo en el brochure esos espacios, ¿pago más para acceder?'
  const material = { kind: 'none', evidence: '', confidence: 'high' }
  assert.equal(brochureDeliveryIntent(current, [], { material_request: material }).requested, false)
  const contract = replyLinkContract('', { profile_introduction: { brochure_previously_sent: true } }, { current,
    verified: { material_request: material, brochure_url: BROCHURE_URL, estado_conversacion: { brochure_sent: true } } })
  assert.deepEqual(contract.required_links, [])
  assert.ok(!contract.allowed_links.includes(BROCHURE_URL))
  const request = { domain: 'property', topics: ['common_area_access'], evidence: current, request: current, confidence: 'high' }
  const scope = responseContentScope(current, { semantica_turno: { primary_intent: 'project_information', confidence: 'high' }, solicitudes_interpretadas: [request] })
  assert.equal(object(object(scope.topics).purchase_prices).allowed, false)
})

test('question wording is owned by AI metadata, not lexical recognition; code never appends missing copy', () => {
  const plan = { action: 'offer_financing', question_id: 'financing_invitation', question: '¿Le gustaría continuar con el financiamiento?' }
  assert.deepEqual(continuationContentIssues(plan.question, plan), [])
  assert.deepEqual(continuationContentIssues('¿Revisamos juntos las alternativas para financiarla?', plan), [])
  assert.equal(validContinuationMetadata({ continuation_id: 'financing_invitation', continuation_act: 'financing', purpose: 'permission_to_continue' }, '¿Revisamos juntos las alternativas para financiarla?', plan), true)
  assert.deepEqual(completeRequiredContinuation('Con gusto le orientamos.', plan), { reply: 'Con gusto le orientamos.', audit: null })
  assert.equal(includeRequiredBrochure('Con gusto.', { profile_introduction: { brochure_required: true } }), 'Con gusto.')
  const projected = writerObjectiveContext({ contexto_verificado: { siguiente_paso_comercial: plan, pregunta_pendiente: { id: 'property_bedrooms', question: '¿Cuántos dormitorios necesita?' } }, historial_reciente: [{ role: 'bot', content: '¿Cuántos dormitorios necesita?' }] })
  assert.ok(!Object.hasOwn(object(object(projected.contexto_verificado).siguiente_paso_comercial), 'question'))
  assert.match(JSON.stringify(object(projected.contexto_verificado).pregunta_pendiente), /le gustaría/)
  assert.deepEqual(projected.historial_reciente, [{ role: 'bot', content: '¿Cuántos dormitorios necesita?' }])
})

test('successful writer draft remains unchanged in demonstration, disabled and live review', async () => {
  for (const control of [{ enabled: true, demoMode: true }, { enabled: false, demoMode: false }, { enabled: true, demoMode: false }]) {
    const draft = 'Saludos. Con gusto podemos revisar sus preferencias.'
    const generate = async (_instructions: unknown, _data: unknown, _schema: unknown, _a: unknown, _b: unknown, _c: unknown, task: unknown) => task === 'review'
      ? { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
      : { reply: draft, requests: [], question: { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' } }
    const result = await withResponseReviewPolicy({ enabled: control.enabled, observationOnly: control.demoMode, updatedAt: null },
      () => completeTurnReply({ current: 'Saludos', history: [], baseReply: 'Hola.', verified: { catalogo: [], politica_comercial: {} },
        audit: { writer_greeting: 'Hola', semantic_review_enabled: true, business_risk_review_enabled: true } }, generate))
    assert.equal(result.reply, draft, JSON.stringify(result.audit))
    assert.deepEqual(result.audit.text_transformations || [], [])
  }
})

test('UI distinguishes factual approval from historical system question mismatch', () => {
  const result = reviewResponsibilities({ semantic_review: { status: 'checked', acceptance: { content_approved: true } }, final_validation: { passed: false, issues: ['commercial_next_question_mismatch'] } })
  assert.equal(result.separateRejection, true)
  assert.match(result.reviewer, /aprobó/)
  assert.match(result.system, /commercial_next_question_mismatch/)
})

test('approved access policy migrates once, preserves other policies and is editable without claiming free maintenance', async t => {
  const db = new PGlite(); t.after(() => db.close())
  await db.exec('create table projects (id uuid primary key, tenant_id uuid, policies_json jsonb, updated_at timestamptz);')
  const project = 'b1b2c3d4-0001-4000-8000-000000000001', tenant = 'a1b2c3d4-0001-4000-8000-000000000001'
  await db.query('insert into projects values ($1,$2,$3,now())', [project, tenant, JSON.stringify({ unrelated: true, business_policies: { revision: 4, items: [{ id: 'other', draft: {}, published: null, history: [] }] } })])
  const sql = readFileSync('supabase/migrations/20261014160000_common_area_access_policy.sql', 'utf8')
  await db.exec(sql)
  const read = async () => object((await db.query<{ policies_json: Row }>('select policies_json from projects')).rows[0].policies_json)
  const policies = await read(), live = publishedBusinessPolicies(policies, 'lanzamiento')
  assert.equal(live.length, 1)
  assert.match(live[0].policy_content, /sin un cobro adicional/)
  assert.match(live[0].policy_content, /no define ni elimina una alícuota/)
  assert.equal(policies.unrelated, true)
  assert.equal(businessPolicies(policies).revision, 5)
  const edited = changeBusinessPolicy(policies, { action: 'publish', id: 'common-area-access', value: { ...businessPolicies(policies).items[1].draft, content: 'Acceso bajo la nueva política aprobada.' } }, 'admin', '2026-10-14T20:00:00Z')
  await db.query('update projects set policies_json=$1', [JSON.stringify(edited)])
  await db.exec(sql)
  assert.deepEqual(await read(), edited)
})
