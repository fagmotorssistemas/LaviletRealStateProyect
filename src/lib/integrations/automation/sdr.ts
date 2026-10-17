import { botVisitPolicy } from '@/lib/inmobiliaria/botVisits'
import { publishedBusinessPolicies } from '@/lib/inmobiliaria/businessPolicies'
import { cashPaymentContext } from '@/lib/inmobiliaria/cashPaymentRules'
import { catalogSearchSettings } from '@/lib/inmobiliaria/catalogSearch'
import { earlyPurchaseDiscountSettings } from '@/lib/inmobiliaria/earlyPurchaseDiscounts'
import { financingGuidanceSettings } from '@/lib/inmobiliaria/financingGuidance'
import { poolAccessContext } from '@/lib/inmobiliaria/poolAccess'
import { deliveryContext } from '@/lib/inmobiliaria/projectDelivery'
import { projectIntroductionContext } from '@/lib/inmobiliaria/projectIntroduction'
import { projectReadiness } from '@/lib/inmobiliaria/projectReadiness'
import { botPricingPolicy,launchPricesVisible,referentialPriceNoticeEnabled } from '@/lib/inmobiliaria/unitPrices'
import 'server-only'

import { recordCatalogRetrieval } from './ai-execution-trace'
import { catalogDialogueReply,catalogQuery,partitionCatalog } from './catalog-dialogue'
import { retrieveCatalogByEmbeddings,semanticCatalogScope } from './catalog-embeddings'

import { PROJECT_POSITIONING } from './commercial-experience'

import { readCommercialContext } from './context-read'
import { conversationalFirstName } from './conversation-style'
import { projectPublicName } from './conversation-tone'
import { db,object,scope,text,type Row } from './data'
import { earlyPurchaseDiscountContext } from './early-purchase-discount-context'

import { financingPolicyContext } from './financing-quote'
import { informationOnly } from './interaction-mode'
import { confirmedInterpretationMemory } from './interpretation-memory'
import { confirmedLeadProfile } from './lead-profile'
import { locationDisclosurePolicy,projectLocationForPrompt } from './location-policy'
import { optimizedCatalogReply } from './optimized-catalog-reply'
import { priceNoticeForConversation } from './price-conditions'
import { unitPriceQuote } from './price-reply'

import { withProjectObjectionContext } from './project-objections'

import { responseContentScope } from './response-content-scope'

import { nextDiscoveryQuestion, sdrState } from './sdr-rules'

import type { Guard } from './visits'

export async function catalogSearchConfiguration() {
  try {
    const { data, error } = await db().from('projects').select('policies_json').eq('id', scope.project_id).eq('tenant_id', scope.tenant_id)
      .abortSignal(AbortSignal.timeout(5000)).maybeSingle()
    return catalogSearchSettings(error ? {} : object(data).policies_json)
  } catch { return catalogSearchSettings({}) }
}

export async function publishedUnitCatalog() {
  const result = await readCommercialContext({ units: () => db().from('units').select('id,category,unit_number,floor,floor_number,bedrooms,bathrooms_full,area_internal_m2,area_exterior_m2,area_total_m2,description,spaces')
    .match(scope).eq('is_published', true).eq('status', 'disponible').limit(100).abortSignal(AbortSignal.timeout(10_000)) })
  return (result.units.data || []) as Row[]
}

export async function commercialContext(lead: Row, history: unknown, profileInput?: unknown, finance?: Row) {
  const sources = await readCommercialContext({
    units: (attempt) => db().from('units').select('id,category,unit_number,unit_type_id,floor,floor_number,bedrooms,bathrooms_full,area_internal_m2,area_exterior_m2,area_total_m2,published_commercial_price,description,spaces,is_published,status')
      .match(scope).eq('is_published', true).eq('status', 'disponible').limit(100).abortSignal(AbortSignal.timeout(attempt ? 15_000 : 10_000)),
    amenities: (attempt) => db().from('project_amenities').select('category,amenity_name,description').eq('project_id', scope.project_id).limit(100)
      .abortSignal(AbortSignal.timeout(attempt ? 15_000 : 10_000)),
    places: (attempt) => db().from('location_pois').select('poi_name,poi_category').eq('project_id', scope.project_id).limit(100)
      .abortSignal(AbortSignal.timeout(attempt ? 15_000 : 10_000)),
    project: (attempt) => db().from('projects').select('name,address,description,policies_json').eq('id', scope.project_id).eq('tenant_id', scope.tenant_id)
      .abortSignal(AbortSignal.timeout(attempt ? 15_000 : 10_000)).maybeSingle(),
    config: (attempt) => db().from('project_automation_config').select('mode,timezone,business_hours,visit_location_url').match(scope)
      .abortSignal(AbortSignal.timeout(attempt ? 15_000 : 10_000)).maybeSingle(),
  })
  const units = (Array.isArray(sources.units.data) ? sources.units.data : []) as Row[]
  const amenities = (Array.isArray(sources.amenities.data) ? sources.amenities.data : []) as Row[]
  const places = (Array.isArray(sources.places.data) ? sources.places.data : []) as Row[]
  const settings = object(sources.config.data), mode = text(settings.mode) || 'lanzamiento'
  const projectData = object(sources.project.data)
  const areaFactsResult = await db().from('project_area_facts')
    .select('fact_key,category,headline,safe_sales_text,audiences,commercial_modes,verified_on')
    .match(scope).eq('review_status', 'verified').eq('approved_for_bot', true)
    .abortSignal(AbortSignal.timeout(10_000))
  // This context was added after the original automation tables. During a
  // staggered deployment, a missing optional table must not stop all replies.
  const areaFacts = areaFactsResult.error ? [] : (areaFactsResult.data || []).filter(fact => {
    const modes = Array.isArray(fact.commercial_modes) ? fact.commercial_modes : []
    return !modes.length || modes.includes(mode)
  })
  const pricing = botPricingPolicy(mode, launchPricesVisible(projectData.policies_json))
  const pricesAllowed = pricing.visible
  const discounts = earlyPurchaseDiscountContext(units.map(row => ({ ...row,
    published_commercial_price: pricesAllowed ? row.published_commercial_price : null })),
  earlyPurchaseDiscountSettings(projectData.policies_json), { mode, pricesAuthorized: pricesAllowed,
    today: new Intl.DateTimeFormat('en-CA', { timeZone: text(settings.timezone) || 'America/Guayaquil',
      year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) })
  const catalog = discounts.units
  const profile = confirmedLeadProfile(profileInput)
  const commercialProfile = await db().from('lead_commercial_profiles')
    .select('nutrition_active,nutrition_reason,purchase_horizon,nutrition_evidence,contact_consent,resume_at,updated_at')
    .eq('lead_id', lead.id).eq('tenant_id', scope.tenant_id).abortSignal(AbortSignal.timeout(5000)).maybeSingle()
  const policies = publishedBusinessPolicies(projectData.policies_json, mode)
  const result = { lead: { name: conversationalFirstName(text(profile.full_name)) || null,
    name_confirmed: profile.name_status === 'confirmed', name_source: object(profile.sources).full_name || null,
    preferred_category: lead.preferred_category, purchase_purpose: lead.purchase_purpose,
    preferred_bedrooms: lead.preferred_bedrooms, stage: lead.stage, unit_id: lead.unit_id, budget: lead.budget,
    budget_max: lead.budget_max, behavior_signals: lead.behavior_signals }, historial: history,
    perfil_lead: profile, ficha_comercial: commercialProfile.error ? null : commercialProfile.data,
    conversacion: sdrState(lead, history), siguiente_pregunta: nextDiscoveryQuestion(lead),
    proyecto: { name: projectPublicName(projectData, projectData.policies_json),
      public_name: projectPublicName(projectData, projectData.policies_json),
      address: projectData.address, description: projectData.description }, modo_comercial: mode,
    politica_visitas: botVisitPolicy(projectData.policies_json, mode),
    politicas_negocio: policies,
    politica_descuentos: discounts.policy,
    politica_pago_contado: cashPaymentContext(projectData.policies_json, mode, discounts.policy.as_of),
    business_policy_context: { status: 'loaded', available_count: policies.length, mode },
    estado_proyecto: projectReadiness(projectData.policies_json,mode).configured ? projectReadiness(projectData.policies_json,mode).value : null,
    entrega_proyecto: deliveryContext(projectData.policies_json),
    configuracion_presentacion_proyecto: projectIntroductionContext(projectData.policies_json,text(projectData.name)),
    posicionamiento_proyecto: PROJECT_POSITIONING,
    politica_comercial: { precios_autorizados: pricesAllowed && catalog.some(u => Number(u.published_commercial_price) > 0),
      precios_aproximados: pricing.approximate,
      aviso_precios_referenciales: referentialPriceNoticeEnabled(projectData.policies_json),
      describir_disponibilidad_publicada: true, garantizar_disponibilidad_sin_reserva: false,
      confirmar_visita_sin_resultado: false, agendar_llamadas: false },
    alcance_producto: 'La Vilet ofrece suites, departamentos, penthouses y locales comerciales en Cuenca.',
    politica_financiera: { credito_directo: false,
      guidance: financingPolicyContext(financingGuidanceSettings(projectData.policies_json), Array.isArray(finance?.partners) ? finance.partners.map(text) : []) },
    catalogo: catalog, catalog_read: { complete: units.length < 100, scope: 'published_available_project_units' },
    catalog_search: catalogSearchSettings(projectData.policies_json),
    instalaciones: amenities, lugares_cercanos: places, contexto_sector: areaFacts,
    acceso_piscina: poolAccessContext(projectData.policies_json),
    condiciones_instalaciones: 'Las instalaciones describen espacios del proyecto. acceso_piscina define expresamente el permiso vigente para residentes y huéspedes temporales; prevalece sobre descripciones antiguas de la piscina. Las demás condiciones de acceso y cobros proceden de politicas_negocio publicadas. Distinga acceso de alícuota o mantenimiento; no invente importes ni considere desconocido un acceso ya aprobado. Solo derive condiciones que las fuentes realmente no definen.',
    horario_atencion: settings.business_hours,
    ubicacion: settings.visit_location_url,
    fecha: new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', dateStyle: 'full', timeStyle: 'short' }).format(new Date()) }
  return { ...result, politica_comercial: priceNoticeForConversation(result, history) }
}

export async function commercialReply(info: Row, current: string, summary: Row, guard: Guard) {
  info = withProjectObjectionContext(info, current)
  const project = object(info.proyecto)
  if (project.name || project.public_name) info = { ...info, proyecto: { ...project,
    name: projectPublicName(project), public_name: projectPublicName(project) } }
  info = projectLocationForPrompt(info, locationDisclosurePolicy({ current, verified: info }))
  info = { ...info, hechos_confirmados: confirmedInterpretationMemory(summary), price_notice_receipt: summary._price_notice }
  info.politica_comercial = priceNoticeForConversation(info, info.historial)
  const contentScope = responseContentScope(current, info)
  info = { ...info, alcance_contenido_turno: contentScope, location_disclosure: { ...object(info.location_disclosure),
    general_location_allowed: object(object(contentScope.topics).general_location).allowed === true,
    ...(object(object(contentScope.topics).general_location).allowed === true ? {} : { general_location: {} }) } }
  const informationQuery = object(object(info.property_context).information_query)
  if (object(info.brochure_intent).requested !== true && (informationOnly({ ...info, interaction_mode: summary._interaction_mode || info.interaction_mode })
    || Object.keys(informationQuery).length)) {
    const query = object(informationQuery.query || object(info.referencia_unidad).query)
    const excluded = new Set(Array.isArray(informationQuery.excluded_categories) ? informationQuery.excluded_categories : [])
    const context = object(info.property_context)
    const scopedIds = query.scope === 'selected' ? context.selected_ids
      : query.scope === 'comparison' ? context.comparison_ids : query.scope === 'offered' ? context.offered_ids : undefined
    const partition = partitionCatalog((Array.isArray(info.catalogo) ? info.catalogo : []).map(object), catalogQuery(query),
      Array.isArray(scopedIds) ? scopedIds.map(text) : undefined)
    const units = partition.units.filter(unit => !excluded.has(unit.category))
    const unknown = partition.unknown.filter(unit => !excluded.has(unit.category))
    return { reply: '', audit: { source: 'project_information', fallback: false,
      drafting_deferred_to_final_writer: true,
      ...(Object.keys(informationQuery).length ? { verified_catalog: true, catalog_query: query,
        catalog_excluded_categories: [...excluded],
        catalog_results: { units, unit_ids: units.map(unit => unit.id), complete: object(info.catalog_read).complete === true && !unknown.length, unknown_unit_ids: unknown.map(unit => unit.id) } } : {}) } }
  }
  { // Every caller uses typed facts and the shared final writer.
    // The common interpretation and final writer own the conversation. Legacy
    // text shortcuts below cannot overrule its objective or rewrite its prose.
    await guard()
    const retrieval = await retrieveCatalogByEmbeddings(info, current)
    recordCatalogRetrieval(retrieval.audit)
    const optimized = object(retrieval.audit.resolved_query).operation === 'search' ? optimizedCatalogReply(retrieval) : null
    if (optimized) return optimized
    const retrievalInfo = retrieval.units ? { ...info, catalogo: retrieval.units, catalog_retrieval: retrieval.audit,
      catalog_summary: retrieval.audit.catalog_summary, catalog_context_scope: semanticCatalogScope(retrieval.audit) } : info
    const catalogue = catalogDialogueReply(retrievalInfo, current)
    if (catalogue) return catalogue
    const quote = unitPriceQuote(info, current, summary)
    return { reply: quote?.reply || '', audit: { source: quote ? 'unit_price' : 'commercial',
      drafting_deferred_to_final_writer: true, verified_price_only: quote?.quoted === true,
      ...(quote?.units?.length ? { unit_reference: { ids: quote.units.map(unit => unit.id), numbers: quote.units.map(unit => unit.unit_number) } } : {}),
      ...(quote?.needsAdvisor ? { requires_advisor: true, handoff_reason: 'precio por verificar' } : {}) } }
  }
}
