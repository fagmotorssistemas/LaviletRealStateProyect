import { object, text, type Row } from './data'
import { projectIntroductionForTurn } from './project-introduction-context'
import { locationRequestKind } from './visit-location'
import { normalizedRequestTopics } from './request-topics'
import { asksUnitPrice } from './price-reply'

export const RESPONSE_CONTENT_SCOPE_VERSION = 'response-content-scope-v1'
export const RESPONSE_CONTENT_SCOPE_WRITER_RULE = 'Cumpla response_content_scope y obligaciones_del_turno; los datos disponibles no autorizan contenido ajeno al turno.'
export const RESPONSE_CONTENT_SCOPE_RULES = 'PERTINENCIA DEL CONTENIDO: response_content_scope distingue información que corresponde comunicar en ESTE turno de hechos disponibles para verificarla. allowed=true permite atender ese aspecto, pero no demuestra su veracidad ni obliga a enumerar su ficha. allowed=false impide introducir ese aspecto por costumbre, aunque sea verdadero o figure en el historial. Responda todas las solicitudes actuales y las pendientes todavía sin atender, conserve la pregunta comercial vigente y los permisos existentes. Una respuesta de categoría, dormitorios, planta, unidad o perfil no solicita precios ni una nueva presentación. Los precios consultados y las comparaciones indispensables del presupuesto conservan su exactitud y su condición referencial vigente y posibilidad de cambio; esa condición no obliga a narrar la etapa comercial ni el avance de obra. Una ubicación ya compartida no autoriza repetirla. Las restricciones físicas limitan promesas de acceso o representaciones digitales; cuando construction_status se permite solo por esa excepción, explique únicamente el límite pertinente, sin una ficha de obra. La falta de medidas solo corresponde a una consulta de cabida o accesibilidad: no añada una advertencia ni una oferta de asesoría a una selección ordinaria. El revisor comprueba tanto respaldo factual como pertinencia: un hecho verdadero fuera de este alcance incumple la obligación del turno, no es una preferencia de estilo. No elimine la respuesta válida ni cambie selecciones, consentimientos o el siguiente paso para corregir contenido adicional.'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const normalized = (value: string) => value.normalize('NFKC').toLowerCase()
const literal = (quote: unknown, source: string) => !!text(quote).trim()
  && normalized(source).includes(normalized(text(quote).trim()))
const requestIdentity = (request: Row) => JSON.stringify([request.request, request.evidence,
  text(request.source) || 'current', request.source === 'pending' ? request.source_message_id : null])
const positive = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0
const topic = (allowed: boolean, reason: string): Row => ({ allowed, reason: allowed ? reason : 'not_requested_in_this_turn' })

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
    if (request.confidence !== 'high' || request.domain === 'courtesy') return false
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
    && !(semantics.confidence === 'high' && extractorIntent && extractorIntent !== 'ask_price')
    && asksUnitPrice(current, true)
  const legacyPrice = legacyCanonicalPrice || legacyVerifiedQuote || !hasCurrentTypedTopics && semantics.confidence === 'high' && extractorIntent === 'ask_price'
    && (literal(semantics.primary_evidence, current)
      || currentGrounded.some(request => request.domain === 'property'))
  const pendingPriceClarification = intent.price_request_status === 'pending'
    && intent.interpretation_source === 'clarification_of_price_request'
  const currentBudget = object(semantics.budget || intent.budget)
  const declaredTotalBudget = currentBudget.confidence === 'high' && ['amount', 'maximum_total'].includes(text(currentBudget.status))
    && positive(currentBudget.amount) && literal(currentBudget.evidence, current)
  const assessment = object(verified.presupuesto_del_turno)
  const currentAssessment = positive(assessment.amount) && literal(assessment.evidence, current)
    && ['matching_options', 'below_available_prices', 'incomplete_prices'].includes(text(assessment.status))
    && (assessment.budget_source === 'current_lead_statement' || declaredTotalBudget)
  const knownPrices = rows(verified.catalogo).some(unit => positive(unit.published_commercial_price))
    || rows(assessment.prices).some(unit => positive(unit.published_commercial_price)) || positive(assessment.minimum_price)
  const budgetComparison = (declaredTotalBudget || currentAssessment) && knownPrices
  const approvedIntroduction = projectIntroductionForTurn(verified)
  const initialOverview = !!approvedIntroduction && currentGrounded.some(request => request.domain === 'property')
    && (!hasTypedTopics || currentTopics.has('project_overview'))
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
  const legacyEvaluation = !hasCurrentTypedTopics && rows(semantics.housing_quantities).some(quantity => quantity.confidence === 'high'
    && quantity.role === 'evaluation' && literal(quantity.evidence, current))
  return { version: RESPONSE_CONTENT_SCOPE_VERSION, topics: {
    project_intro: topic(initialOverview, 'approved_initial_overview'),
    general_location: topic(initialOverview || locationRequested || inPersonConfirmation,
      initialOverview ? 'approved_initial_overview' : locationRequested ? 'location_request' : 'verified_in_person_confirmation'),
    exact_location: topic(explicitExactLocation || inPersonConfirmation,
      explicitExactLocation ? 'explicit_location_request' : 'verified_in_person_confirmation'),
    purchase_prices: topic(requested.has('purchase_price') || legacyPrice || pendingPriceClarification || budgetComparison,
      requested.has('purchase_price') ? 'unanswered_price_request' : legacyPrice ? 'current_legacy_price_request'
        : pendingPriceClarification ? 'pending_price_reference_clarification' : 'current_budget_comparison'),
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
  'hechos_disponibles', 'hechos_protegidos', 'protected_facts'])
const numericFactKeys = new Set(['project_facts', 'hechos_con_cantidades', 'factual_values', 'project_values'])

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
  const disclosure = object(raw.location_disclosure || object(raw.contexto_verificado).location_disclosure)
  const address = exactLocation && disclosure.address_allowed !== false
  const map = exactLocation && disclosure.map_allowed !== false
  const clone = (value: unknown, key = '', catalogRecord = false): unknown => {
    if (Array.isArray(value)) return value.filter(entry => {
      const item = object(entry)
      if (!prices && (catalogRecordKeys.has(key) || key === 'groups' || key === 'grupos')) {
        return item.metric !== 'published_commercial_price' && item.field !== 'published_commercial_price'
          && item.source_scope !== 'price_quote' && !text(item.id).startsWith('group:price_quote:')
      }
      return prices || !numericFactKeys.has(key) || !purchasePriceFields.has(text(item.field))
    }).map(entry => clone(entry, key, catalogRecord || catalogRecordKeys.has(key)))
    if (!value || typeof value !== 'object') return value
    const source = object(value)
    // Scope metadata is a contract wherever it appears, including obligation rows.
    if (source.version === RESPONSE_CONTENT_SCOPE_VERSION || source.id === 'location_scope') return { ...source }
    const isProject = projectSourceKeys.has(key)
    return Object.fromEntries(Object.entries(source).filter(([field]) => {
      if (!prices && (purchasePriceFields.has(field) || priceEvidenceKeys.has(field) && source[field] != null
        || key === 'early_purchase_discount' && quoteAmountFields.has(field)
        || catalogRecord && ['price', 'commercial_price'].includes(field))) return false
      if (!introduction && field === 'presentacion_general_proyecto') return false
      if (!map && mapSourceKeys.has(field)) return false
      if (!generalLocation && !exactLocation && generalLocationKeys.has(field)) return false
      if (isProject && (!generalLocation && !exactLocation && projectLocationFields.has(field)
        || !address && exactLocationFields.has(field))) return false
      return true
    }).map(([field, entry]) => [field, interpretationKeys.has(field) ? entry
      : clone(entry, field, catalogRecordKeys.has(field))]))
  }
  return object(clone(raw))
}
