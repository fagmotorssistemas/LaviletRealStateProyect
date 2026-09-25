import { object, text, type Row } from './data'

const factFields = ['bedrooms', 'bathrooms_full', 'area_internal_m2', 'area_exterior_m2', 'published_commercial_price', 'floor_number']
export const factualValuesSchema = { type: 'array', maxItems: 80, items: { type: 'object', additionalProperties: false,
  properties: { fragment: { type: 'string' }, unit_id: { type: 'string' }, field: { type: 'string', enum: factFields }, value: { type: 'number' } },
  required: ['fragment', 'unit_id', 'field', 'value'] } }

export const FLEXIBLE_FACT_RULES = `La respuesta_base es una propuesta, no evidencia independiente ni un texto obligatorio. Puede omitir cifras y opciones secundarias si responde plenamente al mensaje actual. answered_content_preserved evalúa la información necesaria para esa consulta, no que se repitan todas las cifras de la base. No equipare mayor precio con mayor superficie o exclusividad. Para afirmar un máximo de precio use el ranking calculado sobre el conjunto pertinente; si no existe evidencia, rechace esa afirmación.
En factual_values extraiga TODAS las relaciones explícitas entre una unidad y sus valores numéricos (dormitorios, baños, áreas, precio publicado, planta). Use el ID del catálogo, field y value numérico; fragment debe copiar literalmente el texto que lo afirma. Desagregue afirmaciones compartidas por varias unidades. No use números del historial como evidencia. Use [] si no hay valores atribuibles a unidades concretas. Si hay más de 80 relaciones no apruebe la respuesta.`

export function validateFactualValues(value: unknown, reply: string, catalog: unknown): boolean {
  return factualValueIssues(value, reply, catalog).length === 0
}

export function factualValueIssues(value: unknown, reply: string, catalog: unknown): Row[] {
  if (!Array.isArray(value) || value.length > 80) return [{ code: 'invalid_fact_list', kind: 'review_metadata' }]
  const units = Array.isArray(catalog) ? catalog.map(object) : []
  return value.flatMap((raw, index) => {
    const fact = object(raw), unit = units.find(unit => unit.id === fact.unit_id), field = text(fact.field)
    const detail = { index, fragment: text(fact.fragment), unit_id: fact.unit_id, field, received: fact.value }
    if (!unit || !factFields.includes(field) || typeof fact.value !== 'number' || !Number.isFinite(fact.value))
      return [{ ...detail, code: 'invalid_unit_fact', kind: 'review_metadata' }]
    if (unit[field] == null || unit[field] === '' || Number(unit[field]) !== fact.value)
      return [{ ...detail, code: 'catalog_value_mismatch', kind: 'catalog_data', expected: unit[field] ?? null }]
    if (!text(fact.fragment).trim() || !reply.includes(text(fact.fragment)))
      return [{ ...detail, code: 'review_fragment_not_in_reply', kind: 'review_metadata' }]
    return []
  })
}


export const claimSchema = { type: 'array', maxItems: 16, items: { type: 'object', additionalProperties: false, properties: {
  fragment: { type: 'string' }, subject: { type: 'string' }, polarity: { type: 'string', enum: ['affirmation', 'negation', 'uncertainty'] },
  verdict: { type: 'string', enum: ['supported', 'unsupported', 'contradicted'] },
  evidence: { type: 'string' }, evidence_source: { type: 'string', enum: ['verified_context', 'catalog_no_results', 'none'] },
}, required: ['fragment', 'subject', 'polarity', 'verdict', 'evidence', 'evidence_source'] } }

export const CLAIM_RULES = `Además de revisar la cobertura, enumere en claims cada afirmación factual de respuesta_propuesta, con un fragmento literal, sujeto, polaridad y evidencia concreta. Use hasta 16 entradas, agrupe datos del mismo sujeto y mantenga cada explicación de evidencia por debajo de 160 caracteres. La cortesía y las preguntas no son hechos comerciales. No use el historial ni la propia respuesta como evidencia. supported requiere respaldo del contexto verificado; neutralidad o ausencia de contradicción NO bastan. Si no hay respaldo use unsupported. Una negación también necesita evidencia. catalog_no_results solo autoriza la afirmación de que no hubo coincidencias para EXACTAMENTE catalog_evidence.catalog_query; no autoriza decir que no hay propiedades en general ni negar otra categoría. Para esa fuente copie únicamente la oración negativa completa, sin incluir alternativas afirmativas. Distinga «no hay», «no solo hay» e incertidumbre. Compruebe que la respuesta conteste la pregunta actual, no solo que reproduzca la base. Devuelva claims=[] únicamente cuando no existan afirmaciones factuales.`

export function reviewClaims(value: unknown, reply: string): { valid: boolean; claims: Row[] } {
  if (!Array.isArray(value) || value.length > 16) return { valid: false, claims: [] }
  const claims = value.map(object)
  return { claims, valid: claims.every(claim => text(claim.fragment).trim() && reply.includes(text(claim.fragment))
    && text(claim.subject).trim() && text(claim.evidence).trim() && claim.verdict === 'supported'
    && ['affirmation', 'negation', 'uncertainty'].includes(text(claim.polarity))
    && ['verified_context', 'catalog_no_results'].includes(text(claim.evidence_source))) }
}

/** Only a reviewed denial of this complete, empty query may bypass lexical checks.
 * Evidence and scope must come from the code's query, never the writer's metadata. */
export function reviewedCatalogDenials(reply: string, audit: Row): string[] {
  const result = object(audit.catalog_results), query = object(audit.catalog_query)
  const filters = object(query.filters), review = object(audit.semantic_review)
  if (review.status !== 'checked' || result.complete !== true || !Array.isArray(result.units) || result.units.length
    || !Array.isArray(result.unknown_unit_ids) || result.unknown_unit_ids.length || query.scope !== 'catalog') return []
  return (Array.isArray(review.claims) ? review.claims.map(object) : []).filter(claim => {
    const fragment = text(claim.fragment)
    const counts: Record<string, number> = { uno: 1, una: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 }
    const numericFragment = fragment.replace(/\b(uno|una|un|dos|tres|cuatro|cinco|seis)\s+(?=dormitorios?|habitaciones?|cuartos?)/gi, word => String(counts[word.trim().toLowerCase()]) + ' ')
    // Recheck the recorded claim against this reply and the exact query it reviewed.
    return claim.evidence_source === 'catalog_no_results' && claim.polarity === 'negation' && claim.verdict === 'supported'
      && fragment.length > 0 && reply.includes(fragment) && text(claim.evidence).length > 0
      && reply.split(/(?<!\d)\.\s+|[;\n]+/).some(sentence => sentence.trim().replace(/\.$/, '') === fragment.trim().replace(/\.$/, ''))
      && !/https?:\/\//.test(fragment)
      && [...numericFragment.matchAll(/\d+(?:[.,]\d+)?/g)].every(match => Object.values(filters).some(value => typeof value === 'number' && value === Number(match[0].replace(',', '.'))))
      && JSON.stringify(review.query) === JSON.stringify(query)
      && (filters.bedrooms == null || new RegExp(`\\b${Number(filters.bedrooms)}\\b`).test(numericFragment))
  }).map(claim => text(claim.fragment))
}
