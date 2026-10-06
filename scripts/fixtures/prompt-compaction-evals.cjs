/* eslint-disable @typescript-eslint/no-require-imports */
// Synthetic examples; these values are never published as project policy.
const units = [
  { id: 'eval-d302', unit_number: '302', category: 'departamento', bedrooms: 3, floor_number: 3,
    area_internal_m2: 120.83, area_exterior_m2: 27.03, published_commercial_price: 300000 },
  { id: 'eval-p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6,
    area_internal_m2: 142.09, area_exterior_m2: 25.3, published_commercial_price: 550000 },
].map(u => ({ ...u, status: 'disponible', is_published: true }))
const pending = { id: 'property_requirements', act: 'explore_alternatives', candidate_ids: units.map(u => u.id),
  question: '¿Le interesa revisar estas alternativas de 3 dormitorios?',
  proposed_query: { group: 'residential', category: null, operation: 'search', scope: 'catalog', filters: { bedrooms: 3 } } }
const history = [{ role: 'user', content: 'Busco una vivienda de unos 5 cuartos.' },
  { role: 'assistant', content: 'No tenemos viviendas de 5 dormitorios. Podemos revisar departamentos y penthouses de 3 dormitorios. ¿Le interesa revisar esas alternativas?' }]
const proposal = { pregunta_pendiente: pending, contexto_propiedades: { query: { filters: { bedrooms: 5 } },
  pending_question: pending, offered_ids: units.map(u => u.id), selected_ids: [] }, historial_reciente: history }
const sem = r => r.turn_semantics || {}
const property = r => sem(r).property || {}
const noAction = r => !r.requested_advisor && !r.opt_out && !r.visit_intent?.kind?.startsWith('request_') && sem(r).reservation?.kind !== 'request'
const extractor = [
  { id: 'price-of-proposal', message: 'oh pero que precios tienen??', input: proposal,
    check: r => sem(r).primary_intent === 'ask_price' && property(r).reference_kind === 'followup' && property(r).operation !== 'select' && noAction(r) },
  { id: 'size-of-proposal', message: 'y cuanto miden esas opciones?', input: proposal,
    check: r => property(r).reference_kind === 'followup' && property(r).operation !== 'select' && noAction(r) },
  { id: 'accept-alternatives', message: 'si, revisemos las opciones de tres', input: proposal,
    check: r => sem(r).answer_to_previous?.kind === 'affirmative' && property(r).operation !== 'select' },
  { id: 'reject-alternatives', message: 'no gracias, necesito cinco dormitorios obligatoriamente', input: proposal,
    check: r => sem(r).answer_to_previous?.kind === 'negative' && property(r).filters?.bedrooms === 5 },
  { id: 'explicit-new-topic', message: 'mejor quiero informacion general del proyecto, no de esas unidades', input: proposal,
    check: r => sem(r).primary_intent === 'project_information' && property(r).operation === 'none' },
  { id: 'people-not-bedrooms', message: 'somos cinco sin contar conmigo, busco tres cuartos',
    check: r => property(r).filters?.bedrooms === 3 && sem(r).housing_quantities?.some(q => q.dimension === 'people' && q.count_basis === 'excluding_speaker') },
  { id: 'minimum-bedroom-count', message: 'busco al menos dos dormitorios',
    check: r => property(r).filters?.bedrooms === 2 && property(r).filters?.bedrooms_operator === 'gte' },
  { id: 'tentative-budget', message: 'no estoy seguro, pero estoy estimando unos 400 mil para esta compra',
    input: { pregunta_pendiente: { id: 'budget_amount', act: 'collect_budget' } },
    check: r => sem(r).budget?.amount === 400000 && !r.requested_advisor },
  { id: 'jep-choice', message: 'prefiero jep', input: { pregunta_pendiente: { id: 'financing_partner', act: 'choose_partner' },
    financiamiento: { partners: ['Cooperativa JEP', 'Banco Pichincha'], consent: true } },
    check: r => /jep/i.test(r.financing_partner || '') && sem(r).answer_to_previous?.question_id === 'financing_partner' },
  { id: 'pichincha-choice', message: 'con Banco Pichincha por favor', input: { pregunta_pendiente: { id: 'financing_partner', act: 'choose_partner' },
    financiamiento: { partners: ['Cooperativa JEP', 'Banco Pichincha'], consent: true } },
    check: r => /pichincha/i.test(r.financing_partner || '') && sem(r).answer_to_previous?.question_id === 'financing_partner' },
  { id: 'partial-identity', message: 'me llamo Carlos, mi cedula es 0109876543',
    input: { pregunta_pendiente: { id: 'financing_data', act: 'collect_financing_data' } },
    check: r => r.full_name === 'Carlos' && r.national_id === '0109876543' && !r.requested_advisor && !r.applicant_type },
  { id: 'compound-information', message: 'que precios tienen esas opciones y cuanto pide JEP de entrada?', input: proposal,
    check: r => r.requests?.some(q => q.domain === 'property') && r.requests?.some(q => q.domain === 'financing') && !r.requested_advisor },
  { id: 'negated-visit', message: 'no quiero una visita todavia, solo conocer los precios de esas opciones', input: proposal,
    check: r => r.visit_intent?.kind !== 'request_visit' && property(r).operation !== 'select' && !r.requested_advisor },
  { id: 'explicit-advisor', message: 'prefiero que me atienda un asesor', check: r => r.requested_advisor === true },
  { id: 'opt-out', message: 'no me envien mas mensajes por favor', check: r => r.opt_out === true },
  { id: 'typo-information', message: 'ola, me puede dar infomacion del proyecto?',
    check: r => sem(r).primary_intent === 'project_information' && !r.requested_advisor },
]
const oldWriters = require('./review-contract-evals.cjs')
const writerIds = ['greeting-1753', 'greeting-paraphrase', 'exact-price-floor', 'family-guidance', 'personal-acknowledgement']
const normalized = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const writer = writerIds.map(id => {
  const f = oldWriters.find(c => c.id === id)
  return { ...f, check: r => {
    const reply = normalized(r.reply)
    if (id.startsWith('greeting')) return /nombre|llama/.test(reply) && /resid|vive/.test(reply) && reply.includes('?')
    if (id === 'exact-price-floor') return /550[.,]?000/.test(reply) && /penthouse/.test(reply)
    if (id === 'family-guidance') return !/garantiz|perfecto para/.test(reply) && /distrib|dormitorio|familia/.test(reply)
    return reply.includes('carlos') && !/he (?:reservado|agendado|asignado)/.test(reply)
  } }
})
// Exercise the current proposal pipeline, including its pending consent and
// factual area ranges, rather than testing only fixed legacy draft examples.
async function prepareProposal(message, price) {
  const { commercialJourneyPlan, journeyPendingQuestion } = require('../../src/lib/integrations/automation/commercial-journey.ts')
  const { normalizedPendingQuestion } = require('../../src/lib/integrations/automation/turn-semantics.ts')
  const { rememberPropertyReply, resolvePropertyTurn } = require('../../src/lib/integrations/automation/property-context.ts')
  const { retrieveCatalogByEmbeddings } = require('../../src/lib/integrations/automation/catalog-embeddings.ts')
  const { commercialReply } = require('../../src/lib/integrations/automation/sdr.ts')
  const requirement = { field: 'bedrooms', operator: 'eq', value: 5, strength: 'required', evidence: 'unos 5 cuartos' }
  let info = { catalogo: units, catalogo_verificacion: units, catalog_read: { complete: true },
    catalog_search: { embeddingsEnabled: false }, politica_comercial: { precios_autorizados: true },
    lead: { purchase_purpose: 'vivir', preferred_bedrooms: 5 }, recorrido_comercial: {},
    property_context: { query: { group: 'residential', category: null, operation: 'search', scope: 'catalog', filters: { bedrooms: 5 }, requirements: [requirement] },
      optimized_catalog_request: { group: 'residential', category: null, requirements: [requirement] } },
    semantica_turno: { confidence: 'high', budget: { status: 'not_discussed' } } }
  const plan = commercialJourneyPlan(info)
  const proposalPending = normalizedPendingQuestion(journeyPendingQuestion(String(plan.question), plan, true), units)
  const context = rememberPropertyReply(units, info.property_context, String(plan.question), { pending_question: proposalPending, original_query: plan.requested_query })
  const currentSemantics = price ? { primary_intent: 'ask_price', confidence: 'high',
    property: { group: 'residential', category: null, operation: 'search', query_scope: 'catalog', reference_kind: 'none', unit_numbers: [],
      confidence: 'high', evidence: message, filters: {} },
    catalog_request: { version: 'catalog-request-v1', purpose: 'range', metric: 'published_commercial_price', requirements: [], semantic_preferences: [], confidence: 'high', evidence: message },
    catalog_request_status: 'validated', budget: { status: 'not_discussed' } }
    : { primary_intent: 'answer_previous', confidence: 'high', property: { operation: 'search', group: 'residential', reference_kind: 'none',
      query_scope: 'catalog', filters: { bedrooms: 5 }, evidence: message, confidence: 'high' }, budget: { status: 'not_discussed' } }
  const summary = price ? { _property_context: context, _pending_question: proposalPending } : {}
  const reference = resolvePropertyTurn(units, message, summary, [], currentSemantics)
  info = { ...info, property_context: price ? reference.context : info.property_context, referencia_unidad: reference,
    semantica_turno: currentSemantics, financiamiento: { partners: ['Cooperativa JEP', 'Banco Pichincha'] },
    contrato_turno: { objective: price ? 'ask_price' : 'property_information', current_message: message,
      required_facts: price ? ['price'] : [], requests: [{ domain: 'property', request: message, evidence: message, confidence: 'high' }],
      ...(price ? { pending_question: proposalPending } : {}) } }
  await retrieveCatalogByEmbeddings(info, message, { embed: async () => { throw Error('NO_EMBEDDING_EXPECTED') }, match: async () => { throw Error('NO_INDEX_EXPECTED') } })
  const base = await commercialReply(info, message, summary, async () => {})
  return { current: message, baseReply: base.reply, verified: info,
    audit: { ...base.audit, semantic_review_enabled: true, business_risk_review_enabled: true } }
}
writer.push(
  { id: 'writer-recommend-alternative', prepare: () => prepareProposal('busco algo de cinco dormitorios para vivienda', false),
    check: r => { const reply = normalized(r.reply); return /no (?:tenemos|hay|dispon|contamos)|no.*cinco|no.*5/.test(reply)
      && /3|tres/.test(reply) && /departamento/.test(reply) && /penthouse/.test(reply) && /120[.,]83/.test(reply)
      && /142[.,]09/.test(reply) && reply.includes('?') && !/presupuesto|financiamiento/.test(reply) } },
  { id: 'writer-price-of-proposal', prepare: () => prepareProposal('oh pero que precios tienen??', true),
    check: r => { const reply = normalized(r.reply); return /300[.,]?000/.test(reply) && /550[.,]?000/.test(reply)
      && /departamento/.test(reply) && /penthouse/.test(reply) && reply.includes('?') && !/suite|presupuesto/.test(reply) } },
)
module.exports = { extractor, writer, units }
