import { informationOnly } from './interaction-mode'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { object, text, type Row } from './data'
import { projectIntroductionForTurn } from './project-introduction-context'
import { locationRequestKind } from './visit-location'
import { normalizedRequestTopics } from './request-topics'
import { asksUnitPrice } from './price-reply'
import { replyQuestions } from './reply-question'
import { budgetRecommendationPresentation } from './budget-presentation'
import { interpretedPriceComparison } from './category-price-comparison'
import { selectedTourPrice } from './selected-tour-price'
import { normalizedDiscountRequest } from './discount-request'

export const RESPONSE_CONTENT_SCOPE_VERSION = 'response-content-scope-v1'
export const RESPONSE_CONTENT_SCOPE_WRITER_RULE = 'Cumpla response_content_scope y obligaciones_del_turno; los datos disponibles no autorizan contenido ajeno al turno.'
export const RESPONSE_CONTENT_SCOPE_RULES = 'PERTINENCIA DEL CONTENIDO: response_content_scope distingue información que corresponde comunicar en ESTE turno de hechos disponibles para verificarla. allowed=true permite atender ese aspecto, pero no demuestra su veracidad ni obliga a enumerar su ficha. allowed=false impide introducir ese aspecto por costumbre, aunque sea verdadero o figure en el historial. Responda todas las solicitudes actuales y las pendientes todavía sin atender, conserve la pregunta comercial vigente y los permisos existentes. Una respuesta de categoría, dormitorios, planta, unidad o perfil no solicita precios ni una nueva presentación por sí sola. Excepción autorizada: selected_unit_tour_price permite comunicar el precio de la unidad efectivamente elegida al enviar su recorrido 360, según la obligación del turno; no abre el resto de precios del catálogo. current_discount_request permite responder las condiciones, porcentaje y aplicación del beneficio consultado con sus fuentes vigentes. Los precios consultados y las comparaciones indispensables del presupuesto conservan su exactitud y las condiciones comerciales verificadas. El aviso rutinario de precios referenciales y posibilidad de cambio se añade solo cuando politica_comercial.aviso_precios_referenciales no es false y precios_aproximados=true; apagarlo no impide responder consultas expresas de vigencia o cambios ni convierte el precio en fijo. Esa condición no obliga a narrar la etapa comercial ni el avance de obra. Una ubicación ya compartida no autoriza repetirla. Las restricciones físicas limitan promesas de acceso o representaciones digitales; cuando construction_status se permite solo por esa excepción, explique únicamente el límite pertinente, sin una ficha de obra. La falta de medidas solo corresponde a una consulta de cabida o accesibilidad: no añada una advertencia ni una oferta de asesoría a una selección ordinaria. El revisor comprueba tanto respaldo factual como pertinencia: un hecho verdadero fuera de este alcance incumple la obligación del turno, no es una preferencia de estilo. No elimine la respuesta válida ni cambie selecciones, consentimientos o el siguiente paso para corregir contenido adicional.' + "\nPRESENTACIÓN SEGÚN EL TURNO: cumpla response_content_scope.property_presentation. Si existe selected_unit_tour_price conserve el precio y el recorrido protegido de esa unidad, aunque la continuación sea breve. En progression_brief reconozca brevemente la aceptación o comunique el resultado operativo comprobado y continúe el paso vigente; no vuelva a describir la ficha, enviar el recorrido ni pedir una selección ya confirmada. En discovery_brief avance a presupuesto o dormitorios sin recitar áreas, plantas o fichas; esa decisión no autoriza repetir características históricas. En general_categories, si enumera tipos residenciales incluya las categorías disponibles verificadas, sin fichas ni medidas. En una recomendación por presupuesto puede limitarse a unidades compatibles sin añadir los tipos fuera del importe, pero no generalice el precio de una unidad a toda su categoría. relevant_details conserva las medidas a petición del lead o para una comparación pertinente. El revisor comprueba el propósito del contenido con el mismo contrato, sin exigir cifras omitidas que no se pidieron."

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const normalized = (value: string) => value.normalize('NFKC').toLowerCase()
const literal = (quote: unknown, source: string) => !!text(quote).trim()
  && normalized(source).includes(normalized(text(quote).trim()))
const requestIdentity = (request: Row) => JSON.stringify([request.request, request.evidence,
  text(request.source) || 'current', request.source === 'pending' ? request.source_message_id : null])
const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0
const topic = (allowed: boolean, reason: string): Row => ({ allowed, reason: allowed ? reason : 'not_requested_in_this_turn' })

/** The next discovery question does not require another catalogue recital.
 * A real feature/fit request or comparison keeps detailed evidence available. */
function propertyPresentation(verified: Row, audit: Row, requested: Set<string>, grounded: Row[], current: string): Row {
  const opening = object(object(audit.profile_introduction).presentation)
  const approvedOpening = projectIntroductionForTurn(verified)
    || (opening.required === true && text(opening.approved_summary) ? opening : null)
  if (approvedOpening) return { kind: 'approved_summary', dimensions_allowed: false, unit_features_allowed: false,
    available_residential_categories: [], instruction: 'Presente únicamente el resumen aprobado del proyecto y continúe con la pregunta de perfil prevista. No amplíe esta apertura con unidades, superficies, plantas, amenidades o cifras del catálogo.' }
  const semantics = object(verified.semantica_turno), context = object(verified.property_context)
  const query = object(object(context.information_query).query || context.query), journey = object(verified.siguiente_paso_comercial || audit.commercial_journey)
  const intent = object(audit.resolved_turn_intent || verified.contrato_turno)
  const answer = object(semantics.answer_to_previous), pending = object(verified.pregunta_pendiente || context.pending_question)
  const featuresRequested = ['property_features', 'spatial_fit', 'accessibility', 'visualization', 'value_objection']
    .some(name => requested.has(name))
  const comparisonRequested = grounded.some(request => request.domain === 'property')
    && (object(semantics.catalog_request).purpose === 'compare' || object(semantics.property).operation === 'compare')
  const legacyDetails = !grounded.some(request => Array.isArray(request.topics))
    && grounded.some(request => request.domain === 'property')
    && object(semantics.catalog_request).purpose === 'details' && object(semantics.property).operation === 'details'
  const detailsRequested = featuresRequested || comparisonRequested || legacyDetails
  const factualRequest = requested.size > 0 && [...requested].some(name => name !== 'property_options')
    || rows(intent.required_facts).length > 0
    || ['ask_price', 'ask_reservation', 'ask_financing', 'project_information'].includes(text(semantics.primary_intent))
  const typedProgression = grounded.every(request => Array.isArray(request.topics))
  const unitConfirmation = answer.kind === 'affirmative' && acceptedExtractorConfidence(answer.confidence)
    && literal(answer.evidence, current) && answer.question_id === 'unit_choice'
    && pending.id === 'unit_choice' && pending.act === 'confirm_unit'
  const reservationProgression = ['offer_reservation', 'await_reservation'].includes(text(journey.action))
    || journey.action === 'current_operation' && (Object.keys(object(audit.reservation)).length > 0
      || text(audit.source).startsWith('reservation_'))
  const progression = (unitConfirmation || reservationProgression) && !detailsRequested && !factualRequest && typedProgression
  const discovery = ['ask_budget', 'discover_bedrooms', 'ask_bedrooms'].includes(text(journey.action)) && !detailsRequested
  const informationalCategories = ['all_categories', 'other_categories'].includes(text(object(semantics.interaction_goal).catalog_scope))
  const broadCategories = informationalCategories || !discovery && !detailsRequested && audit.source === 'catalog_search'
    && semantics.primary_intent === 'project_information' && query.operation === 'search'
    && query.group === 'residential' && !query.category && !query.selector
    && (!query.scope || query.scope === 'catalog')
    && !['specific', 'followup', 'comparison'].includes(text(object(semantics.property).reference_kind))
    && !rows(object(semantics.catalog_request).requirements).length
    && !rows(object(semantics.catalog_request).semantic_preferences).length
    && !Object.values(object(query.filters)).some(value =>
      value != null && value !== '' && (!Array.isArray(value) || value.length > 0))
    && !rows(query.requirements).length && !rows(context.selected_ids).length
    && !text(object(journey.budget_guidance).status)
  const kind = progression ? 'progression_brief' : discovery ? 'discovery_brief' : broadCategories ? 'general_categories' : 'relevant_details'
  const catalog = rows(Array.isArray(verified.catalogo_verificacion) ? verified.catalogo_verificacion : verified.catalogo)
  const recommendation = budgetRecommendationPresentation(verified)
  const recommendationIds = new Set(Array.isArray(recommendation?.unit_ids) ? recommendation.unit_ids.map(text) : [])
  const excludedCategories = new Set(Array.isArray(object(context.information_query).excluded_categories)
    ? object(context.information_query).excluded_categories as string[] : [])
  const presentationCatalog = (recommendation ? catalog.filter(unit => recommendationIds.has(text(unit.id))) : catalog)
    .filter(unit => !excludedCategories.has(text(unit.category)))
  const categories = ['suite', 'departamento', 'penthouse'].filter(category => presentationCatalog.some(unit =>
    unit.category === category && unit.is_published !== false && (!unit.status || unit.status === 'disponible')))
  return { kind, dimensions_allowed: !progression && !discovery && !broadCategories,
    unit_features_allowed: !progression,
    available_residential_categories: categories,
    instruction: progression
      ? 'Reconozca la aceptación o comunique únicamente el resultado operativo comprobado y continúe el paso vigente. Conserve la unidad, el presupuesto y los permisos conocidos; no repita áreas, baños, planta, espacios o recorrido ni vuelva a preguntar qué unidad quiere.'
      : discovery
      ? 'Reconozca brevemente la respuesta y avance a la pregunta pendiente. No recite áreas, plantas o fichas; no hace falta enumerar categorías.'
      : broadCategories
        ? 'Si enumera la oferta residencial general, incluya las categorías disponibles verificadas, sin fichas ni medidas. No omita penthouses por el precio de otra unidad.'
        : 'Use solo las características útiles para la solicitud o comparación actual. No repita dimensiones ya entregadas sin un propósito en este turno. Las recomendaciones pueden centrarse en unidades que cumplen necesidades y presupuesto.' }
}

/** Sources and permissions are not cumulative disclosure instructions. This
 * pure projection reads only current evidence and genuine unanswered requests. */
export function responseContentScope(current: string, verified: Row = {}, audit: Row = {}): Row {
  const semantics = object(verified.semantica_turno), intent = object(audit.resolved_turn_intent || verified.contrato_turno)
  const shared = rows(intent.requests), interpreted = rows(verified.solicitudes_interpretadas || semantics.requests)
  const identities = new Set(shared.map(requestIdentity))
  const requests = [...shared, ...interpreted.filter(request => !identities.has(requestIdentity(request)))]
  const pending = rows(verified.consultas_pendientes).filter(message => message.answered !== true
    && !['answered', 'resolved', 'cancelled', 'superseded'].includes(text(message.status)))
  const grounded = requests.filter(request => {
    if (!acceptedExtractorConfidence(request.confidence) || request.domain === 'courtesy') return false
    if (request.source !== 'pending') return literal(request.evidence, current)
    return pending.some(message => (!request.source_message_id
      || request.source_message_id === (message.message_id || message.id)) && literal(request.evidence, text(message.content)))
  })
  const typed = grounded.filter(request => Array.isArray(request.topics))
  const hasTypedTopics = typed.length > 0
  const requested = new Set(typed.flatMap(request => normalizedRequestTopics(request.topics) || []))
  const currentGrounded = grounded.filter(request => request.source !== 'pending')
  const currentTyped = typed.filter(request => request.source !== 'pending')
  const currentTopics = new Set(currentTyped.flatMap(request => normalizedRequestTopics(request.topics) || []))
  const hasCurrentTypedTopics = currentTyped.length > 0
  const extractorIntent = text(object(semantics.interpretation).extractor_primary_intent
    || object(intent.interpretation).extractor_primary_intent || semantics.primary_intent)
  const legacyCanonicalPrice = !hasCurrentTypedTopics && intent.objective === 'ask_price'
    && intent.price_request_status !== 'answered' && (!extractorIntent || extractorIntent === 'ask_price')
    && currentGrounded.some(request => request.domain === 'property'
      && asksUnitPrice(text(request.request) || text(request.evidence), true))
  const legacyVerifiedQuote = !hasCurrentTypedTopics && intent.price_request_status !== 'answered'
    && audit.source === 'unit_price' && audit.verified_price_only === true
    && !(acceptedExtractorConfidence(semantics.confidence) && extractorIntent && extractorIntent !== 'ask_price')
    && asksUnitPrice(current, true)
  const legacyPrice = legacyCanonicalPrice || legacyVerifiedQuote || !hasCurrentTypedTopics && acceptedExtractorConfidence(semantics.confidence) && extractorIntent === 'ask_price'
    && (literal(semantics.primary_evidence, current)
      || currentGrounded.some(request => request.domain === 'property'))
  const pendingPriceClarification = intent.price_request_status === 'pending'
    && intent.interpretation_source === 'clarification_of_price_request'
  const currentBudget = object(semantics.budget || intent.budget)
  const declaredTotalBudget = acceptedExtractorConfidence(currentBudget.confidence) && ['amount', 'maximum_total'].includes(text(currentBudget.status))
    && positive(currentBudget.amount) && literal(currentBudget.evidence, current)
  const assessment = object(verified.presupuesto_del_turno)
  const currentAssessment = positive(assessment.amount) && literal(assessment.evidence, current)
    && ['matching_options', 'below_available_prices', 'incomplete_prices'].includes(text(assessment.status))
    && (assessment.budget_source === 'current_lead_statement' || declaredTotalBudget)
  const knownPrices = rows(verified.catalogo).some(unit => positive(unit.published_commercial_price))
    || rows(assessment.prices).some(unit => positive(unit.published_commercial_price)) || positive(assessment.minimum_price)
  const journey = object(verified.siguiente_paso_comercial || audit.commercial_journey)
  const guidance = object(journey.budget_guidance)
  // A resolved guidance contract can say that prices are unnecessary even
  // when a new budget amount appears. Keep legacy callers without that plan.
  const budgetComparison = !informationOnly(verified) && !text(guidance.status) && (declaredTotalBudget || currentAssessment) && knownPrices
  const comparisonPrices = rows(guidance.prices)
  const candidateIds = new Set(Array.isArray(guidance.candidate_unit_ids) ? guidance.candidate_unit_ids.map(text).filter(Boolean) : [])
  const pricedIds = new Set(comparisonPrices.map(price => text(price.unit_id)).filter(Boolean))
  // The planner compares the current relevant scope and records it only after
  // delivery. A remembered amount or insufficiency alone cannot reopen prices.
  const changedBudgetScopeComparison = !informationOnly(verified) && guidance.comparison_required === true && guidance.complete === true
    && guidance.status === 'below_available_prices' && guidance.coverage === 'none' && positive(guidance.amount)
    && object(verified.politica_comercial).precios_autorizados === true
    && candidateIds.size > 0 && pricedIds.size === candidateIds.size
    && [...candidateIds].every(id => pricedIds.has(id))
    && comparisonPrices.every(price => positive(price.published_commercial_price)
      && Number(price.published_commercial_price) > Number(guidance.amount))
  const approvedIntroduction = projectIntroductionForTurn(verified)
  const opening = object(object(audit.profile_introduction).presentation)
  const goal = object(semantics.interaction_goal)
  const topicNotChosen = informationOnly(verified) && goal.mode === 'information_only' && goal.specific_topic !== true
  const initialOverview = !topicNotChosen && (!!approvedIntroduction && currentGrounded.some(request => request.domain === 'property')
    && (!hasTypedTopics || currentTopics.has('project_overview'))
    || opening.required === true && !!text(opening.approved_summary).trim())
  const disclosure = object(verified.location_disclosure || audit.location_disclosure)
  const completed = object(audit.completed_visit_action)
  const result = object(audit.visit_result || verified.resultado_visita)
  const receipt = Object.keys(completed).length ? completed : result
  const confirmed = receipt.action === 'confirmed' && (Object.keys(completed).length > 0
    || audit.registration_verified === true || !!text(receipt.request_id))
  const modes = [receipt.channel, receipt.mode, receipt.meeting_type, object(receipt.slot).mode].map(text).map(normalized)
  const remote = modes.some(mode => ['virtual', 'videollamada', 'zoom', 'telefono', 'teléfono', 'remote', 'online', 'phone'].includes(mode))
  const inPersonConfirmation = confirmed && !remote
  const legacyLocationKind = hasCurrentTypedTopics ? null : locationRequestKind(current)
  const locationRequested = requested.has('location') || !!legacyLocationKind
  const explicitExactLocation = locationRequested && (disclosure.exact_location_allowed === true
    && disclosure.reason !== 'verified_in_person_confirmation' || ['request', 'clarification'].includes(legacyLocationKind || ''))
  const visitPlan = object(verified.visit_dialogue_plan || audit.visit_dialogue_plan)
  const physicalVisitException = visitPlan.version === 'visit-dialogue-plan-v1' && visitPlan.explain_restriction === true
    && ['coordination', 'preference', 'access_information', 'availability_information'].includes(text(visitPlan.current_kind))
  const digitalException = requested.has('visualization')
    || object(audit.unit_model).delivery_required === true || object(audit.brochure_intent).requested === true
  const legacyEvaluation = !hasCurrentTypedTopics && rows(semantics.housing_quantities).some(quantity => acceptedExtractorConfidence(quantity.confidence)
    && quantity.role === 'evaluation' && literal(quantity.evidence, current))
  return { version: RESPONSE_CONTENT_SCOPE_VERSION,
    property_presentation: propertyPresentation(verified, audit, requested, grounded, current), topics: {
    project_intro: topic(initialOverview, 'approved_initial_overview'),
    general_location: topic(initialOverview || locationRequested || inPersonConfirmation,
      initialOverview ? 'approved_initial_overview' : locationRequested ? 'location_request' : 'verified_in_person_confirmation'),
    exact_location: topic(explicitExactLocation || inPersonConfirmation,
      explicitExactLocation ? 'explicit_location_request' : 'verified_in_person_confirmation'),
    purchase_prices: topic(Boolean(normalizedDiscountRequest(semantics.discount_request, current)) || Boolean(selectedTourPrice(verified, audit)) || Boolean(interpretedPriceComparison(verified, current)) || requested.has('purchase_price') || legacyPrice || pendingPriceClarification || budgetComparison || changedBudgetScopeComparison,
      selectedTourPrice(verified, audit) ? 'selected_unit_tour_price' : normalizedDiscountRequest(semantics.discount_request, current) ? 'current_discount_request' : interpretedPriceComparison(verified, current) ? 'current_category_price_comparison' : requested.has('purchase_price') ? 'unanswered_price_request' : legacyPrice ? 'current_legacy_price_request'
        : pendingPriceClarification ? 'pending_price_reference_clarification' : changedBudgetScopeComparison ? 'changed_budget_scope_comparison' : 'current_budget_comparison'),
    commercial_stage: topic(requested.has('commercial_stage'), 'commercial_stage_request'),
    construction_status: topic(requested.has('construction_status') || physicalVisitException || digitalException,
      requested.has('construction_status') ? 'construction_status_request' : physicalVisitException ? 'current_visit_access_restriction' : 'digital_representation_scope'),
    delivery: topic(requested.has('delivery'), 'delivery_request'),
    spatial_caveat: topic(requested.has('spatial_fit') || requested.has('accessibility') || legacyEvaluation,
      requested.has('accessibility') ? 'accessibility_request' : requested.has('spatial_fit') ? 'spatial_fit_request' : 'current_housing_evaluation'),
  } }
}


const purchasePriceFields = new Set(['published_commercial_price', 'catalog_base_price', 'discount_reference_price',
  'discount_amount_reference', 'discounted_price_reference', 'minimum_price', 'maximum_price', 'min_price', 'max_price', 'price_min', 'price_max'])
const priceEvidenceKeys = new Set(['price_evidence', 'respuesta_precio_verificada', 'cotizacion_precio', 'purchase_price_quote'])
const quoteAmountFields = new Set(['catalog_price', 'base_price', 'discount_amount', 'final_price'])
const projectSourceKeys = new Set(['proyecto', 'project'])
const generalLocationKeys = new Set(['ubicacion_general', 'general_location'])
const projectLocationFields = new Set(['sector', 'neighborhood', 'city', 'ciudad', 'address', 'direccion', 'dirección',
  'street_address', 'exact_address', 'latitude', 'longitude', 'lat', 'lng', 'coordinates', 'coordenadas'])
const mapSourceKeys = new Set(['ubicacion', 'ubicación', 'map_url', 'maps_url', 'location_url', 'visit_location_url'])
const exactLocationFields = new Set(['address', 'direccion', 'dirección', 'street_address', 'exact_address',
  'latitude', 'longitude', 'lat', 'lng', 'coordinates', 'coordenadas'])
const interpretationKeys = new Set(['historial', 'history', 'historial_reciente', 'mensaje_actual', 'current_message',
  'solicitudes_interpretadas', 'consultas_pendientes', 'referencias_solicitud', 'semantica_turno', 'hechos_confirmados', 'perfil_lead', 'lead',
  'response_content_scope', 'alcance_contenido_turno'])
const catalogRecordKeys = new Set(['catalogo', 'catalogo_verificacion', 'units', 'groups', 'unidades', 'grupos',
  'hechos_disponibles', 'hechos_protegidos', 'protected_facts', 'statistics', 'matches', 'unit_model'])
const numericFactKeys = new Set(['project_facts', 'hechos_con_cantidades', 'factual_values', 'project_values'])
const dimensionFields = new Set(['area_internal_m2', 'area_exterior_m2', 'area_total_m2'])
const unitFeatureFields = new Set(['bedrooms', 'bathrooms_full', 'bathrooms_half', 'bathrooms', 'floor_number', 'floor',
  'spaces', 'shared_spaces', 'description', 'features', 'layout', 'amenities', 'tour_url', 'model_url', 'virtual_tour_url'])
const historyKeys = new Set(['historial', 'history', 'historial_reciente'])

/** Select writer evidence, not private data or outgoing text. Reviewers and
 * internal calculations must continue using their original verified snapshot.
 * In particular, declared budgets, fees and operational financing amounts are
 * preserved; this never removes an amount merely because its currency is USD. */
export function projectContentForWriter(raw: Row, scope?: Row): Row {
  const activeScope = scope || object(raw.response_content_scope || object(raw.contrato_redaccion).response_content_scope)
  if (activeScope.version !== RESPONSE_CONTENT_SCOPE_VERSION) return { ...raw }
  const topics = object(activeScope.topics)
  const prices = object(topics.purchase_prices).allowed === true
  const generalLocation = object(topics.general_location).allowed === true
  const exactLocation = object(topics.exact_location).allowed === true
  const introduction = object(topics.project_intro).allowed === true
  const dimensions = object(activeScope.property_presentation).dimensions_allowed !== false
  const features = object(activeScope.property_presentation).unit_features_allowed !== false
  const progression = object(activeScope.property_presentation).kind === 'progression_brief'
  const approvedOpening = object(activeScope.property_presentation).kind === 'approved_summary'
  const disclosure = object(raw.location_disclosure || object(raw.contexto_verificado).location_disclosure)
  const address = exactLocation && disclosure.address_allowed !== false
  const map = exactLocation && disclosure.map_allowed !== false
  const clone = (value: unknown, key = '', catalogRecord = false): unknown => {
    if (Array.isArray(value)) return value.filter(entry => {
      const item = object(entry)
      if (!prices && (catalogRecordKeys.has(key) || key === 'groups' || key === 'grupos')) {
        if (item.metric === 'published_commercial_price' || item.field === 'published_commercial_price'
          || item.source_scope === 'price_quote' || text(item.id).startsWith('group:price_quote:')) return false
      }
      if (!dimensions && (catalogRecordKeys.has(key) || numericFactKeys.has(key))
        && (dimensionFields.has(text(item.metric)) || dimensionFields.has(text(item.field)))) return false
      if (!features && (catalogRecordKeys.has(key) || numericFactKeys.has(key))
        && (unitFeatureFields.has(text(item.metric)) || unitFeatureFields.has(text(item.field)))) return false
      return prices || !numericFactKeys.has(key) || !purchasePriceFields.has(text(item.field))
    }).map(entry => clone(entry, key, catalogRecord || catalogRecordKeys.has(key)))
    if (!value || typeof value !== 'object') return value
    const source = object(value)
    // Scope metadata is a contract wherever it appears, including obligation rows.
    if (source.version === RESPONSE_CONTENT_SCOPE_VERSION || source.id === 'location_scope') return { ...source }
    const isProject = projectSourceKeys.has(key)
    return Object.fromEntries(Object.entries(source).filter(([field]) => {
      // The approved summary already contains every business fact authorized
      // for this stage. Do not expose inventory/building facts as extra copy.
      if (approvedOpening && (catalogRecordKeys.has(field) || numericFactKeys.has(field)
        || ['instalaciones', 'amenities', 'lugares_cercanos', 'contexto_sector', 'posicionamiento_proyecto'].includes(field))) return false
      if (approvedOpening && isProject && !['id', 'name', 'title'].includes(field)) return false
      // Delivery fingerprints are for continuity, not model evidence. Their
      // serialized snapshots may contain prices hidden in this writer turn.
      if (field === 'budget_scope_key' || key === 'budget_guidance' && field === 'scope_key') return false
      if (!dimensions && dimensionFields.has(field)) return false
      if (!features && catalogRecord && (unitFeatureFields.has(field) || key === 'unit_model' && field === 'url')) return false
      if (progression && ['areas', 'presentation_suggestions'].includes(field)) return false
      if (!prices && (purchasePriceFields.has(field) || priceEvidenceKeys.has(field) && source[field] != null
        || key === 'early_purchase_discount' && quoteAmountFields.has(field)
        || catalogRecord && ['price', 'commercial_price'].includes(field))) return false
      if (!introduction && field === 'presentacion_general_proyecto') return false
      if (!map && mapSourceKeys.has(field)) return false
      if (!generalLocation && !exactLocation && generalLocationKeys.has(field)) return false
      if (isProject && (!generalLocation && !exactLocation && projectLocationFields.has(field)
        || !address && exactLocationFields.has(field))) return false
      return true
    }).map(([field, entry]) => [field, progression && historyKeys.has(field) && Array.isArray(entry)
      ? entry.map(item => {
        const message = object(item)
        return ['bot', 'asesor'].includes(text(message.role))
          ? { ...message, content: replyQuestions(text(message.content)).join(' ') || '[Respuesta anterior ya entregada]' }
          : item
      }) : interpretationKeys.has(field) ? entry
      : clone(entry, field, catalogRecord || catalogRecordKeys.has(field))]))
  }
  return object(clone(raw))
}
