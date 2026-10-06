import { object, text, type Row } from './data'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
const ignored = new Set('como esta estoy quiero busco buscar tiene tienen tener local locales suite suites departamento departamentos penthouse penthouses proyecto vilet informacion opciones opcion favor interesa interesado necesito para sobre puede donde gracias espacio espacios'.split(' '))
const terms = (value: string) => normalize(value).split(/[^a-z0-9]+/).filter(word => word.length >= 4 && !ignored.has(word))
const variants = (word: string) => [word, word.replace(/s$/, ''), word.replace(/es$/, '')]

// This only selects supplementary evidence. It never interprets a number,
// changes the extractor's intent, or certifies a feature/absence. Keep each
// matched fact whole, including restrictions (e.g. resident-only amenities).
export function relevantFacts(value: unknown, query: string, broad: RegExp) {
  const facts = rows(value)
  if (broad.test(normalize(query))) return facts
  const requested = new Set(terms(query).flatMap(variants))
  return facts.filter(fact => terms(Object.values(fact).filter(v => typeof v === 'string').join(' '))
    .some(term => variants(term).some(form => requested.has(form))))
}

const policyTriggers: Record<string, RegExp> = {
  compra_exterior: /extranjer|exterior.*(?:pais|ecuador)|fuera de ecuador|distancia|residencia|resid[eo]|migran/,
  reserva: /reserv|apartad|apartarl|separar/,
  pagos: /pag[oa]|transfer|cuenta bancaria|deposit|comprobante/,
  financiamiento: /financi|credit|hipotec|banco|cuota|entrada|enganche/,
  documentos: /document|firm[ae]|contrato|escritur/,
  cancelacion: /cancel|devol|reembolso|desist/,
  visitas: /visit|recorrido|conocer.*(?:obra|oficina)|cita/,
}

export function selectPolicies(verified: Row, current: string, domains = new Set<string>()) {
  const profile = object(verified.perfil_lead), query = normalize(current)
  const abroad = text(profile.residence_country) && !/^(?:ecuador|ec|ecu)$/.test(normalize(text(profile.residence_country)))
  return rows(verified.politicas_negocio).filter(policy => !policyTriggers[text(policy.topic)]
    || policyTriggers[text(policy.topic)].test(query) || policy.topic === 'compra_exterior' && !!abroad
    || policy.topic === 'financiamiento' && domains.has('financing')
    || policy.topic === 'visitas' && domains.has('visit'))
}

/** Exact or semantic retrieval can both qualify for context selection.
 * This projection is shared by writing and review, before evidence is built.
 * The extractor, operational state, global guardrails and tone are unchanged. */
export function semanticCatalogContext(verified: Row, audit: Row, current: string): Row {
  if (!(object(audit.catalog_retrieval).applied === true || object(audit.catalog_retrieval).optimized === true)
    || !['semantic_candidates', 'optimized_catalog'].includes(text(object(verified.catalog_context_scope).kind))) return verified

  const result = { ...verified }
  const requests = [...rows(object(verified.contrato_turno).requests), ...rows(verified.solicitudes_interpretadas), ...rows(verified.consultas_pendientes)]
  const queryText = [current, ...requests.map(r => text(r.evidence) || text(r.request) || text(r.content))].join('\n')
  // Select against every request, including pending questions. A short
  // follow-up cannot erase a policy needed by another part of this turn.
  result.politicas_negocio = selectPolicies(verified, queryText, new Set(requests.map(r => text(r.domain))))
  result.business_policy_context = { ...object(verified.business_policy_context),
    selection: 'semantic_property_search', included_count: rows(result.politicas_negocio).length }
  result.instalaciones = relevantFacts(verified.instalaciones, queryText, /amenidad|instalacion|comodidad|area[s]? comun|servicios del proyecto/)
  result.lugares_cercanos = relevantFacts(verified.lugares_cercanos, queryText, /cerca|alrededor|entorno|sector|ubicacion|zona|barrio/)
  result.contexto_sector = relevantFacts(verified.contexto_sector, queryText, /entorno|sector|ubicacion|zona|barrio|plusval/)
  // Project identity/location suffice for the opening. Keep a requested
  // description when its facts overlap with this search.
  const project = object(verified.proyecto)
  result.proyecto = { name: project.name, address: project.address,
    ...(relevantFacts([{ description: project.description }], queryText, /proyecto|edificio/).length ? { description: project.description } : {}) }
  delete result.posicionamiento_proyecto
  const blocks = ['instalaciones', 'lugares_cercanos', 'contexto_sector', 'politicas_negocio']
  result.prompt_context_selection = {
    version: 'semantic-property-context-v1', mode: object(audit.catalog_retrieval).optimized === true ? 'optimized_catalog' : 'semantic_candidates',
    included_unit_count: rows(verified.catalogo).length,
    blocks: blocks.map(key => ({ key, available: rows(verified[key]).length, included: rows(result[key]).length })),
    note: 'Contexto seleccionado para esta búsqueda. Los bloques omitidos no acreditan inexistencia de servicios ni ausencia de políticas. Responda con las fichas incluidas; no complete datos con el historial. Las obligaciones del turno y restricciones generales siguen vigentes.',
  }
  return result
}

export const SEMANTIC_OPENING_RULE = 'En esta búsqueda se incluyeron solo candidatas pertinentes. Si profile_introduction pide nombre o residencia, responda brevemente a la característica solicitada y formule esa pregunta. Las fichas respaldan la respuesta; no obligan a enumerar unidades, medidas o precios que el cliente no pidió. Conserve los datos pendientes y el propósito de la pregunta. Esta orientación de brevedad no constituye un motivo de rechazo de estilo.'
